import { describe, expect, test } from "bun:test"
import { cachedUpdateCheck, checkForUpdate, createUpdateWatcher, gitIn, npmUpdateNotice, runUpdate, updateCheckEnabled, updateJson, updateNotice } from "../src/update.ts"

const forbidden = () => { throw new Error("离线更新策略不应执行外部操作") }

describe("个人 fork 的离线更新策略", () => {
  test("手动和缓存检查均不调用 git", async () => {
    expect(updateCheckEnabled()).toBe(false)
    expect(await checkForUpdate("/checkout", forbidden)).toBeUndefined()
    expect(await cachedUpdateCheck({ repo: "/checkout", dataDir: "/unused", git: forbidden })).toBeUndefined()
    expect(await gitIn("/checkout")(["ls-remote", "origin"])).toBeUndefined()
    expect(await updateNotice({ repo: "/checkout", git: forbidden })).toBeUndefined()
    expect(npmUpdateNotice()).toBeUndefined()
    expect(updateJson(await updateNotice())).toBeNull()
  })

  test("后台 watcher 不执行注入的检查或通知回调", async () => {
    const watcher = createUpdateWatcher({ check: forbidden, onChange: forbidden, now: forbidden })
    await watcher.refresh()
    await watcher.refresh()
    expect(watcher.current).toBeUndefined()
  })

  test("所有安装类型的手动更新只输出本地同步指引", () => {
    for (const repo of [undefined, "/checkout"]) {
      const lines: string[] = []
      expect(runUpdate([], { repo, log: (line) => lines.push(line), git: forbidden, hasBun: forbidden, setup: forbidden })).toBe(0)
      expect(lines.join("\n")).toContain("本地规则同步工作流")
      expect(lines.join("\n")).toContain("disabled")
      expect(lines.join("\n")).not.toMatch(/git pull|npm install|npx /)
    }
  })

  test("--check 明确返回禁用且无更新", () => {
    const lines: string[] = []
    expect(runUpdate(["--check"], { repo: "/checkout", log: (line) => lines.push(line), git: forbidden })).toBe(0)
    expect(lines.join("\n")).toContain("无可用更新")
    expect(lines.join("\n")).toContain("disabled")
  })
})
