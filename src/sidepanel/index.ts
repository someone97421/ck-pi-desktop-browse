import { SIDEPANEL_PORT, type ActiveTabInfo, type AgentRelayState, type FromSidepanel, type ToSidepanel } from "../shared/protocol"
import type { BrowserReference } from "../shared/browser-reference"
import { apiOrigin, frameUrl } from "./config"
import { browserContext, confirmedInsertion, needsPairing, pairingAddress, tabReference, validFrameMessage, type RemoteStatus } from "./context"

const frame = document.getElementById("renderer") as HTMLIFrameElement
let auth: RemoteStatus = { authenticated: false, online: false, canCompose: false }
let port: chrome.runtime.Port | undefined, windowId: number | undefined
let state: AgentRelayState | undefined, active: ActiveTabInfo | null = null
let pairing = false, ensuring = false, busy = false, lastAttempt = 0, lastEnsure = 0
let suspended = false
let browserTabs: BrowserReference[] = [], browserTabsActive = false
let browserId = "", browserTabsError: string | undefined
let relayResult: { resolve: (status: string) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | undefined
const pending = new Map<string, { resolve: (tab: ActiveTabInfo | undefined) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
const framePending = new Map<string, { resolve: (result: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()

function available() { return auth.authenticated && auth.online && !suspended }
function sendFrameStatus() {
  const current = active ? browserContext(active) : null
  frame.contentWindow?.postMessage({
    type: "pi-desktop:browse-status",
    authenticated: auth.authenticated,
    online: auth.online,
    busy,
    borrowed: active?.attached === true,
    browserContext: current,
  }, apiOrigin())
}
function sendFrameTabs() {
  const active = !!port && available() && browserTabsActive && browserId !== ""
  frame.contentWindow?.postMessage({ type: "pi-desktop:browser-tabs", browserId, active, tabs: active ? browserTabs : [], ...(browserTabsError ? { error: browserTabsError } : {}) }, apiOrigin())
}
function clearTabs() { browserTabs = []; browserTabsActive = false; browserTabsError = undefined; sendFrameTabs() }
function announceReady() {
  if (windowId === undefined || !port) return
  send({ type: "sidepanel.ready", windowId, available: available() })
}
function frameRequest(method: string, reference?: BrowserReference, target?: "current"): Promise<unknown> {
  if (!available()) return Promise.reject(new Error("请先登录主程序并等待连接就绪"))
  const targetWindow = frame.contentWindow
  if (!targetWindow) return Promise.reject(new Error("主程序页面尚未就绪，请稍后重试"))
  const requestId = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { framePending.delete(requestId); reject(new Error("主程序未确认操作，请检查连接后重试")) }, 65_000)
    framePending.set(requestId, { resolve, reject, timer })
    try {
      targetWindow.postMessage({ type: "pi-desktop:request", requestId, method, ...(reference === undefined ? {} : { reference }), ...(target ? { target } : {}) }, apiOrigin())
    } catch (error) { clearTimeout(timer); framePending.delete(requestId); reject(error) }
  })
}
async function insertReference(reference: BrowserReference, target?: "current") {
  const result = await frameRequest("browser.insertReference", reference, target)
  if (!confirmedInsertion(result)) throw new Error("主程序未确认网页引用的接收位置，请重试")
  return result
}
function resetFrameRequests() {
  for (const item of framePending.values()) { clearTimeout(item.timer); item.reject(new Error("主程序页面已重新载入、离线或退出登录")) }
  framePending.clear()
}
function respond(requestId: string, ok: boolean, result?: unknown, error?: unknown) {
  frame.contentWindow?.postMessage({ type: "pi-desktop:browse-response", requestId, ok, ...(ok ? { result } : { error: error instanceof Error ? error.message : String(error ?? "操作失败") }) }, apiOrigin())
}
window.addEventListener("message", (event) => {
  if (!validFrameMessage(event, frame.contentWindow, apiOrigin())) return
  const data = event.data
  if (data.type === "pi-desktop:remote-status") {
    const justAuthenticated = data.authenticated === true && !auth.authenticated
    auth = { authenticated: data.authenticated === true, online: data.online === true, canCompose: data.canCompose === true }
    if (!available()) { resetFrameRequests(); clearTabs() }
    if (justAuthenticated) { lastAttempt = 0; lastEnsure = 0 }
    announceReady(); sendFrameStatus(); sendFrameTabs(); void autoPair()
  } else if (data.type === "pi-desktop:response" && typeof data.requestId === "string") {
    const item = framePending.get(data.requestId)
    if (!item) return
    clearTimeout(item.timer); framePending.delete(data.requestId)
    if (data.ok === true) item.resolve(data.result)
    else item.reject(new Error(typeof data.error === "string" ? data.error : "主程序操作失败"))
  } else if (data.type === "pi-desktop:browse-request" && typeof data.requestId === "string") {
    void handleBrowseRequest(data.requestId, data.method)
  }
})
frame.addEventListener("load", () => {
  resetFrameRequests(); auth = { authenticated: false, online: false, canCompose: false }
  clearTabs(); announceReady(); sendFrameStatus()
  frame.contentWindow?.postMessage({ type: "pi-desktop:status-request" }, apiOrigin())
})
function send(value: FromSidepanel) {
  if (!port) throw new Error("扩展后台正在重连")
  port.postMessage(value)
}
function request(value: { type: "tab.toggleAttach" | "tab.ensureAttached"; tabId: number } | { type: "handoff.complete"; tabId: number; handoffId: string }): Promise<ActiveTabInfo | undefined> {
  const requestId = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error("后台未确认操作，请检查当前页状态")) }, 12_000)
    pending.set(requestId, { resolve, reject, timer })
    try { send({ ...value, requestId }) } catch (error) { clearTimeout(timer); pending.delete(requestId); reject(error) }
  })
}
async function forwardReference(event: Extract<ToSidepanel, { type: "reference.request" }>, source: chrome.runtime.Port) {
  let result: FromSidepanel
  try {
    if (source !== port || event.reference.windowId !== windowId) throw new Error("引用所属窗口与当前侧栏不一致")
    await insertReference(event.reference)
    if (source !== port) throw new Error("扩展后台已断开，无法确认引用回执")
    result = { type: "reference.result", requestId: event.requestId, ok: true }
  } catch (error) {
    result = { type: "reference.result", requestId: event.requestId, ok: false, error: error instanceof Error ? error.message : "网页引用插入失败" }
  }
  try { source.postMessage(result) } catch { /* 断开的端口由后台清理待处理请求。 */ }
}
function connect() {
  if (suspended || port || windowId === undefined) return
  const connected = chrome.runtime.connect({ name: SIDEPANEL_PORT })
  port = connected
  connected.onMessage.addListener((event: ToSidepanel) => {
    if (port !== connected) return
    if (event.type === "agents") { state = event.state; sendFrameStatus(); void autoPair() }
    if (event.type === "tab.activeInfo") { active = event.tab; sendFrameStatus() }
    if (event.type === "browser.tabs") {
      if (event.browserId) browserId = event.browserId
      browserTabsError = event.error
      browserTabsActive = event.active
      browserTabs = event.tabs
      sendFrameTabs()
    }
    if (event.type === "reference.request") void forwardReference(event, connected)
    if (event.type === "relay.result" && relayResult) {
      clearTimeout(relayResult.timer); relayResult.resolve(event.status); relayResult = undefined
    }
    if (event.type === "tab.result") {
      const item = pending.get(event.requestId)
      if (!item) return
      clearTimeout(item.timer); pending.delete(event.requestId)
      if (event.ok) item.resolve(event.tab)
      else item.reject(new Error(event.error || "当前页操作失败"))
    }
  })
  connected.onDisconnect.addListener(() => {
    void chrome.runtime.lastError
    if (port !== connected) return
    port = undefined; state = undefined; active = null
    clearTabs(); resetFrameRequests(); sendFrameStatus()
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error("扩展后台已断开，请核对当前页状态")) }
    pending.clear()
    if (relayResult) { clearTimeout(relayResult.timer); relayResult.reject(new Error("配对时后台已断开")); relayResult = undefined }
    if (!suspended) setTimeout(connect, 1000)
  })
  announceReady()
  send({ type: "tab.activeInfo", windowId })
}
function relayConnected() { return state?.status === "connected" }
async function waitForRelayConnected(timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs
  while (!relayConnected()) {
    if (Date.now() >= deadline) throw new Error("浏览器连接服务连接超时，请到设置页检查连接")
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}
async function pairRelay() {
  if (pairing || relayConnected()) return
  if (!auth.authenticated || !auth.online) throw new Error("请先使用主机密码登录主程序")
  if (!port) throw new Error("扩展后台正在重连")
  if (state?.status === "offline") {
    if (ensuring) {
      await waitForRelayConnected()
      return
    }
    ensuring = true; lastEnsure = Date.now(); sendFrameStatus()
    try { await frameRequest("browse.ensureRelay"); send({ type: "agents.reconnect" }) }
    finally { ensuring = false; sendFrameStatus() }
    await waitForRelayConnected()
    return
  }
  if (!needsPairing(state?.status)) return
  pairing = true; lastAttempt = Date.now(); sendFrameStatus()
  try {
    const result = await frameRequest("browse.mintPairingCode") as { code: string; port: number; endpoint: string }
    if (!result?.code) throw new Error("主程序未返回浏览器连接服务配对码")
    if (relayConnected()) return
    const status = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => { relayResult = undefined; reject(new Error("浏览器连接服务配对超时，请重试连接调试")) }, 20_000)
      relayResult = { resolve, reject, timer }
      try { send({ type: "relay.connect", address: pairingAddress(result.endpoint, result.port), code: result.code, ifNeeded: true }) }
      catch (error) { clearTimeout(timer); relayResult = undefined; reject(error) }
    })
    if (status !== "connected") throw new Error(`浏览器连接服务配对未完成：${status}`)
  } finally { pairing = false; sendFrameStatus() }
}
async function autoPair() {
  if (!auth.authenticated || !auth.online || !state || state.relay.remote || !port || pairing || ensuring) return
  try {
    if (state.status === "offline" && Date.now() - lastEnsure >= 30_000) await pairRelay()
    else if (needsPairing(state.status) && Date.now() - lastAttempt >= 30_000) await pairRelay()
  } catch { /* 后续 iframe 状态更新展示连接结果。 */ }
}
async function handleBrowseRequest(requestId: string, method: unknown) {
  if (busy) { respond(requestId, false, undefined, "当前已有浏览器操作正在执行"); return }
  busy = true; sendFrameStatus()
  try {
    await pairRelay()
    if (!relayConnected()) throw new Error("浏览器连接服务尚未连接，请到设置页检查连接")
    if (!active) throw new Error("没有可调试的当前页")
    if (method === "toggleAttach") {
      respond(requestId, true, await request({ type: "tab.toggleAttach", tabId: active.tabId }))
    } else if (method === "insertCurrent") {
      const tab = await request({ type: "tab.ensureAttached", tabId: active.tabId })
      if (!tab?.attached) throw new Error("当前页已关闭或收回，请重新选择标签页")
      const result = await insertReference(tabReference(tab), "current")
      respond(requestId, true, { ...result, browserContext: browserContext(tab) })
    } else if (method === "handoff") {
      const page = active.pageStatus
      if (page?.state !== "waiting" || !page.handoffId) throw new Error("当前页没有等待中的人工接手请求")
      respond(requestId, true, await request({ type: "handoff.complete", tabId: active.tabId, handoffId: page.handoffId }))
    } else throw new Error("不支持的浏览器操作")
  } catch (error) { respond(requestId, false, undefined, error) }
  finally { busy = false; sendFrameStatus() }
}
window.addEventListener("pagehide", () => {
  suspended = true
  clearTabs(); resetFrameRequests(); announceReady()
})
window.addEventListener("pageshow", () => {
  suspended = false
  if (!port) connect()
  else announceReady()
  frame.contentWindow?.postMessage({ type: "pi-desktop:status-request" }, apiOrigin())
})
async function boot() {
  windowId = (await chrome.windows.getCurrent()).id
  frame.src = frameUrl(apiOrigin(), chrome.runtime.getURL("").replace(/\/$/, ""))
  connect(); announceReady(); sendFrameStatus()
}
void boot().catch((error: unknown) => console.error("侧栏启动失败", error))
