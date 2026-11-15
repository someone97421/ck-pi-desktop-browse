import { afterAll, expect, test } from "bun:test"
import { StubEvent } from "../chrome-stub"
import type { AgentRelayState } from "../../src/shared/protocol"

class Element extends EventTarget {
  textContent = ""; title = ""; value = ""; src = ""
  hidden = false; disabled = false; checked = false; dataset: Record<string, string> = {}
  focus() {}
}
const nodes = new Map<string, Element>()
const messages: Array<{ message: any; origin: string }> = []
const contentWindow = { postMessage: (message: unknown, origin: string) => messages.push({ message, origin }) }
const frame = Object.assign(new Element(), { contentWindow })
nodes.set("renderer", frame)
const node = (id: string) => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id)! }
const page = new EventTarget()
const extensionOrigin = `chrome-extension://${"a".repeat(32)}`
const server = "http://127.0.0.1:7878"
const background: any[] = []
const port = { onMessage: new StubEvent(), onDisconnect: new StubEvent(), postMessage: (message: unknown) => background.push(message) }
const interval = globalThis.setInterval
const timers: ReturnType<typeof setInterval>[] = []
Object.assign(globalThis, {
  window: page,
  document: { getElementById: node },
  chrome: {
    runtime: { connect: () => port, getURL: () => `${extensionOrigin}/` },
    storage: { local: { get: async () => ({}), set: async () => {} } },
    windows: { getCurrent: async () => ({ id: 7 }) },
  },
})
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
function receive(data: unknown, origin = server, source: unknown = contentWindow) {
  const event = new Event("message")
  Object.assign(event, { data, origin, source })
  page.dispatchEvent(event)
}
function agent(status: AgentRelayState["status"]) {
  port.onMessage.emit({ type: "agents", state: { status, pairing: "none", relay: { address: "127.0.0.1:19988", remote: false }, tabs: [] } })
}
await import("../../src/sidepanel/index")
await settle()
afterAll(() => { for (const timer of timers) clearInterval(timer); globalThis.setInterval = interval })

test("侧栏只通过 iframe 推送 Browse 状态并拒绝错误来源", async () => {
  expect(new URL(frame.src).searchParams.get("parentOrigin")).toBe(extensionOrigin)
  expect(background[0]).toMatchObject({ type: "tab.activeInfo", windowId: 7 })
  const initial = messages.length
  receive({ type: "pi-desktop:remote-status", authenticated: true, online: true, canCompose: true }, "https://untrusted.test")
  expect(messages).toHaveLength(initial)
  agent("connected")
  port.onMessage.emit({ type: "tab.activeInfo", tab: { tabId: 42, windowId: 7, title: "当前页", url: "https://example.test", attached: false, badge: "" } })
  await settle()
  const status = messages.at(-1)!.message
  expect(status).toMatchObject({ type: "pi-desktop:browse-status", borrowed: false, browserContext: expect.stringContaining("tab=42"), authenticated: false, online: false, busy: false })
})

test("iframe Browse 请求先经过后台并回传 response", async () => {
  receive({ type: "pi-desktop:remote-status", authenticated: true, online: true, canCompose: true })
  agent("connected")
  port.onMessage.emit({ type: "tab.activeInfo", tab: { tabId: 42, windowId: 7, title: "当前页", url: "https://example.test", attached: false, badge: "" } })
  receive({ type: "pi-desktop:browse-request", requestId: "toggle-1", method: "toggleAttach" })
  await settle()
  expect(background.at(-1)).toMatchObject({ type: "tab.toggleAttach", tabId: 42 })
  const requestId = background.at(-1).requestId
  port.onMessage.emit({ type: "tab.result", requestId, ok: true, tab: { tabId: 42, windowId: 7, title: "当前页", url: "https://example.test", attached: true, badge: "ON" } })
  await settle()
  const response = [...messages].reverse().find((item) => item.message.type === "pi-desktop:browse-response")
  expect(response).toMatchObject({ message: { type: "pi-desktop:browse-response", requestId: "toggle-1", ok: true }, origin: server })
})
