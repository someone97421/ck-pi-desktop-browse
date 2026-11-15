import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { autoUpdateModes, autoUpdateStatus, channelOf, compareVersions, createAutoUpdater, describeAutoUpdate, effectiveMode, fetchPublished, installKind, readState, runInstaller, setStoredMode, spawnRuntimeChild, updateAvailable, updateState, type Runtime } from "../src/update/auto-update.ts"
import { checkRelease, fetchManifest, releaseService } from "../src/update/release-service.ts"
import { runUpdate } from "../src/update.ts"

const previousHome = process.env.OPENCODE_BROWSER_HOME
const roots: string[] = []
afterEach(() => {
  if (previousHome === undefined) delete process.env.OPENCODE_BROWSER_HOME
  else process.env.OPENCODE_BROWSER_HOME = previousHome
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})
const isolatedState = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "browse-offline-update-"))
  roots.push(root)
  process.env.OPENCODE_BROWSER_HOME = root
}
const forbidden = () => { throw new Error("离线更新策略不应执行外部操作") }
const runtime: Runtime = { kind: "binary", entry: "/unused/browse", version: "0.1.0-dev.1" }
const env = { OPENCODE_BROWSER_AUTO_UPDATE: "on", OPENCODE_BROWSER_UPDATE_CHECK: "1", OPENCODE_BROWSER_RELEASE_SERVICE: "https://example.invalid/release" }

describe("个人 fork 的自动更新策略", () => {
  test("保留设置与历史结构，有效模式固定 off", () => {
    isolatedState()
    const history = { checkedAt: 1, latest: "99.0.0", etag: "old", installing: { version: "99.0.0", pid: 123, startedAt: 1 }, lastError: { message: "旧错误", at: "2020-01-01T00:00:00Z" } }
    updateState(() => history)
    for (const mode of autoUpdateModes) {
      setStoredMode(mode)
      expect(readState()).toEqual({ ...history, mode })
      expect(effectiveMode(env)).toBe("off")
      for (const kind of ["binary", "npm", "npx"] as const) {
        const status = autoUpdateStatus({ runtime: { ...runtime, kind }, env })
        expect(status.mode).toBe(mode)
        expect(status.effective).toBe("off")
        expect(status.latest).toBeUndefined()
        expect(describeAutoUpdate(status)).toContain("disabled")
        expect(updateAvailable({ install: kind, version: runtime.version, latest: "99.0.0" })).toBe(false)
      }
    }
    expect(runUpdate(["--mode", "on"], { repo: undefined, log: () => {} })).toBe(0)
    expect(readState().mode).toBe("on")
    expect(effectiveMode(env)).toBe("off")
  })

  test("后台入口不调用网络、命令、子进程或活动检查", async () => {
    const updater = createAutoUpdater({ runtime, env, isIdle: forbidden, log: forbidden, onChange: forbidden, spawnChild: forbidden, fetch: forbidden, run: forbidden, now: forbidden })
    updater.start(1)
    await updater.tick()
    updater.stop()
    expect(spawnRuntimeChild(runtime, ["self-update", "99.0.0"], forbidden, env)).toBeUndefined()
  })

  test("安装与发布查询不能借助环境变量重新启用联网", async () => {
    for (const kind of ["binary", "npm", "npx"] as const) {
      await expect(runInstaller({ runtime: { ...runtime, kind }, env, run: forbidden, fetch: forbidden, installer: "exit 99" })).rejects.toThrow("disabled")
    }
    await expect(fetchPublished({ registry: "https://example.invalid", channel: "dev", fetch: forbidden })).rejects.toThrow("disabled")
    const options = { version: runtime.version, channel: "dev" as const, target: "macos-arm64", service: env.OPENCODE_BROWSER_RELEASE_SERVICE, fetch: forbidden }
    expect(await fetchManifest(options)).toEqual({ status: "missing" })
    expect(await checkRelease(options)).toEqual({ status: "missing" })
    expect(releaseService(env)).toBe("")
  })

  test("版本比较与安装识别仍供其他模块使用", () => {
    expect(channelOf(runtime.version)).toBe("dev")
    expect(compareVersions("0.1.0", "0.1.0-dev.1")).toBe(1)
    expect(installKind("/checkout/cli.mjs", true)).toBe("checkout")
    expect(installKind("/home/.npm/_npx/x/cli.mjs", false)).toBe("npx")
  })
})
