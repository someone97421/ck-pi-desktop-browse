import { afterAll, expect, test } from "bun:test"
import { StubEvent } from "../chrome-stub"
import type { AgentRelayState } from "../../src/shared/protocol"
import { loadServerOrigin } from "../../src/sidepanel/config"

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
let storedOrigin: string | undefined
let desktopOnline = false
const originalFetch = globalThis.fetch
globalThis.fetch = (async () => {
  if (!desktopOnline) throw new TypeError("fetch failed")
  return {
    ok: true,
    json: async () => ({ ok: true, result: { protocolVersion: 2, authMode: "password" } }),
  } as Response
}) as typeof fetch
const interval = globalThis.setInterval
const timers: ReturnType<typeof setInterval>[] = []
globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
  const timer = Reflect.apply(interval, globalThis, args) as ReturnType<typeof setInterval>
  timers.push(timer)
  return timer
}) as typeof setInterval
Object.assign(globalThis, {
  window: page,
  document: Object.assign(new EventTarget(), { getElementById: node, hidden: false }),
  chrome: {
    runtime: { connect: () => port, getURL: () => `${extensionOrigin}/` },
    storage: { local: { get: async () => ({ chromeSidebarServerOrigin: storedOrigin }), set: async () => {} } },
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
afterAll(() => {
  for (const timer of timers) clearInterval(timer)
  globalThis.setInterval = interval
  globalThis.fetch = originalFetch
})
test("主程序离线时显示指引，重试成功并收到页面状态后才进入侧栏", async () => {
  expect(frame.src).toBe("")
  expect(frame.hidden).toBe(true)
  expect(node("connection-guide").hidden).toBe(false)
  expect(node("guide-title").textContent).toBe("主程序尚未启动")
  expect(node("retry-connection").disabled).toBe(false)
  desktopOnline = true
  node("retry-connection").dispatchEvent(new Event("click"))
  await settle()
  expect(new URL(frame.src).searchParams.get("parentOrigin")).toBe(extensionOrigin)
  expect(node("guide-title").textContent).toBe("正在连接主程序…")
  expect(node("connection-guide").hidden).toBe(false)
  receive({ type: "pi-desktop:remote-status", authenticated: false, online: false, canCompose: false })
  expect(node("connection-guide").hidden).toBe(true)
  expect(frame.hidden).toBe(false)
})

test("侧栏只通过 iframe 推送 Browse 状态并拒绝错误来源", async () => {
  expect(new URL(frame.src).searchParams.get("parentOrigin")).toBe(extensionOrigin)
  expect(background.find(message => message.type === "sidepanel.ready")).toMatchObject({ available: false, windowId: 7 })
  expect(background.find(message => message.type === "tab.activeInfo")).toMatchObject({ windowId: 7 })
  const initial = messages.length
  receive({ type: "pi-desktop:remote-status", authenticated: true, online: true, canCompose: true }, "https://untrusted.test")
  expect(messages).toHaveLength(initial)
  agent("connected")
  port.onMessage.emit({ type: "tab.activeInfo", tab: { tabId: 42, windowId: 7, title: "当前页", url: "https://example.test", attached: false, badge: "" } })
  await settle()
  const status = messages.at(-1)!.message
  expect(status).toMatchObject({ type: "pi-desktop:browse-status", borrowed: false, browserContext: expect.stringContaining("tab=42"), authenticated: false, online: false, busy: false })
})

test("打开侧栏先调试当前页，草稿与标签列表就绪后插入一次 chip", async () => {
  const insertions = () => messages.filter(item => item.message.method === "browser.insertReference")
  receive({ type: "pi-desktop:remote-status", authenticated: true, online: true, canCompose: false, initialDraftKey: "temporary:startup" })
  const attach = background.findLast(message => message.type === "tab.ensureAttached")
  expect(attach).toMatchObject({ tabId: 42 })
  port.onMessage.emit({ type: "tab.result", requestId: attach.requestId, ok: true, tab: { tabId: 42, windowId: 7, title: "当前页", url: "https://example.test", attached: true, badge: "ON" } })
  await settle()
  expect(insertions()).toHaveLength(0)
  receive({ type: "pi-desktop:remote-status", authenticated: true, online: true, canCompose: true, draftKey: "temporary:startup" })
  expect(insertions()).toHaveLength(0)
  port.onMessage.emit({ type: "browser.tabs", active: true, browserId: "browser-7", tabs: [{ kind: "page", tabId: 42, windowId: 7, title: "当前页", url: "https://example.test" }] })
  const insertion = insertions().at(-1)!.message
  expect(insertion).toMatchObject({ target: "current", draftKey: "temporary:startup", reference: { kind: "page", tabId: 42 } })
  receive({ type: "pi-desktop:response", requestId: insertion.requestId, ok: true, result: { inserted: true, clientId: "sidebar-composer" } })
  await settle()
  receive({ type: "pi-desktop:remote-status", authenticated: true, online: false, canCompose: false, draftKey: "temporary:startup" })
  receive({ type: "pi-desktop:remote-status", authenticated: true, online: true, canCompose: true, draftKey: "temporary:startup" })
  agent("connected")
  await settle()
  expect(background.filter(message => message.type === "tab.ensureAttached")).toHaveLength(1)
  expect(insertions()).toHaveLength(1)
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

function ready() {
  receive({ type: "pi-desktop:remote-status", authenticated: true, online: true, canCompose: true })
  agent("connected")
  port.onMessage.emit({ type: "tab.activeInfo", tab: { tabId: 42, windowId: 7, title: "当前页", url: "https://example.test", attached: true, badge: "ON" } })
}
function picker(action: "start" | "end", sessionId: string, cancel?: boolean) {
  receive({ type: "pi-desktop:element-picker", action, sessionId, ...(cancel === undefined ? {} : { cancel }) })
}
function pickerReplies(sessionId: string) {
  return messages.filter((item) => item.message.type === "pi-desktop:element-picker-result" && item.message.sessionId === sessionId)
}

test("工具栏 iframe 拖动消息启动捕捉，真实插入回执后才转发成功结果", async () => {
  ready()
  picker("start", "toolbar-1")
  expect(background.at(-1)).toEqual({ type: "picker.start", sessionId: "toolbar-1", tabId: 42 })
  port.onMessage.emit({ type: "reference.request", requestId: "dom-drop", reference: { kind: "element", tabId: 42, windowId: 7, title: "页面", url: "https://example.test" } })
  await settle()
  expect(pickerReplies("toolbar-1")).toEqual([])
  expect(background.some((message) => message.type === "reference.result" && message.requestId === "dom-drop")).toBe(false)
  const request = messages.findLast((item) => item.message.type === "pi-desktop:request" && item.message.method === "browser.insertReference")!.message
  expect(request.target).toBe("current")
  receive({ type: "pi-desktop:response", requestId: request.requestId, ok: true, result: { inserted: true, clientId: "composer" } })
  await settle()
  expect(background).toContainEqual({ type: "reference.result", requestId: "dom-drop", ok: true })
  expect(pickerReplies("toolbar-1")).toEqual([])
  picker("end", "toolbar-1", false)
  expect(background.at(-1)).toEqual({ type: "picker.end", sessionId: "toolbar-1", cancel: false })
  port.onMessage.emit({ type: "picker.result", sessionId: "toolbar-1", ok: true })
  expect(pickerReplies("toolbar-1")).toEqual([{ message: { type: "pi-desktop:element-picker-result", sessionId: "toolbar-1", ok: true }, origin: server }])
})

test("拖动消息同时校验 iframe origin 和 source", () => {
  ready()
  const before = background.length, replies = messages.length
  const message = { type: "pi-desktop:element-picker", action: "start", sessionId: "forged" }
  receive(message, "https://untrusted.test")
  receive(message, server, {})
  expect(background).toHaveLength(before)
  expect(messages).toHaveLength(replies)
})

test("非法 sessionId 返回启动错误，未知 action 不启动捕捉", () => {
  ready()
  const before = background.length
  for (const sessionId of ["", "UPPER", "with space", "a".repeat(81)]) {
    picker("start", sessionId)
    expect(pickerReplies(sessionId).at(-1)).toMatchObject({ message: { ok: false, error: expect.stringContaining("标识无效") }, origin: server })
  }
  receive({ type: "pi-desktop:element-picker", action: "unknown", sessionId: "ignored" })
  receive({ type: "pi-desktop:element-picker", action: "start", sessionId: 123 })
  expect(background).toHaveLength(before)
})

test("end 只结束对应会话，旧或重复结果不转发，后台失败原样传给 iframe", () => {
  ready()
  picker("start", "old-drag")
  picker("start", "new-drag")
  expect(background.slice(-2)).toEqual([
    { type: "picker.end", sessionId: "old-drag", cancel: true },
    { type: "picker.start", sessionId: "new-drag", tabId: 42 },
  ])
  const before = background.length
  picker("end", "old-drag", true)
  expect(background).toHaveLength(before)
  picker("end", "new-drag")
  expect(background.at(-1)).toEqual({ type: "picker.end", sessionId: "new-drag", cancel: false })
  picker("end", "new-drag", true)
  expect(background).toHaveLength(before + 1)
  port.onMessage.emit({ type: "picker.result", sessionId: "old-drag", ok: true })
  expect(pickerReplies("old-drag")).toEqual([])
  port.onMessage.emit({ type: "picker.result", sessionId: "new-drag", ok: false, error: "此 Chrome 页面不支持 DOM 捕捉" })
  port.onMessage.emit({ type: "picker.result", sessionId: "new-drag", ok: true })
  expect(pickerReplies("new-drag")).toEqual([{ message: { type: "pi-desktop:element-picker-result", sessionId: "new-drag", ok: false, error: "此 Chrome 页面不支持 DOM 捕捉" }, origin: server }])
})

test("未登录或没有当前页时向 iframe 返回明确启动错误", () => {
  receive({ type: "pi-desktop:remote-status", authenticated: false, online: false, canCompose: false })
  picker("start", "offline-drag")
  expect(pickerReplies("offline-drag")).toMatchObject([{ message: { ok: false, error: expect.stringContaining("登录") }, origin: server }])
  ready()
  port.onMessage.emit({ type: "tab.activeInfo", tab: null })
  picker("start", "no-tab-drag")
  expect(pickerReplies("no-tab-drag")).toMatchObject([{ message: { ok: false, error: expect.stringContaining("网页") }, origin: server }])
})

test("离线 Relay 启动后进入待配对状态，继续自动配对且不重复启动", async () => {
  receive({ type: "pi-desktop:remote-status", authenticated: false, online: false, canCompose: false })
  agent("offline")
  receive({ type: "pi-desktop:remote-status", authenticated: true, online: true, canCompose: true })
  await settle()
  const ensure = messages.findLast((item) => item.message.type === "pi-desktop:request" && item.message.method === "browse.ensureRelay")!.message
  receive({ type: "pi-desktop:response", requestId: ensure.requestId, ok: true })
  agent("unpaired")
  await settle()
  expect(background).toContainEqual({ type: "agents.reconnect" })
  const mint = messages.findLast((item) => item.message.type === "pi-desktop:request" && item.message.method === "browse.mintPairingCode")!.message
  expect(messages.filter((item) => item.message.type === "pi-desktop:request" && item.message.method === "browse.ensureRelay")).toHaveLength(1)
  receive({ type: "pi-desktop:response", requestId: mint.requestId, ok: true, result: { code: "test-pair", endpoint: "http://127.0.0.1:19988", port: 19988 } })
  await settle()
  expect(background.at(-1)).toEqual({ type: "relay.connect", address: "127.0.0.1:19988", code: "test-pair", ifNeeded: true })
  agent("connected")
  port.onMessage.emit({ type: "relay.result", status: "connected" })
  await settle()
})

test("旧远程中继连接自动切回主程序本机调试服务", async () => {
  receive({ type: "pi-desktop:remote-status", authenticated: false, online: false, canCompose: false })
  port.onMessage.emit({ type: "agents", state: {
    status: "connected", pairing: "token", tabs: [],
    relay: { address: "devbox:19988", remote: true },
  } })
  const before = messages.length
  receive({ type: "pi-desktop:remote-status", authenticated: true, online: true, canCompose: true })
  await settle()
  const ensure = messages.slice(before).find((item) => item.message.method === "browse.ensureRelay")!.message
  receive({ type: "pi-desktop:response", requestId: ensure.requestId, ok: true })
  await settle()
  const mint = messages.slice(before).find((item) => item.message.method === "browse.mintPairingCode")!.message
  receive({ type: "pi-desktop:response", requestId: mint.requestId, ok: true,
    result: { code: "local-pair", endpoint: "http://127.0.0.1:19988", port: 19988 } })
  await settle()
  expect(background.at(-1)).toEqual({ type: "relay.connect", address: "127.0.0.1:19988", code: "local-pair", ifNeeded: true })
  agent("connected")
  port.onMessage.emit({ type: "relay.result", status: "connected" })
  await settle()
})

test("跨机主程序不触发本机配对，也不替换已有远程连接", async () => {
  receive({ type: "pi-desktop:remote-status", authenticated: false, online: false, canCompose: false })
  storedOrigin = "http://192.168.8.2:7878"
  await loadServerOrigin()
  try {
    port.onMessage.emit({ type: "agents", state: { status: "connected", pairing: "token", tabs: [],
      relay: { address: "192.168.8.2:19988", remote: true } } })
    const before = messages.length, backgroundBefore = background.length
    receive({ type: "pi-desktop:remote-status", authenticated: true, online: true, canCompose: false }, storedOrigin)
    await settle()
    expect(messages.slice(before).filter((item) => ["browse.ensureRelay", "browse.mintPairingCode"].includes(item.message.method))).toHaveLength(0)
    expect(background.slice(backgroundBefore).filter((item) => item.type === "relay.connect")).toHaveLength(0)
  } finally {
    storedOrigin = undefined
    await loadServerOrigin()
    receive({ type: "pi-desktop:remote-status", authenticated: false, online: false, canCompose: false })
    agent("connected")
  }
})

test("显式取消与 iframe 重载会向后台结束当前捕捉", () => {
  ready()
  picker("start", "cancel-drag")
  picker("end", "cancel-drag", true)
  expect(background.at(-1)).toEqual({ type: "picker.end", sessionId: "cancel-drag", cancel: true })
  picker("start", "reload-drag")
  const before = background.length
  frame.dispatchEvent(new Event("load"))
  expect(background.slice(before)).toContainEqual({ type: "picker.end", sessionId: "reload-drag", cancel: true })
  expect(nodes.size).toBe(5)
  page.dispatchEvent(new Event("pagehide"))
})
