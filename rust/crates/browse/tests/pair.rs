#![cfg(unix)]

use std::path::PathBuf;
use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant};

use browse_relay::{pairing, paths::Paths, port};
use serde_json::Value;

static NEXT_HARNESS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn process_alive(pid: u32) -> bool {
    unsafe { libc::kill(pid as i32, 0) == 0 }
}

struct Harness {
    paths: Paths,
    port: u16,
}

impl Harness {
    fn new() -> Self {
        let root = std::env::var_os("PI_SCRATCH_DIR").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
        let unique = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let sequence = NEXT_HARNESS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let paths = Paths::rooted(root.join(format!("browse-mint-test-{}-{unique}-{sequence}", std::process::id())));
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        Self { paths, port: listener.local_addr().unwrap().port() }
    }

    fn command(&self) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_browse"));
        command.env("OPENCODE_BROWSER_HOME", &self.paths.state)
            .env("OPENCODE_BROWSER_PORT", self.port.to_string())
            .env("OPENCODE_BROWSER_AUTOSTART", "1")
            .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
        command
    }

    fn run(&self, command: &mut Command) -> Output {
        let mut child = command.spawn().unwrap();
        let deadline = Instant::now() + Duration::from_secs(20);
        loop {
            if child.try_wait().unwrap().is_some() {
                return child.wait_with_output().unwrap();
            }
            if Instant::now() >= deadline {
                child.kill().unwrap();
                let _ = child.wait();
                panic!("pair --mint-json did not exit without an extension");
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}

impl Drop for Harness {
    fn drop(&mut self) {
        if let Some(state) = port::read_relay_state(&self.paths, self.port) {
            unsafe { libc::kill(state.pid as i32, libc::SIGTERM); }
            let deadline = Instant::now() + Duration::from_secs(3);
            while process_alive(state.pid) && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(20));
            }
            if process_alive(state.pid) {
                unsafe { libc::kill(state.pid as i32, libc::SIGKILL); }
            }
        }
        let _ = std::fs::remove_dir_all(&self.paths.state);
    }
}

#[test]
fn mint_json_starts_relay_and_returns_one_object_without_extension() {
    let harness = Harness::new();
    let mut relay_pid = None;
    for _ in 0..2 {
        let output = harness.run(harness.command().args(["pair", "--mint-json"]));
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        assert!(output.stderr.is_empty());
        let text = String::from_utf8(output.stdout).unwrap();
        assert_eq!(text.lines().count(), 1);
        let value: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(value.as_object().unwrap().len(), 3);
        assert_eq!(value["port"], harness.port);
        assert_eq!(value["endpoint"], format!("http://127.0.0.1:{}", harness.port));
        let code = value["code"].as_str().unwrap();
        let normalized = pairing::normalize_pairing_code(code).unwrap();
        assert_eq!(code, pairing::format_pairing_code(&normalized));
        let key = pairing::pairing_code_key(&normalized);
        assert!(pairing::pending_code_keys(&harness.paths).contains(&key));
        let state = port::read_relay_state(&harness.paths, harness.port).unwrap();
        assert!(process_alive(state.pid));
        assert_eq!(*relay_pid.get_or_insert(state.pid), state.pid, "reuse the running relay");
    }
    assert!(pairing::read_browser_pairings(&harness.paths).is_empty());
}

#[test]
fn mint_json_errors_leave_stdout_and_pending_codes_empty() {
    let harness = Harness::new();
    let output = harness.run(harness.command().env("OPENCODE_BROWSER_AUTOSTART", "0").args(["pair", "--mint-json"]));
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    assert!(String::from_utf8_lossy(&output.stderr).contains("automatic relay startup is disabled"));
    for args in [vec!["pair", "--mint-json", "--list"], vec!["pair", "--wait-seconds", "1", "--mint-json"]] {
        let output = harness.run(harness.command().args(args));
        assert!(!output.status.success());
        assert!(output.stdout.is_empty());
        assert!(String::from_utf8_lossy(&output.stderr).contains("--mint-json must be used alone"));
    }
    assert!(pairing::pending_code_keys(&harness.paths).is_empty());
    assert!(port::read_relay_state(&harness.paths, harness.port).is_none());
}
