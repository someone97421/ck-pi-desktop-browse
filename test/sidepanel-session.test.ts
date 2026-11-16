import { afterEach, expect, test } from "bun:test"
import { isLoopbackOrigin } from "../src/sidepanel/config"
import { extensionSession } from "../src/sidepanel/session"

const originalFetch = globalThis.fetch
const requests: Array<{ url: string; init?: RequestInit }> = []
afterEach(() => { globalThis.fetch = originalFetch; requests.length = 0 })
function reply(body: unknown, status = 200) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), init })
    return Response.json(body, { status })
  }) as typeof fetch
}

test("只有 loopback 地址允许扩展会话，跨机地址不会发送请求", async () => {
  for (const origin of ["http://127.0.0.1:7878", "http://127.0.0.2:7878", "https://localhost:7878", "http://[::1]:7878"]) expect(isLoopbackOrigin(origin)).toBe(true)
  reply({ ok: true, result: { token: "test-session" } })
  for (const origin of ["http://192.168.1.8:7878", "http://localhost.example:7878", "http://128.0.0.1:7878"]) {
    expect(isLoopbackOrigin(origin)).toBe(false)
    await expect(extensionSession(origin)).rejects.toThrow("主机密码")
  }
  expect(requests).toHaveLength(0)
})

test("本机使用 JSON POST 读取 result.token，不携带凭据或允许重定向", async () => {
  reply({ ok: true, result: { token: "test-session", deviceId: "extension-device" } })
  expect(await extensionSession("http://127.0.0.1:7878")).toBe("test-session")
  expect(requests).toHaveLength(1)
  expect(requests[0]).toMatchObject({ url: "http://127.0.0.1:7878/api/extension-session", init: {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", credentials: "omit", cache: "no-store", redirect: "error",
  } })
  expect(requests[0]!.init!.signal).toBeInstanceOf(AbortSignal)
})

test("拒绝服务端失败、非 JSON 和缺失令牌", async () => {
  reply({ ok: false, error: "扩展来源未允许" }, 403)
  await expect(extensionSession("http://localhost:7878")).rejects.toThrow("扩展来源未允许")
  for (const body of [null, {}, { ok: true }, { ok: true, result: { token: " " } }]) {
    reply(body)
    await expect(extensionSession("http://localhost:7878")).rejects.toThrow()
  }
  globalThis.fetch = (async () => new Response("not-json")) as unknown as typeof fetch
  await expect(extensionSession("http://localhost:7878")).rejects.toThrow()
})
