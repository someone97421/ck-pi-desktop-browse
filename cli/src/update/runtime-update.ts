import { Effect } from "effect"
import { installedRuntime, installedVersion, UPDATES_DISABLED, type Runtime } from "./auto-update.ts"
import { runUpdate } from "../update.ts"
import * as RelayClient from "../relay/client.ts"
import * as RelayLifecycle from "../relay/lifecycle.ts"

const log = (line: string) => process.stdout.write(line + "\n")

/** What a switch did: which relay it replaced, and why it was refused. */
export type SwitchResult = {
  /**
   * The version the replaced relay reported about itself. The child runs the build now on disk, so its own
   * `Runtime.version` is the new one; only the running relay knows which version is actually being replaced.
   */
  readonly from?: string
  /** Why the restart was refused; undefined when it restarted (or no relay was running). */
  readonly refused?: string
}

/**
 * Restarts the relay from the install's stable entry once `version` is on disk. `refused` is undefined when it
 * restarted (or no relay was running). Nothing on disk moves, so a refused restart leaves the old relay running.
 */
export async function switchTo(runtime: Runtime, version: string, options: { readonly force: boolean }): Promise<SwitchResult> {
  const installed = installedVersion(runtime)
  if (!installed) return { refused: `${runtime.entry} doesn't report a version` }
  if (installed !== version) return { refused: `${version} isn't installed` }
  let from: string | undefined
  const program = Effect.gen(function* () {
    const relay = yield* RelayClient.Service
    const running = yield* Effect.result(relay.version)
    // No relay: nothing to drain or mix with.
    if (running._tag === "Failure") return {} satisfies SwitchResult
    from = running.success.version
    yield* RelayLifecycle.restartRelay({
      relay,
      clientKind: "cli",
      force: options.force,
      otherBuild: true,
      start: RelayLifecycle.startManagedRelay(runtime.entry),
    })
    // Another relay can start in the gap (an old MCP server's next call); it must be the new version.
    const now = yield* relay.version
    return (now.version === installed ? { from } : { from, refused: `a relay of version ${now.version} started first` }) satisfies SwitchResult
  }).pipe(Effect.provide(RelayClient.layerFetch))
  const refusal = (error: unknown): SwitchResult => ({
    ...(from === undefined ? {} : { from }),
    refused: (error as Error).message ?? String(error),
  })
  return Effect.runPromise(program.pipe(Effect.catch((error) => Effect.succeed(refusal(error)))))
}

export async function runInstalledUpdate(args: readonly string[], runtime = installedRuntime()) {
  if (!runtime) return false
  process.exitCode = runUpdate(args, { repo: undefined, log })
  return true
}

export async function runSelfUpdate(_args: readonly string[], _runtime = installedRuntime()) {
  log(UPDATES_DISABLED)
  process.exitCode = 1
}

/** `runtime-switch <version>`: the relay's switch child. Exit 1 when the relay refused (nothing changed). */
export async function runRuntimeSwitch(args: readonly string[]) {
  const runtime = installedRuntime()
  if (!runtime) {
    log("runtime-switch: not an installed runtime")
    process.exitCode = 2
    return
  }
  const version = args[0] ?? installedVersion(runtime)
  if (!version) {
    process.exitCode = 2
    return
  }
  const { from, refused } = await switchTo({ ...runtime, version }, version, { force: false })
  // This child starts from the stable entry, which an installer may already have replaced with `version`, so its own
  // runtime.version is the new build: the relay it drained reported the version actually being replaced.
  const before = from ?? runtime.version
  log(`${new Date().toISOString()} switch ${before} → ${version}: ${refused ? `refused (${refused})` : "done"}`)
  if (refused) process.exitCode = 1
}

/** Kept for the old name used by tests and internal callers. */
export const runNpmUpdate = runInstalledUpdate
