import { expect, mock, test } from "bun:test"
import { installChrome, StubEvent } from "../chrome-stub"
import { STATUS_PORT, TOOLBAR_MODE_KEY, type AgentRelayState, type ToStatusPage } from "../../src/shared/protocol"

const stub = installChrome()
Object.assign(globalThis, { __OPENCODE_BROWSER_TEST_HOOKS__: false })
const state: AgentRelayState = { status: "connected", pairing: "token", tabs: [], relay: { address: "127.0.0.1:19988", remote: false } }
const attachCalls: number[] = [], handoffs: unknown[] = []
let connections = 0
mock.module("../../src/background/agent-relay", () => ({ createAgentRelay: () => ({
  state: () => state, badge: () => undefined,
  connectTo: async (address: string) => {
    connections++
    state.status = "connecting"
    await new Promise((resolve) => setTimeout(resolve, 30))
    state.status = "connected"
    return { status: "connected", address }
  },
  attachTab: async (tabId: number) => {
    attachCalls.push(tabId)
    await new Promise((resolve) => setTimeout(resolve, 30))
    const found = state.tabs.findIndex((tab) => tab.tabId === tabId)
    if (found >= 0) state.tabs.splice(found, 1)
    else state.tabs.push({ tabId })
  },
  completeHandoff: (tabId: number, handoffId: string) => handoffs.push({ tabId, handoffId }),
}) }))
await import("../../src/background/index")
const events = stub.chrome as unknown as {
  runtime: { onConnect: StubEvent }
  tabs: { onActivated: StubEvent; onUpdated: StubEvent }
  action: { onClicked: StubEvent }
}
function connect(senderUrl = "chrome-extension://stubextensionid/sidepanel.html") {
  const frames: ToStatusPage[] = []
  const port = { name: STATUS_PORT, sender: { id: "stubextensionid", url: senderUrl }, onDisconnect: new StubEvent(), onMessage: new StubEvent(), postMessage: (frame: ToStatusPage) => frames.push(frame) }
  events.runtime.onConnect.emit(port)
  return { frames, port, send: (message: unknown) => port.onMessage.emit(message) }
}
async function settled() { await new Promise((resolve) => setTimeout(resolve, 180)) }

test("侧栏始终查询所属窗口，导航后推送新的 URL", async () => {
  const a = await stub.chrome.windows.create({ url: "https://a.test" })
  const b = await stub.chrome.windows.create({ url: "https://b.test" })
  const one = connect(), two = connect()
  one.send({ type: "tab.activeInfo", windowId: a.id })
  two.send({ type: "tab.activeInfo", windowId: b.id })
  await settled()
  expect(one.frames.at(-1)).toMatchObject({ type: "tab.activeInfo", tab: { tabId: a.tabs[0]!.id, url: "https://a.test" } })
  expect(two.frames.at(-1)).toMatchObject({ type: "tab.activeInfo", tab: { tabId: b.tabs[0]!.id, url: "https://b.test" } })
  await stub.chrome.tabs.update(a.tabs[0]!.id, { url: "https://a.test/new" })
  events.tabs.onUpdated.emit(a.tabs[0]!.id, { url: "https://a.test/new" }, await stub.chrome.tabs.get(a.tabs[0]!.id))
  await settled()
  expect(one.frames.at(-1)).toMatchObject({ type: "tab.activeInfo", tab: { url: "https://a.test/new" } })
  expect(two.frames.at(-1)).toMatchObject({ type: "tab.activeInfo", tab: { url: "https://b.test" } })
})
test("重复 @当前页 请求只挂载一次，确认后才返回附带上下文的 tab", async () => {
  const w = await stub.chrome.windows.create({ url: "https://attach.test" })
  const tabId = w.tabs[0]!.id
  const page = connect()
  page.send({ type: "tab.ensureAttached", tabId, requestId: "first" })
  page.send({ type: "tab.ensureAttached", tabId, requestId: "second" })
  expect(page.frames.some((frame) => frame.type === "tab.result")).toBe(false)
  await settled()
  expect(attachCalls.filter((id) => id === tabId)).toHaveLength(1)
  expect(page.frames.filter((frame) => frame.type === "tab.result")).toHaveLength(2)
  expect(page.frames.find((frame) => frame.type === "tab.result")).toMatchObject({ ok: true, tab: { attached: true, tabId } })
  page.send({ type: "tab.toggleAttach", tabId, requestId: "take-back" })
  await settled()
  expect(page.frames.find((frame) => frame.type === "tab.result" && frame.requestId === "take-back")).toMatchObject({ ok: true, tab: { attached: false } })
})
test("内容脚本不能冒用侧栏端口借出页面", async () => {
  const page = connect("https://untrusted.test/")
  page.send({ type: "tab.toggleAttach", tabId: 999, requestId: "forged" })
  await settled()
  expect(page.frames).toHaveLength(0)
  expect(attachCalls).not.toContain(999)
})
test("Handoff 继续动作携带准确 tab 与 handoff ID", async () => {
  const w = await stub.chrome.windows.create({ url: "https://handoff.test" })
  const tabId = w.tabs[0]!.id
  const page = connect()
  page.send({ type: "handoff.complete", tabId, handoffId: "handoff-123", requestId: "continue" })
  await settled()
  expect(handoffs.at(-1)).toEqual({ tabId, handoffId: "handoff-123" })
  expect(page.frames.find((frame) => frame.type === "tab.result")).toMatchObject({ ok: true })
})
test("多窗口并发自动配对共用一次握手，已连接后不覆盖 token", async () => {
  state.status = "unpaired"
  const one = connect(), two = connect()
  one.send({ type: "relay.connect", address: "127.0.0.1:19988", code: "ABCD-EF12", ifNeeded: true })
  two.send({ type: "relay.connect", address: "127.0.0.1:19988", code: "ABCD-EF34", ifNeeded: true })
  await settled()
  expect(connections).toBe(1)
  expect(one.frames.at(-1)).toMatchObject({ type: "relay.result", status: "connected" })
  expect(two.frames.at(-1)).toMatchObject({ type: "relay.result", status: "connected" })
  one.send({ type: "relay.connect", address: "127.0.0.1:19988", code: "ABCD-EF56", ifNeeded: true })
  await settled()
  expect(connections).toBe(1)
})
test("图标缺省打开侧栏，改为借出模式后才切换当前页", async () => {
  const w = await stub.chrome.windows.create({ url: "https://toolbar.test" })
  const tab = w.tabs[0]!
  const before = attachCalls.length
  events.action.onClicked.emit(tab)
  await settled()
  expect(attachCalls.length).toBe(before)
  await stub.chrome.storage.local.set({ [TOOLBAR_MODE_KEY]: "attach" })
  await settled()
  events.action.onClicked.emit(tab)
  await settled()
  expect(attachCalls.at(-1)).toBe(tab.id)
  await stub.chrome.storage.local.set({ [TOOLBAR_MODE_KEY]: "sidepanel" })
})
