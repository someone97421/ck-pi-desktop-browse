import { STATUS_PORT, type ActiveTabInfo, type AgentRelayState, type FromStatusPage, type ToStatusPage } from "../shared/protocol"
import { apiOrigin, frameUrl } from "./config"
import { browserContext, needsPairing, pairingAddress, validFrameMessage, type RemoteStatus } from "./context"

const frame = document.getElementById("renderer") as HTMLIFrameElement
let auth: RemoteStatus = { authenticated: false, online: false, canCompose: false }
let port: chrome.runtime.Port | undefined, windowId: number | undefined
let state: AgentRelayState | undefined, active: ActiveTabInfo | null = null
let pairing = false, ensuring = false, busy = false, lastAttempt = 0, lastEnsure = 0
let relayResult: { resolve: (status: string) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | undefined
const pending = new Map<string, { resolve: (tab: ActiveTabInfo | undefined) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
const framePending = new Map<string, { resolve: (result: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()

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
function frameRequest(method: string, text?: string): Promise<unknown> {
  if (!auth.authenticated || !auth.online) return Promise.reject(new Error("请先登录 Harness 并等待连接就绪"))
  const requestId = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { framePending.delete(requestId); reject(new Error("Harness 未确认操作，请检查连接后重试")) }, 65_000)
    framePending.set(requestId, { resolve, reject, timer })
    frame.contentWindow?.postMessage({ type: "pi-desktop:request", requestId, method, ...(text === undefined ? {} : { text }) }, apiOrigin())
  })
}
function resetFrameRequests() {
  for (const item of framePending.values()) { clearTimeout(item.timer); item.reject(new Error("Harness 页面已重新载入或退出登录")) }
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
    if (!auth.authenticated) resetFrameRequests()
    if (justAuthenticated) { lastAttempt = 0; lastEnsure = 0 }
    sendFrameStatus(); void autoPair()
  } else if (data.type === "pi-desktop:response" && typeof data.requestId === "string") {
    const item = framePending.get(data.requestId)
    if (!item) return
    clearTimeout(item.timer); framePending.delete(data.requestId)
    if (data.ok === true) item.resolve(data.result)
    else item.reject(new Error(typeof data.error === "string" ? data.error : "Harness 操作失败"))
  } else if (data.type === "pi-desktop:browse-request" && typeof data.requestId === "string") {
    void handleBrowseRequest(data.requestId, data.method)
  }
})
frame.addEventListener("load", () => {
  resetFrameRequests(); auth = { authenticated: false, online: false, canCompose: false }; sendFrameStatus()
  frame.contentWindow?.postMessage({ type: "pi-desktop:status-request" }, apiOrigin())
})
function send(value: FromStatusPage) {
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
function connect() {
  port = chrome.runtime.connect({ name: STATUS_PORT })
  port.onMessage.addListener((event: ToStatusPage) => {
    if (event.type === "agents") { state = event.state; sendFrameStatus(); void autoPair() }
    if (event.type === "tab.activeInfo") { active = event.tab; sendFrameStatus() }
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
  port.onDisconnect.addListener(() => {
    port = undefined; state = undefined; sendFrameStatus()
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error("扩展后台已断开，请核对当前页状态")) }
    pending.clear()
    if (relayResult) { clearTimeout(relayResult.timer); relayResult.reject(new Error("配对时后台已断开")); relayResult = undefined }
    setTimeout(connect, 1000)
  })
  send({ type: "tab.activeInfo", windowId })
}
function relayConnected() { return state?.status === "connected" }
async function waitForRelayConnected(timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs
  while (!relayConnected()) {
    if (Date.now() >= deadline) throw new Error("Browse Relay 连接超时，请到设置页检查连接")
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}
async function pairRelay() {
  if (pairing || relayConnected()) return
  if (!auth.authenticated || !auth.online) throw new Error("请先使用主机密码登录 Harness")
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
    if (!result?.code) throw new Error("Harness 未返回 Browse 配对码")
    if (relayConnected()) return
    const status = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => { relayResult = undefined; reject(new Error("Browse 配对超时，请重试连接调试")) }, 20_000)
      relayResult = { resolve, reject, timer }
      try { send({ type: "relay.connect", address: pairingAddress(result.endpoint, result.port), code: result.code, ifNeeded: true }) }
      catch (error) { clearTimeout(timer); relayResult = undefined; reject(error) }
    })
    if (status !== "connected") throw new Error(`Browse 配对未完成：${status}`)
  } finally { pairing = false; sendFrameStatus() }
}
async function autoPair() {
  if (!auth.authenticated || !auth.online || !state || state.relay.remote || !port || pairing || ensuring) return
  try {
    if (state.status === "offline" && Date.now() - lastEnsure >= 30_000) await pairRelay()
    else if (needsPairing(state.status) && Date.now() - lastAttempt >= 30_000) await pairRelay()
  } catch { /* status is surfaced by the next iframe status update */ }
}
async function handleBrowseRequest(requestId: string, method: unknown) {
  if (busy) { respond(requestId, false, undefined, "当前已有 Browse 操作正在执行"); return }
  busy = true; sendFrameStatus()
  try {
    await pairRelay()
    if (!relayConnected()) throw new Error("Browse Relay 尚未连接，请到设置页检查连接")
    if (!active) throw new Error("没有可调试的当前页")
    if (method === "toggleAttach") {
      respond(requestId, true, await request({ type: "tab.toggleAttach", tabId: active.tabId }))
    } else if (method === "insertCurrent") {
      const tab = await request({ type: "tab.ensureAttached", tabId: active.tabId })
      if (!tab?.attached) throw new Error("当前页已关闭或收回，请重新选择标签页")
      const text = browserContext(tab)
      await frameRequest("composer.insert", text)
      respond(requestId, true, { inserted: true, browserContext: text })
    } else if (method === "handoff") {
      const page = active.pageStatus
      if (page?.state !== "waiting" || !page.handoffId) throw new Error("当前页没有等待中的 handoff")
      respond(requestId, true, await request({ type: "handoff.complete", tabId: active.tabId, handoffId: page.handoffId }))
    } else throw new Error("不支持的 Browse 操作")
  } catch (error) { respond(requestId, false, undefined, error) }
  finally { busy = false; sendFrameStatus() }
}
async function boot() {
  windowId = (await chrome.windows.getCurrent()).id
  frame.src = frameUrl(apiOrigin(), chrome.runtime.getURL("").replace(/\/$/, ""))
  connect(); sendFrameStatus()
}
void boot().catch((error: unknown) => console.error("侧边栏启动失败", error))
