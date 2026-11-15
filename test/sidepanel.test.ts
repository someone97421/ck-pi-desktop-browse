import { describe, expect, test } from "bun:test"
import { browserContext, needsPairing, pairingAddress } from "../src/sidepanel/context"
import { DEFAULT_SERVER_ORIGIN, normalizeServerOrigin } from "../src/sidepanel/config"

describe("侧边栏连接上下文", () => {
  test("缺省连接唯一的局域网远控服务 7878", () => {
    expect(DEFAULT_SERVER_ORIGIN).toBe("http://127.0.0.1:7878")
  })
  test("标题和 URL 中的换行、引号不能破坏当前页上下文", () => {
    const text = browserContext({ tabId: 42, title: '登录 "页面"\n下一行', url: 'https://example.test/?q="x"' })
    expect(text).toContain('tab=42, title="登录 \\"页面\\"\\n下一行"')
    expect(text).toContain('url="https://example.test/?q=\\"x\\""')
    expect(text.split("\n")).toHaveLength(1)
  })
  test("不会重新签发已连接、冲突或版本不兼容的 Relay", () => {
    for (const status of ["offline", "connected", "connecting", "conflict", "incompatible"] as const) expect(needsPairing(status)).toBe(false)
    for (const status of ["unpaired", "untrusted"] as const) expect(needsPairing(status)).toBe(true)
  })
  test("配对使用 CLI 返回的 loopback endpoint，不跟随 Harness 私网地址", () => {
    expect(pairingAddress("http://127.0.0.1:19989", 19989)).toBe("127.0.0.1:19989")
    expect(() => pairingAddress("http://127.0.0.1:7878", 0)).toThrow()
  })
  test("服务地址可规范化，拒绝凭据及路径混入", () => {
    expect(normalizeServerOrigin(" http://localhost:7878/ ")).toBe("http://localhost:7878")
    for (const origin of ["file:///tmp/x", "http://user:pass@localhost:7878", "http://localhost:7878/api", "http://localhost:7878/?key=x"])
      expect(() => normalizeServerOrigin(origin)).toThrow()
  })
})
