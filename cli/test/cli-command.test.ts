import { describe, expect, test } from "bun:test"
import path from "node:path"
import { cliCommand, cliPrefix } from "../src/paths.ts"

describe("the command people type to run browse", () => {
  const binary = path.join("/home/u/.local/bin", "browse")

  test("a binary install on PATH is just browse", () => {
    const pathEnv = ["/usr/bin", path.dirname(binary)].join(path.delimiter)
    expect(cliCommand("update", { kind: "binary", binary, pathEnv })).toBe("browse update")
  })

  test("a binary install off PATH names the executable", () => {
    expect(cliPrefix({ kind: "binary", binary, pathEnv: "/usr/bin" })).toBe(binary)
  })

  test("a global npm install runs browse from PATH", () => {
    expect(cliCommand("pair", { kind: "npm", version: "0.0.8" })).toBe("browse pair")
  })

  test("npx 安装使用当前本地入口，不调用公共包", () => {
    const entry = process.argv[1]
    try {
      process.argv[1] = "/local/fork/cli.mjs"
      const node = /^[\w@%+=:,./-]+$/.test(process.execPath) ? process.execPath : JSON.stringify(process.execPath)
      expect(cliCommand("pair", { kind: "npm", version: "0.0.8", npx: true })).toBe(`${node} /local/fork/cli.mjs pair`)
      expect(cliCommand("pair", { kind: "npm", version: "0.0.9-dev.12", npx: true })).toBe(`${node} /local/fork/cli.mjs pair`)
    } finally {
      if (entry === undefined) delete process.argv[1]
      else process.argv[1] = entry
    }
  })
})
