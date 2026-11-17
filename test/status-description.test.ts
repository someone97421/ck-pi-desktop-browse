import { describe, expect, test } from "bun:test"
import type { AgentRelayState } from "../src/shared/protocol"
import { browserStatusText, describeStatus, richParts } from "../src/status/describe"

const state = (overrides: Partial<AgentRelayState> = {}): AgentRelayState => ({
  status: "unpaired", pairing: "none", tabs: [],
  relay: { address: "localhost:19988", remote: false }, ...overrides,
})

describe("主程序专用连接提示", () => {
  test("未连接时引导打开侧栏自动连接", () => {
    for (const current of [undefined, state(), state({ status: "offline" }), state({ status: "untrusted" })]) {
      expect(describeStatus(current)).toContain("打开侧栏")
      expect(describeStatus(current)).not.toMatch(/browse pair|安装命令|MCP 客户端/)
    }
  })

  test("旧远程中继不能被显示为主程序调试已连接", () => {
    const remote = state({ status: "connected", relay: { address: "devbox:19988", remote: true } })
    expect(browserStatusText(remote)).toContain("等待切换")
    expect(describeStatus(remote)).toContain("主程序提供的本机调试服务")
    expect(browserStatusText(remote, false)).toBe("浏览器调试已连接")
    expect(describeStatus(remote, false)).not.toContain("改用")
  })

  test("协议不兼容时指向对应产品更新", () => {
    expect(describeStatus(state({ status: "incompatible", skew: "update-cli" }))).toContain("更新并重启「这是一个助手」")
    expect(describeStatus(state({ status: "incompatible", skew: "update-extension" }))).toContain("本扩展仓库")
    expect(describeStatus(state({ status: "incompatible" }))).toContain("主程序和本扩展")
  })

  test("保留标签页使用状态和富文本分段", () => {
    expect(describeStatus(state({ status: "connected", tabs: [{ tabId: 3 }] }))).toContain("1 个标签页")
    expect(richParts("run `pair` there")).toEqual([
      { code: false, text: "run " }, { code: true, text: "pair" }, { code: false, text: " there" },
    ])
  })
})
