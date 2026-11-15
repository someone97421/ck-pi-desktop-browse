//! 个人 fork 的离线更新策略与既有安装、状态接口。

use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{Context, bail};
use serde_json::{Value, json};

use crate::relay_api::{bin_root, paths};
use crate::VERSION;

const EXECUTABLE: &str = if cfg!(windows) { "browse.exe" } else { "browse" };
const UPDATES_DISABLED: &str = "此个人 fork 已禁用上游更新（disabled）；请按本地规则同步工作流维护个人仓库，再按本地规则构建和安装。";

/// How this browse was installed, which decides how it updates (cli/src/update/auto-update.ts `InstallKind`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Install {
    /// The executable the install script or `browse install` put in the bin folder.
    Binary(PathBuf),
    /// `npm install -g @opencode/browse`: the launcher runs its platform package's binary, which is this one.
    Npm(Npm),
    /// A temporary npx install, which npx resolves itself.
    Npx,
    /// A build in a checkout's cargo target folder.
    Checkout,
    Other,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Npm {
    /// The @opencode/browse package folder in npm's global node_modules.
    pub package: PathBuf,
    /// The global prefix it's installed under, which updates install into (`npm install -g --prefix`).
    pub prefix: PathBuf,
    /// The node that ran the launcher: its npm installs updates.
    pub node: Option<PathBuf>,
    /// The platform package this binary came from (`browse-linux-x64`), preferred after an update.
    pub platform: String,
}

impl Install {
    pub fn name(&self) -> &'static str {
        match self {
            Install::Binary(_) => "binary",
            Install::Npm(_) => "npm",
            Install::Npx => "npx",
            Install::Checkout => "checkout",
            Install::Other => "other",
        }
    }

    pub fn updates_itself(&self) -> bool {
        false
    }

    /// The executable a relay of this install starts from now: an npm update may have replaced the platform package.
    pub fn executable(&self) -> Option<PathBuf> {
        match self {
            Install::Binary(binary) => Some(binary.clone()),
            Install::Npm(npm) => npm.binary(),
            _ => None,
        }
    }
}

impl Npm {
    /// The binary the launcher would run now: this platform package (or the other libc's, as the launcher falls back),
    /// nested in the package as `npm install -g` lays it out, or beside it.
    pub fn binary(&self) -> Option<PathBuf> {
        let mut names = vec![self.platform.clone()];
        if cfg!(target_os = "linux") {
            names.push(self.platform.strip_suffix("-musl").map_or_else(|| format!("{}-musl", self.platform), str::to_owned));
        }
        let scopes = [self.package.join("node_modules").join("@opencode"), self.package.parent()?.to_path_buf()];
        names.iter().flat_map(|name| scopes.iter().map(move |scope| scope.join(name).join("bin").join(EXECUTABLE))).find(|file| file.is_file())
    }

    /// The version of @opencode/browse installed now.
    pub fn version(&self) -> Option<String> {
        let manifest: Value = serde_json::from_slice(&std::fs::read(self.package.join("package.json")).ok()?).ok()?;
        manifest["version"].as_str().map(str::to_owned)
    }
}

fn canonical(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

fn named(path: Option<&Path>, name: &str) -> bool {
    path.and_then(Path::file_name).is_some_and(|n| n == name)
}

/// What kind of install the executable `exe` belongs to. `launcher` and `node` are what the npm launcher passes
/// (OPENCODE_BROWSER_NPM_LAUNCHER, OPENCODE_BROWSER_NPM_NODE); `installed` is the bin folder's executable.
pub fn detect(exe: &Path, launcher: Option<&Path>, node: Option<PathBuf>, installed: &Path) -> Install {
    let exe = canonical(exe);
    if installed.is_file() && canonical(installed) == exe {
        return Install::Binary(installed.to_path_buf());
    }
    if let Some(install) = npm_layout(&exe, launcher, node) {
        return install;
    }
    let checkout = exe.ancestors().any(|dir| dir.file_name().is_some_and(|n| n == "target") && dir.parent().is_some_and(|p| p.join("Cargo.toml").is_file()));
    if checkout { Install::Checkout } else { Install::Other }
}

/// An npm install of @opencode/browse whose platform package holds `exe`: `node_modules/@opencode/browse-<target>/bin/`,
/// nested in the launcher's package or beside it.
fn npm_layout(exe: &Path, launcher: Option<&Path>, node: Option<PathBuf>) -> Option<Install> {
    let bin = exe.parent().filter(|b| named(Some(b), "bin"))?;
    let platform_dir = bin.parent()?;
    let platform = platform_dir.file_name()?.to_str().filter(|n| n.starts_with("browse-"))?.to_owned();
    let scope = platform_dir.parent().filter(|s| named(Some(s), "@opencode"))?;
    let modules = scope.parent().filter(|m| named(Some(m), "node_modules"))?;
    // The launcher that ran this (its dist/cli.mjs), else the package an older launcher, which doesn't say, runs from.
    let given = launcher.and_then(|l| canonical(l).parent()?.parent().map(Path::to_path_buf));
    let candidates = [given, modules.parent().map(Path::to_path_buf), Some(scope.join("browse"))];
    let package = candidates.into_iter().flatten().find(|package| {
        let runs_this = package.join("node_modules").join("@opencode") == scope || package.parent() == Some(scope);
        named(Some(package), "browse") && named(package.parent(), "@opencode") && runs_this && package.join("dist").join("cli.mjs").is_file()
    })?;
    if package.components().any(|c| c.as_os_str() == "_npx") {
        return Some(Install::Npx);
    }
    // A global install: <prefix>/lib/node_modules (<prefix>/node_modules on Windows) with the bin links npm made. A
    // project's own node_modules has no global prefix to update.
    let global = package.parent()?.parent().filter(|g| named(Some(g), "node_modules"))?;
    let prefix = if cfg!(windows) { global.parent()? } else { global.parent().filter(|lib| named(Some(lib), "lib"))?.parent()? };
    let linked = ["browse", "opencode-browser"].iter().any(|name| {
        if cfg!(windows) { prefix.join(format!("{name}.cmd")).is_file() } else { std::fs::symlink_metadata(prefix.join("bin").join(name)).is_ok() }
    });
    if !linked {
        return Some(Install::Other);
    }
    Some(Install::Npm(Npm { package: package.clone(), prefix: prefix.to_path_buf(), node, platform }))
}

/// This process's install.
pub fn install() -> Install {
    let Ok(exe) = crate::relay::current_exe() else { return Install::Other };
    let launcher = std::env::var_os("OPENCODE_BROWSER_NPM_LAUNCHER").filter(|v| !v.is_empty()).map(PathBuf::from);
    let node = std::env::var_os("OPENCODE_BROWSER_NPM_NODE").filter(|v| !v.is_empty()).map(PathBuf::from);
    detect(&exe, launcher.as_deref(), node, &bin_root().join(EXECUTABLE))
}

/// The release service's name for this build's platform.
pub fn target() -> String {
    let os = if cfg!(target_os = "macos") { "macos" } else if cfg!(windows) { "windows" } else { "linux" };
    let arch = if cfg!(target_arch = "aarch64") { "arm64" } else { "x64" };
    format!("{os}-{arch}{}", if cfg!(target_env = "musl") { "-musl" } else { "" })
}

pub fn channel() -> &'static str {
    if VERSION.contains("-dev.") {
        "dev"
    } else if VERSION.contains("-beta.") {
        "beta"
    } else {
        "stable"
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Mode {
    On,
    Notify,
    Off,
}

impl Mode {
    fn parse(value: &str) -> Option<Mode> {
        match value.trim().to_lowercase().as_str() {
            "on" | "1" | "true" => Some(Mode::On),
            "notify" => Some(Mode::Notify),
            "off" | "0" | "false" => Some(Mode::Off),
            _ => None,
        }
    }
    pub fn name(self) -> &'static str {
        match self {
            Mode::On => "on",
            Mode::Notify => "notify",
            Mode::Off => "off",
        }
    }
}

/// OPENCODE_BROWSER_AUTO_UPDATE (or OPENCODE_BROWSER_UPDATE_CHECK=0) fixes the mode over the stored one.
pub fn override_mode() -> Option<Mode> {
    std::env::var("OPENCODE_BROWSER_AUTO_UPDATE").ok().and_then(|v| Mode::parse(&v)).or_else(|| {
        (std::env::var("OPENCODE_BROWSER_UPDATE_CHECK").as_deref() == Ok("0")).then_some(Mode::Off)
    })
}

pub fn stored_mode() -> Mode {
    state().get("mode").and_then(Value::as_str).and_then(Mode::parse).unwrap_or(Mode::On)
}

pub fn effective_mode() -> Mode {
    Mode::Off
}

pub fn set_mode(mode: Mode) -> anyhow::Result<()> {
    update_state(|state| state["mode"] = json!(mode.name()))
}

fn state_path() -> PathBuf {
    paths().auto_update()
}

pub fn state() -> Value {
    std::fs::read(state_path()).ok().and_then(|b| serde_json::from_slice(&b).ok()).filter(Value::is_object).unwrap_or_else(|| json!({}))
}

pub fn update_state(change: impl FnOnce(&mut Value)) -> anyhow::Result<()> {
    let mut state = state();
    change(&mut state);
    write_private(&state_path(), format!("{:#}\n", state).as_bytes())
}

pub fn write_private(file: &Path, bytes: &[u8]) -> anyhow::Result<()> {
    let dir = file.parent().context("no parent folder")?;
    std::fs::create_dir_all(dir)?;
    let temporary = dir.join(format!(".{}.{}.tmp", file.file_name().unwrap_or_default().to_string_lossy(), std::process::id()));
    std::fs::write(&temporary, bytes)?;
    set_mode_bits(&temporary, 0o600);
    std::fs::rename(&temporary, file)?;
    Ok(())
}

fn set_mode_bits(_file: &Path, _mode: u32) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(_file, std::fs::Permissions::from_mode(_mode));
    }
}

/// Orders versions as semver does for the shapes releases use: dev below beta below the release, then by run.
fn version_order(value: &str) -> Option<[u64; 6]> {
    let (core, pre) = value.split_once('-').map_or((value, None), |(c, p)| (c, Some(p)));
    let core: Vec<u64> = core.split('.').map(|n| n.parse().ok()).collect::<Option<_>>()?;
    let [major, minor, patch] = core[..] else { return None };
    let (stage, run, build) = match pre {
        None => (2, 0, 0),
        Some(pre) => {
            let mut parts = pre.split('.');
            let stage = match parts.next()? {
                "dev" => 0,
                "beta" => 1,
                _ => return None,
            };
            let run = parts.next()?.parse().ok()?;
            let build = parts.next().map(str::parse::<u64>).transpose().ok()?.unwrap_or(0);
            if parts.next().is_some() {
                return None;
            }
            (stage, run, build)
        }
    };
    Some([major, minor, patch, stage, run, build])
}

/// Whether `latest` is strictly newer than `current` (src/shared/protocol.ts `newerCliVersion`). Unlike there, an
/// unknown version shape is never newer: an update must not downgrade.
pub fn newer(latest: &str, current: &str) -> bool {
    match (version_order(latest), version_order(current)) {
        (Some(a), Some(b)) => a > b,
        _ => false,
    }
}

pub struct Release {
    pub version: String,
    pub url: String,
    pub size: u64,
    pub sha256: String,
}

pub enum Check {
    UpToDate(String),
    /// Released, but not for this install yet (a staged rollout) or not for this platform.
    Deferred(String),
    Available(Release),
}

pub fn check() -> anyhow::Result<Check> {
    Ok(Check::UpToDate(VERSION.to_owned()))
}

pub fn install_binary(_release: &Release, _binary: &Path) -> anyhow::Result<()> {
    bail!(UPDATES_DISABLED)
}

/// The npm dist-tag a build follows: `latest` for a release, `dev` or `beta` for those builds.
pub fn dist_tag(version: &str) -> &'static str {
    if version.contains("-dev.") {
        "dev"
    } else if version.contains("-beta.") {
        "beta"
    } else {
        "latest"
    }
}

pub fn npm_wanted(_latest: &str, _running: &str, _on_disk: Option<&str>) -> bool {
    false
}

pub fn npm_latest(_npm: &Npm) -> anyhow::Result<String> {
    Ok(VERSION.to_owned())
}

pub fn npm_install(_npm: &Npm, _version: &str) -> anyhow::Result<String> {
    bail!(UPDATES_DISABLED)
}

pub fn command(args: &[String]) -> anyhow::Result<()> {
    if let Some(at) = args.iter().position(|a| a == "--mode") {
        let mode = args.get(at + 1).and_then(|value| Mode::parse(value)).context("--mode 仅支持 on、notify 或 off")?;
        set_mode(mode)?;
        println!("已保存 autoUpdate={}；有效模式仍为 off（disabled）。", mode.name());
    }
    if args.iter().any(|a| a == "--check") {
        println!("上游更新检查已禁用（disabled），无可用更新。");
    } else {
        println!("{UPDATES_DISABLED}");
    }
    Ok(())
}

pub fn pending_notice() -> Option<(String, String)> {
    None
}

pub fn status_json() -> Value {
    let install = install();
    let cli = match &install {
        Install::Checkout | Install::Npx => crate::relay::current_exe().map(|exe| exe.display().to_string()).unwrap_or_else(|_| "browse".into()),
        _ => "browse".into(),
    };
    json!({
        "install": install.name(),
        "cli": cli,
        "mode": stored_mode().name(),
        "effective": effective_mode().name(),
        "overriddenBy": "个人源码策略",
        "version": VERSION,
        "channel": channel(),
    })
}

pub fn describe_mode(_mode: Mode) -> &'static str {
    "disabled"
}

pub fn describe() -> String {
    UPDATES_DISABLED.into()
}

pub struct Updater;

impl Updater {
    pub fn spawn(_idle: Arc<dyn Fn() -> bool + Send + Sync>) -> Option<Updater> {
        None
    }

    pub fn replacement(&mut self) -> Option<PathBuf> {
        None
    }
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use super::{EXECUTABLE, Install, Npm, detect, newer};

    #[test]
    fn upstream_updates_are_disabled() {
        assert_eq!(super::effective_mode(), super::Mode::Off);
        assert_eq!(super::describe_mode(super::Mode::On), "disabled");
        assert!(!super::npm_wanted("99.0.0", "0.1.0", None));
        assert!(!Install::Binary(PathBuf::from("browse")).updates_itself());
        assert!(matches!(super::check().unwrap(), super::Check::UpToDate(version) if version == crate::VERSION));
        assert!(super::pending_notice().is_none());
        assert!(super::Updater::spawn(std::sync::Arc::new(|| panic!("不应检查浏览器活动"))).is_none());
    }

    struct Dir(PathBuf);

    impl Dir {
        fn new(name: &str) -> Dir {
            let dir = std::env::temp_dir().join(format!("browse-update-test-{name}-{}", crate::session::random_u64()));
            std::fs::create_dir_all(&dir).unwrap();
            Dir(std::fs::canonicalize(dir).unwrap())
        }
        fn file(&self, path: &str) -> PathBuf {
            let file = self.0.join(path);
            std::fs::create_dir_all(file.parent().unwrap()).unwrap();
            std::fs::write(&file, "{\"version\":\"0.1.0\"}").unwrap();
            file
        }
    }

    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// A global npm install under `<prefix>/lib/node_modules`, with its platform package nested or hoisted. Returns
    /// (launcher, binary).
    #[cfg(unix)]
    fn npm_global(dir: &Dir, prefix: &str, hoisted: bool) -> (PathBuf, PathBuf) {
        let package = format!("{prefix}/lib/node_modules/@opencode/browse");
        let launcher = dir.file(&format!("{package}/dist/cli.mjs"));
        dir.file(&format!("{package}/package.json"));
        let platform = if hoisted { format!("{prefix}/lib/node_modules/@opencode/browse-linux-x64") } else { format!("{package}/node_modules/@opencode/browse-linux-x64") };
        let binary = dir.file(&format!("{platform}/bin/{EXECUTABLE}"));
        std::os::unix::fs::symlink(&launcher, dir.file(&format!("{prefix}/bin/.keep")).with_file_name("browse")).unwrap();
        (launcher, binary)
    }

    #[cfg(unix)]
    #[test]
    fn detects_a_global_npm_install() {
        let dir = Dir::new("npm");
        let installed = dir.0.join("home/.local/bin/browse");
        let (launcher, binary) = npm_global(&dir, "prefix", false);
        let expected = Install::Npm(Npm {
            package: dir.0.join("prefix/lib/node_modules/@opencode/browse"),
            prefix: dir.0.join("prefix"),
            node: Some("/usr/bin/node".into()),
            platform: "browse-linux-x64".into(),
        });
        assert_eq!(detect(&binary, Some(&launcher), Some("/usr/bin/node".into()), &installed), expected);
        let Install::Npm(npm) = &expected else { unreachable!() };
        assert_eq!(npm.binary(), Some(binary.clone()));
        assert_eq!(npm.version().as_deref(), Some("0.1.0"));
        // An older launcher doesn't say where it is; the package is found around the binary.
        let Install::Npm(found) = detect(&binary, None, None, &installed) else { panic!("not npm") };
        assert_eq!(found.package, npm.package);
        // A launcher that isn't the one running this binary (an inherited variable) doesn't make it npm's.
        let other = Dir::new("other");
        assert_eq!(detect(&other.file("browse"), Some(&launcher), None, &installed), Install::Other);

        let hoisted = Dir::new("hoisted");
        let (launcher, binary) = npm_global(&hoisted, "usr", true);
        let Install::Npm(npm) = detect(&binary, Some(&launcher), None, &installed) else { panic!("not npm") };
        assert_eq!((npm.binary(), npm.prefix), (Some(binary), hoisted.0.join("usr")));
    }

    #[cfg(unix)]
    #[test]
    fn a_platform_package_after_an_update() {
        let dir = Dir::new("moved");
        let (launcher, binary) = npm_global(&dir, "prefix", false);
        let Install::Npm(npm) = detect(&binary, Some(&launcher), None, Path::new("/nonexistent/browse")) else { panic!("not npm") };
        // npm picked the other libc's package this time.
        std::fs::remove_dir_all(binary.parent().unwrap().parent().unwrap()).unwrap();
        assert_eq!(npm.binary(), None);
        let musl = dir.file(&format!("prefix/lib/node_modules/@opencode/browse/node_modules/@opencode/browse-linux-x64-musl/bin/{EXECUTABLE}"));
        assert_eq!(npm.binary(), cfg!(target_os = "linux").then_some(musl));
    }

    #[test]
    fn detects_the_other_installs() {
        let dir = Dir::new("kinds");
        let installed = dir.file("home/.local/bin/browse");
        assert_eq!(detect(&installed, None, None, &installed), Install::Binary(installed.clone()));
        // npx: a package in npm's temporary cache.
        let launcher = dir.file("home/.npm/_npx/4d2a/node_modules/@opencode/browse/dist/cli.mjs");
        let binary = dir.file(&format!("home/.npm/_npx/4d2a/node_modules/@opencode/browse-linux-x64/bin/{EXECUTABLE}"));
        assert_eq!(detect(&binary, Some(&launcher), None, &installed), Install::Npx);
        // A project's own node_modules: no global prefix to update.
        let launcher = dir.file("project/node_modules/@opencode/browse/dist/cli.mjs");
        let binary = dir.file(&format!("project/node_modules/@opencode/browse-linux-x64/bin/{EXECUTABLE}"));
        assert_eq!(detect(&binary, Some(&launcher), None, &installed), Install::Other);
        dir.file("checkout/rust/Cargo.toml");
        assert_eq!(detect(&dir.file("checkout/rust/target/debug/browse"), None, None, &installed), Install::Checkout);
        assert_eq!(detect(&dir.file("checkout/rust/target/x86_64-unknown-linux-musl/release/browse"), None, None, &installed), Install::Checkout);
        assert_eq!(detect(&dir.file("Downloads/browse"), None, None, &installed), Install::Other);
    }

    #[test]
    fn only_newer_versions() {
        assert!(!newer("0.0.17", "0.1.0"));
        assert!(!newer("0.1.0", "0.1.0"));
        assert!(newer("0.1.1", "0.1.0"));
        assert!(newer("0.1.0", "0.1.0-beta.3"));
        assert!(newer("0.1.0-beta.1", "0.1.0-dev.9"));
        assert!(newer("0.1.0-dev.2.1", "0.1.0-dev.2"));
        assert!(!newer("garbage", "0.1.0"));
        assert!(!newer("0.2.0", "local"));
    }
}
