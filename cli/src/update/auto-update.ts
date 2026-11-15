import { spawn, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, realpathSync, writeFileSync } from "node:fs"
import path from "node:path"
import { cliPrefix, compiledBinary, fromCheckout, installedBinary, stateRoot } from "../paths.ts"
import { opencodeBrowserVersion } from "../version.ts"
import type { ReleaseChannel } from "./release-service.ts"

export const PACKAGE_NAME = "@opencode/browse"
export const UPDATES_DISABLED = "此个人 fork 已禁用上游更新（disabled）；请按本地规则同步工作流维护、构建和安装。"

export const autoUpdateModes = ["on", "notify", "off"] as const
export type AutoUpdateMode = (typeof autoUpdateModes)[number]
export type Channel = "latest" | "dev" | "beta"
export type InstallKind = "binary" | "npm" | "npx" | "checkout" | "other"

/** 可识别的本地版本格式。 */
export const UPDATE_VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-(dev|beta)\.(\d+)(?:\.(\d+))?)?$/

export const channelOf = (version: string): Channel => (version.includes("-dev.") ? "dev" : version.includes("-beta.") ? "beta" : "latest")

/** Orders versions as semver does for these shapes: dev below beta below the release, then by run. Anything else never compares as newer. */
export function compareVersions(left: string, right: string): number {
  const parse = (value: string) => {
    const match = UPDATE_VERSION.exec(value)
    if (!match) return undefined
    const stage = match[4] === undefined ? 2 : match[4] === "beta" ? 1 : 0
    return [Number(match[1]), Number(match[2]), Number(match[3]), stage, Number(match[5] ?? 0), Number(match[6] ?? 0)]
  }
  const a = parse(left)
  const b = parse(right)
  if (!a || !b) return 0
  for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return a[index]! < b[index]! ? -1 : 1
  return 0
}

// ---- where this process runs from --------------------------------------------------------------------

/** What kind of install this process runs from. */
export function installKind(entry = process.argv[1] ?? "", checkout = fromCheckout()): InstallKind {
  if (checkout) return "checkout"
  if (compiledBinary()) return "binary"
  const normalized = entry.replaceAll("\\", "/")
  if (/\/_npx\/|\/npm-cache\/_npx\//.test(normalized)) return "npx"
  return entry ? "npm" : "other"
}

export type Runtime = {
  readonly kind: "binary" | "npm" | "npx"
  /** The stable path new processes start from: the executable, or the npm package's CLI bundle. */
  readonly entry: string
  /** The version this process runs. */
  readonly version: string
}

const packageVersion = (entry: string): string | undefined => {
  try {
    const manifest = path.join(path.dirname(path.dirname(entry)), "package.json")
    const version = (JSON.parse(readFileSync(manifest, "utf8")) as { version?: unknown }).version
    return typeof version === "string" ? version : undefined
  } catch {
    return undefined
  }
}

/** npm's bin is a symlink; the package manifest lives beside the real bundle. */
const realEntry = (entry: string) => {
  try {
    return realpathSync(entry)
  } catch {
    return entry
  }
}

/** The installed runtime this process belongs to, or undefined for a checkout or an uninstalled executable. */
export function installedRuntime(entry = process.argv[1] ?? process.execPath): Runtime | undefined {
  const kind = installKind(entry)
  if (kind === "binary") {
    const binary = installedBinary()
    if (binary) return { kind, entry: binary, version: opencodeBrowserVersion }
    // A downloaded executable run in place has nothing to update.
    return undefined
  }
  if (kind !== "npm" && kind !== "npx") return undefined
  const resolved = realEntry(entry)
  return { kind, entry: resolved, version: packageVersion(resolved) ?? opencodeBrowserVersion }
}

export async function updateTarget(runtime: Runtime, _run?: Run, _env?: NodeJS.ProcessEnv): Promise<Runtime | undefined> {
  return runtime
}

/** 供本地安装配置解析 npm 全局目录。 */
export async function npmGlobalRoot(run: Run = runCommand, env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  const result = await run("npm", ["root", "-g"], { timeoutMs: 20_000, env })
  const root = result.status === 0 ? result.stdout.trim() : ""
  return root && path.isAbsolute(root) ? root : undefined
}

/** The version currently on disk at the runtime's stable entry (a binary reports it with --version). */
export function installedVersion(runtime: Runtime): string | undefined {
  if (runtime.kind === "binary") {
    const result = spawnSync(runtime.entry, ["--version"], { encoding: "utf8", timeout: 15_000, env: { ...process.env, OPENCODE_BROWSER_AUTOSTART: "0" }, windowsHide: true })
    return result.status === 0 ? result.stdout.trim() || undefined : undefined
  }
  return packageVersion(runtime.entry)
}

// ---- state -------------------------------------------------------------------------------------------

export type AutoUpdateState = {
  readonly mode?: AutoUpdateMode
  readonly checkedAt?: number
  readonly latest?: string
  readonly latestAt?: number
  readonly etag?: string
  readonly failed?: string
  readonly lastUpdate?: { readonly from: string; readonly to: string; readonly at: string }
  readonly lastError?: { readonly message: string; readonly at: string; readonly version?: string; readonly attempts?: number }
  readonly installing?: { readonly version: string; readonly pid: number; readonly startedAt: number }
}

export const autoUpdateStatePath = () => path.join(stateRoot(), "auto-update.json")

function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T
  } catch {
    return undefined
  }
}

function writeJsonAtomic(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 })
  chmodSync(temporary, 0o600)
  renameSync(temporary, file)
}

export function readState(): AutoUpdateState {
  return readJson<AutoUpdateState>(autoUpdateStatePath()) ?? {}
}

export function updateState(change: (state: AutoUpdateState) => AutoUpdateState): AutoUpdateState {
  const next = change(readState())
  writeJsonAtomic(autoUpdateStatePath(), next)
  return next
}

// ---- settings -----------------------------------------------------------------------------------------

/** 解析既有环境设置；实际更新策略由 effectiveMode 决定。 */
export function autoUpdateOverride(env: NodeJS.ProcessEnv = process.env): AutoUpdateMode | undefined {
  const value = env.OPENCODE_BROWSER_AUTO_UPDATE?.trim().toLowerCase()
  if (value === "on" || value === "1" || value === "true") return "on"
  if (value === "notify") return "notify"
  if (value === "off" || value === "0" || value === "false") return "off"
  if (env.OPENCODE_BROWSER_UPDATE_CHECK === "0") return "off"
  return undefined
}

export function storedMode(): AutoUpdateMode {
  const mode = readState().mode
  return mode && (autoUpdateModes as readonly string[]).includes(mode) ? mode : "on"
}

export function effectiveMode(_env: NodeJS.ProcessEnv = process.env): AutoUpdateMode {
  return "off"
}

export function setStoredMode(mode: AutoUpdateMode) {
  updateState((state) => ({ ...state, mode }))
}

/** What status, the settings tool and the options page show about updates. */
export type AutoUpdateStatus = {
  readonly install: InstallKind
  /** The command that runs this install's CLI in a terminal (cliPrefix), for commands the options page shows. */
  readonly cli: string
  readonly mode: AutoUpdateMode
  readonly effective: AutoUpdateMode
  readonly overriddenBy?: string
  readonly version?: string
  readonly channel?: Channel
  readonly latest?: string
  readonly latestAt?: string
  readonly checkedAt?: string
  readonly lastUpdate?: AutoUpdateState["lastUpdate"]
  readonly lastError?: AutoUpdateState["lastError"]
}

export function autoUpdateStatus(options: { readonly env?: NodeJS.ProcessEnv; readonly runtime?: Runtime } = {}): AutoUpdateStatus {
  const runtime = options.runtime === undefined ? installedRuntime() : options.runtime
  const state = readState()
  const install = runtime?.kind ?? installKind()
  return {
    install,
    cli: cliPrefix(),
    mode: storedMode(),
    effective: "off",
    overriddenBy: "个人源码策略",
    ...(runtime ? { version: runtime.version, channel: channelOf(runtime.version) } : {}),
    ...(state.lastUpdate ? { lastUpdate: state.lastUpdate } : {}),
  }
}

/** One line for `status`. */
export function describeAutoUpdate(_status: AutoUpdateStatus): string {
  return "Updates:   disabled；请按本地规则同步工作流维护个人 fork"
}

export function updateAvailable(_status: Pick<AutoUpdateStatus, "install" | "latest" | "version">): boolean {
  return false
}

// ---- registry and installer ----------------------------------------------------------------------------

export type Run = (command: string, args: readonly string[], options?: { readonly timeoutMs?: number; readonly env?: NodeJS.ProcessEnv }) => Promise<{ status: number | null; stdout: string; stderr: string }>

/** 安装配置等模块共用的异步命令执行接口。 */
export const runCommand: Run = (command, args, options = {}) =>
  new Promise((resolve) => {
    // On Windows npm is npm.cmd, which Node only runs through a shell; run npm's own entry beside node.exe instead.
    const npmCli = process.platform === "win32" && command === "npm" ? path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js") : undefined
    const [file, argv] = npmCli && existsSync(npmCli) ? [process.execPath, [npmCli, ...args]] : [command, args]
    const child = spawn(file, argv, { env: options.env ?? process.env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => void (stdout += chunk))
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => void (stderr += chunk))
    const timer = setTimeout(() => child.kill(), options.timeoutMs ?? 120_000)
    child.on("error", (error) => {
      clearTimeout(timer)
      resolve({ status: null, stdout, stderr: stderr + error.message })
    })
    child.on("close", (status) => {
      clearTimeout(timer)
      resolve({ status, stdout, stderr })
    })
  })

export async function registryUrl(_run?: Run, _env?: NodeJS.ProcessEnv): Promise<string> {
  return ""
}

export type Published = { readonly version: string }

export async function fetchPublished(_options: { readonly registry: string; readonly channel: Channel; readonly fetch?: typeof fetch; readonly packageName?: string }): Promise<Published> {
  throw new Error(UPDATES_DISABLED)
}

export type InstallerOptions = {
  readonly runtime: Runtime
  readonly version?: string
  readonly channel?: Channel | ReleaseChannel
  readonly run?: Run
  readonly fetch?: typeof fetch
  readonly env?: NodeJS.ProcessEnv
  readonly platform?: NodeJS.Platform
  readonly installer?: string
}

export async function runInstaller(_options: InstallerOptions): Promise<string> {
  throw new Error(UPDATES_DISABLED)
}

/** Whether a process still runs. */
export function processAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

// ---- the relay's updater -------------------------------------------------------------------------------------

export type AutoUpdaterDeps = {
  readonly runtime: Runtime
  /** No agent is using the browser: nothing in flight, no capture, recording, handoff or raw client, and quiet for a while. */
  readonly isIdle: () => boolean
  readonly log: (event: string, fields?: Record<string, unknown>) => void
  readonly onChange?: () => void
  readonly spawnChild?: (args: readonly string[], onExit: (code: number | null) => void, from: Runtime) => number | undefined
  readonly env?: NodeJS.ProcessEnv
  readonly fetch?: typeof fetch
  readonly run?: Run
  readonly now?: () => number
}

export function createAutoUpdater(_deps: AutoUpdaterDeps) {
  return {
    async tick(): Promise<void> {},
    start(_intervalMs?: number) {},
    stop() {},
  }
}

export function spawnRuntimeChild(_runtime: Runtime, _args: readonly string[], _onExit: (code: number | null) => void, _env: NodeJS.ProcessEnv = process.env): number | undefined {
  return undefined
}
