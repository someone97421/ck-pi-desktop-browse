// Where browse keeps its files, on every OS (the same scheme opencode uses on macOS):
//   config  $XDG_CONFIG_HOME/browse      settings.json, config.json
//   data    $XDG_DATA_HOME/browse        session catalogs, relay token, paired browsers
//   state   $XDG_STATE_HOME/browse       logs, journals, current session, pairing codes, update state
//   cache   $XDG_CACHE_HOME/browse       update checks and the dev extension (re-creatable)
//   bin     $XDG_BIN_HOME              the installer's executable (XDG_BIN_HOME, else ~/.local/bin)// Unset variables fall back to ~/.config, ~/.local/share, ~/.local/state, ~/.cache and ~/.local/bin;
// Windows uses the same paths under %USERPROFILE%. OPENCODE_BROWSER_HOME overrides all of them for isolated
// test relays (the executable then lives in <root>/bin).
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const override = (home: string) =>
  home === os.homedir() && process.env.OPENCODE_BROWSER_HOME ? process.env.OPENCODE_BROWSER_HOME : undefined

const xdgRoot = (variable: string, fallback: string, home: string) => {
  const configured = home === os.homedir() ? process.env[variable] : undefined
  return path.join(configured && path.isAbsolute(configured) ? configured : path.join(home, fallback), "browse")
}

/** The config folder without the OPENCODE_BROWSER_HOME override: where an everyday install keeps its settings. */
function defaultConfigRoot(home = os.homedir()): string {
  return xdgRoot("XDG_CONFIG_HOME", ".config", home)
}

/** Browse's XDG folders without the OPENCODE_BROWSER_HOME override: an everyday install still writes them. */
export function defaultRoots(home = os.homedir()): {
  readonly config: string
  readonly data: string
  readonly state: string
  readonly cache: string
} {
  return {
    config: defaultConfigRoot(home),
    data: xdgRoot("XDG_DATA_HOME", ".local/share", home),
    state: xdgRoot("XDG_STATE_HOME", ".local/state", home),
    cache: xdgRoot("XDG_CACHE_HOME", ".cache", home),
  }
}

export function configRoot(home = os.homedir()): string {
  return override(home) ?? defaultConfigRoot(home)
}

export function dataRoot(home = os.homedir()): string {
  return override(home) ?? xdgRoot("XDG_DATA_HOME", ".local/share", home)
}

export function stateRoot(home = os.homedir()): string {
  return override(home) ?? xdgRoot("XDG_STATE_HOME", ".local/state", home)
}

export function cacheRoot(home = os.homedir()): string {
  return override(home) ?? xdgRoot("XDG_CACHE_HOME", ".cache", home)
}

/** The installers' folder: $XDG_BIN_HOME when absolute, else ~/.local/bin (the same on Windows under %USERPROFILE%). */
function installerBinRoot(home = os.homedir()): string {
  const configured = home === os.homedir() ? process.env.XDG_BIN_HOME : undefined
  return configured && path.isAbsolute(configured) ? configured : path.join(home, ".local", "bin")
}

/** The executable's folder: $OPENCODE_BROWSER_HOME/bin when that override is set, else the installers' folder. */
export function binRoot(home = os.homedir()): string {
  if (override(home)) return path.join(override(home)!, "bin")
  return installerBinRoot(home)
}

/** The executable agents run: $OPENCODE_BROWSER_HOME/bin when set, else the installers' folder. */
export const installedBinaryPath = (home = os.homedir()) => path.join(binRoot(home), binaryName())

/** The executable the installers wrote, independent of where OPENCODE_BROWSER_HOME points the CLI. */
export const installerBinaryPath = (home = os.homedir()) => path.join(installerBinRoot(home), binaryName())

/** An everyday install's settings, independent of where OPENCODE_BROWSER_HOME points the CLI. */
export const defaultSettingsPath = (home = os.homedir()) => path.join(defaultConfigRoot(home), "settings.json")

/** This package's root: cli/ in a checkout (src/paths.ts, or the dist/cli.mjs bundle), else the installed package. */
const packageRoot = () => path.dirname(path.dirname(fileURLToPath(import.meta.url)))

// The store's v0.0.2 never dials a relay without a long code. Install records that it saw this build;
// the relay can then explain the mismatch even though it received no hello. A new install/hello clears it.
export const oldStoreMarker = () => path.join(stateRoot(), "old-store-extension")

/** Running from a source checkout (the sources are next to the bundle), not the published npm package. */
export function fromCheckout(): boolean {
  return !compiledBinary() && fs.existsSync(path.join(packageRoot(), "src", "main.ts"))
}

/** A standalone executable (script/compile.ts), which the install script puts in ~/.local/bin; not Node and npm. */
export const compiledBinary = (): boolean => globalThis.__OPENCODE_BROWSER_COMPILED__ === true

/** The npm package that carries this executable's platform build, e.g. @opencode/browse-darwin-arm64. */
export const binaryPackage = (): string | undefined =>
  globalThis.__OPENCODE_BROWSER_TARGET__ ? `@opencode/browse-${globalThis.__OPENCODE_BROWSER_TARGET__}` : undefined

/** The executable's file name in its package (package/bin/) and in an installed version's directory. */
export const binaryName = (platform: NodeJS.Platform = process.platform) => (platform === "win32" ? "browse.exe" : "browse")

/** A CLI entry Node runs (a bundle or source file), as opposed to an executable that runs by itself. */
export const scriptEntry = (entry: string) => /\.[cm]?[jt]s$/.test(entry)

/** The command that runs the CLI at `entry`: `<node> <entry>` for a script, the executable itself otherwise. */
export const entryCommand = (entry: string, node = process.execPath): string[] => (scriptEntry(entry) ? [node, entry] : [entry])

/** What Node can't start on Windows without a shell: a bare command name, or a .cmd/.bat shim. */
const windowsShellShim = (entry: string, pathModule: typeof path.win32) =>
  /\.(cmd|bat)$/i.test(entry) ||
  (pathModule.extname(entry) === "" && !pathModule.isAbsolute(entry) && !/[\\/]/.test(entry))

/** A path under npm's npx cache, which npx may replace or evict. */
const npxEntry = (entry: string) => /(^|\/)_npx\//.test(entry.replaceAll("\\", "/"))

export type EntrySpawnOptions = {
  readonly platform?: NodeJS.Platform
  /** The CLI this process runs (runningEntry by default). */
  readonly running?: string
  /** Whether this process is a compiled executable (compiledBinary by default). */
  readonly compiled?: boolean
  /** Whether this process runs from a source checkout (fromCheckout by default). */
  readonly checkout?: boolean
  /** Windows path rules; tests inject path.win32. */
  readonly pathModule?: typeof path.win32
  /** Where PATH comes from; tests inject a fake environment. */
  readonly env?: NodeJS.ProcessEnv
  /** The filesystem check; tests inject a fake. */
  readonly existsSync?: (file: string) => boolean
}

/**
 * The installed browse CLI a Windows shim entry runs, found with filesystem checks only. For a bare name (or a bare
 * .cmd/.bat) walk PATH in order; for an explicit .cmd/.bat path use its folder. npm's global prefix puts its shims and
 * node_modules side by side, so the bundle is <folder>\node_modules\@opencode\browse\dist\cli.mjs.
 */
export function resolveWindowsShim(
  entry: string,
  node = process.execPath,
  options: Pick<EntrySpawnOptions, "pathModule" | "env" | "existsSync"> = {},
): string[] | undefined {
  const pathModule = options.pathModule ?? path.win32
  const exists = options.existsSync ?? fs.existsSync
  if (!windowsShellShim(entry, pathModule)) return undefined
  const shimmed = /\.(cmd|bat)$/i.test(entry)
  const withFolder = shimmed && (pathModule.isAbsolute(entry) || /[\\/]/.test(entry))
  const directories = withFolder
    ? [pathModule.dirname(entry)]
    : (options.env ?? process.env).PATH?.split(";")
        .map((directory) => directory.trim().replace(/^"(.*)"$/, "$1"))
        .filter(Boolean) ?? []
  for (const directory of directories) {
    if (!shimmed) {
      const executable = pathModule.join(directory, `${entry}.exe`)
      if (exists(executable)) return [executable]
    }
    const shim = withFolder ? entry : pathModule.join(directory, shimmed ? entry : `${entry}.cmd`)
    if (!exists(shim)) continue
    const script = pathModule.join(directory, "node_modules", "@opencode", "browse", "dist", "cli.mjs")
    if (exists(script)) return [node, script]
  }
  return undefined
}

/**
 * The command this process starts to run the CLI again at `entry`. A Windows npm install records itself as a bare
 * `browse` shim, which child_process can't start without a shell: resolve the installed CLI through PATH first. If
 * nothing installed resolves, use this process's script unless it is an npx copy or a source checkout; a compiled
 * binary never falls back to itself. Other platforms keep the old behavior.
 */
export function entrySpawnCommand(
  entry: string,
  node = process.execPath,
  options: EntrySpawnOptions = {},
): string[] {
  if (scriptEntry(entry)) return [node, entry]
  const pathModule = options.pathModule ?? path.win32
  if ((options.platform ?? process.platform) !== "win32" || !windowsShellShim(entry, pathModule)) return [entry]
  const resolved = resolveWindowsShim(entry, node, options)
  if (resolved) return resolved
  const running = options.running ?? runningEntry()
  const compiled = options.compiled ?? compiledBinary()
  const checkout = options.checkout ?? fromCheckout()
  return !compiled && !checkout && scriptEntry(running) && !npxEntry(running) ? [node, running] : [entry]
}

/** The executable a binary install put on PATH, when it is there. */
export function installedBinary(): string | undefined {
  const binary = installedBinaryPath()
  return fs.existsSync(binary) ? binary : undefined
}

/** This process's own CLI entry: the executable, or the script Node runs. */
export const runningEntry = (): string => (compiledBinary() ? process.execPath : process.argv[1]!)

/** The git clone this runs from (the folder above cli/), or undefined for the published package. */
export function checkoutRoot(): string | undefined {
  return fromCheckout() ? path.dirname(packageRoot()) : undefined
}

const quoted = (value: string) => (/^[\w@%+=:,./-]+$/.test(value) ? value : JSON.stringify(value))

/** How this CLI was installed, for the command a person types to run it (cliPrefix). */
export type CliInstall =
  | { readonly kind: "binary"; readonly binary: string; readonly pathEnv?: string | undefined }
  | { readonly kind: "npm"; readonly version?: string | undefined; readonly npx?: boolean | undefined }
  | { readonly kind: "checkout"; readonly bundle: string }

export function cliInstall(): CliInstall {
  if (compiledBinary()) return { kind: "binary", binary: installedBinary() ?? process.execPath, pathEnv: process.env.PATH }
  if (fromCheckout()) return { kind: "checkout", bundle: path.join(packageRoot(), "dist", "cli.mjs") }
  return { kind: "npm", version: globalThis.__OPENCODE_BROWSER_VERSION__, npx: /[/\\]_npx[/\\]/.test(process.argv[1] ?? "") }
}

/** 安装后的本地 CLI 命令；npx 副本使用当前入口。 */
export function cliPrefix(install: CliInstall = cliInstall()): string {
  if (install.kind === "binary") {
    const dir = path.dirname(install.binary)
    const onPath = (install.pathEnv ?? "").split(path.delimiter).some((entry) => entry && path.resolve(entry) === dir)
    return onPath ? "browse" : quoted(install.binary)
  }
  if (install.kind === "checkout") return `node ${quoted(install.bundle)}`
  if (install.npx) return entryCommand(runningEntry()).map(quoted).join(" ")
  return "browse"
}

/** How to tell the user to run `browse <args>` (cliPrefix). */
export const cliCommand = (args: string, install: CliInstall = cliInstall()): string => `${cliPrefix(install)} ${args}`

declare global {
  // 构建注入的商店配置和本地开发扩展元数据。
  var __OPENCODE_BROWSER_STORE__: { readonly id?: string } | undefined
  var __OPENCODE_BROWSER_EXTENSION__: DevExtension | undefined
}

/** A Chrome Web Store extension ID: 32 letters a to p. */
const STORE_ITEM_ID = /^[a-p]{32}$/

/**
 * 可选的 Chrome Web Store 标识。A checkout, or a package
 * built without one, still points users at this item: every channel installs browse from the store.
 */
export const PUBLIC_STORE_ID = "mfnicocicmmlkpjnaffgihfjhdgjkdjg"

export type StoreConfig = {
  /** The public store item, when the release that built this package was configured with one. */
  readonly id?: string
}

/**
 * The Chrome Web Store item this install knows. The published package carries the ID the release workflow baked in
 * (OPENCODE_BROWSER_STORE_ID at build time); the same variable at run time overrides it (testing a store build from a
 * checkout). Nothing else is trusted as a store ID: install sends the pairing code to the extension with this ID.
 * 源码 checkout 加载本地 dist/，开发构建使用本地维护的扩展。
 */
export function storeConfig(env: NodeJS.ProcessEnv = process.env, baked = globalThis.__OPENCODE_BROWSER_STORE__): StoreConfig {
  const id = [env.OPENCODE_BROWSER_STORE_ID, baked?.id].find((value) => value && STORE_ITEM_ID.test(value))
  return id ? { id } : {}
}

/** 开发构建携带的扩展元数据。 */
export type DevExtension = { readonly file: string; readonly sha256: string; readonly size: number }

export const RELEASE_SERVICE = ""

/** The dev extension this package was built with; undefined for stable releases and checkouts. */
export function devExtension(baked = globalThis.__OPENCODE_BROWSER_EXTENSION__): DevExtension | undefined {
  return baked && /^[0-9a-f]{64}$/.test(baked.sha256) && /^[\w.-]+\.zip$/.test(baked.file) ? baked : undefined
}

export const devExtensionUrl = (_extension: DevExtension, _env: NodeJS.ProcessEnv = process.env): string => {
  throw new Error("此个人 fork 已禁用开发扩展远程下载（disabled）；请按本地规则同步工作流维护本地扩展。")
}

/** 本地开发扩展的目录。 */
export const devExtensionFolder = (root = cacheRoot()) => path.join(root, "extension")

/** The store page of an item. */
export const storeUrl = (id: string) => `https://chromewebstore.google.com/detail/${id}`

/** How to tell the user to install (or update) browse. */
export function installCommand(): string {
  return fromCheckout() ? `cd ${quoted(path.dirname(packageRoot()))} && bun run setup` : cliCommand("install")
}
