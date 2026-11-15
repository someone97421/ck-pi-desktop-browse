import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { devExtensionRecord, installedDevExtension, syncDevExtension } from "../src/setup/dev-extension.ts"
import { devExtensionFolder, devExtensionUrl, RELEASE_SERVICE, type DevExtension } from "../src/paths.ts"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})
const temporaryRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "browse-offline-extension-"))
  roots.push(root)
  return root
}
const extension: DevExtension = { file: "extension.zip", sha256: "a".repeat(64), size: 10 }
const forbidden = () => { throw new Error("禁止下载扩展") }
const env = { OPENCODE_BROWSER_RELEASE_SERVICE: "https://example.invalid/release" }

describe("本地开发扩展", () => {
  test("清除默认上游地址且拒绝生成下载链接", () => {
    expect(RELEASE_SERVICE).toBe("")
    expect(() => devExtensionUrl(extension, env)).toThrow("disabled")
  })

  test("缺少扩展时不下载、不生成配对或扩展文件", async () => {
    const root = temporaryRoot()
    await expect(syncDevExtension(extension, { root, fetch: forbidden, env, port: 19988 })).rejects.toThrow("本地规则同步工作流")
    expect(fs.readdirSync(root)).toEqual([])
    expect(installedDevExtension(root)).toBeUndefined()
  })

  test("已有扩展仍可识别，既有配对与记录不变", async () => {
    const root = temporaryRoot()
    const folder = devExtensionFolder(root)
    fs.mkdirSync(folder)
    fs.writeFileSync(path.join(folder, "manifest.json"), JSON.stringify({ manifest_version: 3, version: "0.1.0" }))
    const pairing = '{"port":19988,"code":"EXISTING"}\n'
    fs.writeFileSync(path.join(folder, "relay-pairing.json"), pairing)
    const record = { file: extension.file, sha256: extension.sha256, installedAt: "2020-01-01T00:00:00Z" }
    fs.writeFileSync(devExtensionRecord(root), JSON.stringify(record))
    expect(installedDevExtension(root)).toEqual(record)
    expect(await syncDevExtension(extension, { root, fetch: forbidden, env })).toBe("current")
    await expect(syncDevExtension({ ...extension, sha256: "b".repeat(64) }, { root, fetch: forbidden, env })).rejects.toThrow("disabled")
    expect(installedDevExtension(root)).toEqual(record)
    expect(fs.readFileSync(path.join(folder, "relay-pairing.json"), "utf8")).toBe(pairing)
  })
})
