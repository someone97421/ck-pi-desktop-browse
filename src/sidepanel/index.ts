import { STATUS_PORT, TOOLBAR_MODE_KEY, type ActiveTabInfo, type AgentRelayState, type FromStatusPage, type ToStatusPage } from "../shared/protocol"
import { apiOrigin, loadServerOrigin, saveServerOrigin } from "./config"
import { browserContext, needsPairing, pairingAddress } from "./context"

const node = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const harness = node("harness-status"), relay = node("relay-status"), title = node("tab-title"), badge = node("tab-badge")
const attach = node<HTMLButtonElement>("attach"), mention = node<HTMLButtonElement>("mention"), handoff = node<HTMLButtonElement>("handoff"), pair = node<HTMLButtonElement>("pair")
const hint = node("connector-hint"), form = node<HTMLFormElement>("settings-form"), address = node<HTMLInputElement>("server-origin")
const toolbar = node<HTMLInputElement>("toolbar-sidepanel")
let chat: typeof import("./chat/app.js")
let port: chrome.runtime.Port | undefined, windowId: number | undefined
let state: AgentRelayState | undefined, active: ActiveTabInfo | null = null
let pairing = false, ensuring = false, busy = false, lastAttempt = 0, lastEnsure = 0, wasAuthenticated = false
let healthAt = 0, reachable: boolean | undefined
let relayResult: { resolve: (status: string) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | undefined
const pending = new Map<string, { resolve: (tab: ActiveTabInfo | undefined) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()

function message(text = "") { hint.textContent = text; hint.hidden = !text }
function render() {
  const auth = chat?.connectorState()
  relay.textContent = `Relay · ${state?.status || "offline"}`
  relay.dataset.online = String(state?.status === "connected")
  title.textContent = active?.title || active?.url || "没有可调试的当前页"
  title.title = active ? `${active.title}\n${active.url}` : ""
  badge.textContent = active?.badge || (active?.attached ? "ON" : "未借出")
  attach.textContent = active?.attached ? "收回此页" : "借出此页"
  const available = !!active && state?.status === "connected" && !busy
  attach.disabled = !available
  mention.disabled = !available || !auth?.canCompose
  mention.title = auth?.canCompose ? "挂载当前页并插入浏览器调试上下文" : "先打开或新建一个对话"
  handoff.hidden = active?.pageStatus?.state !== "waiting" || !active.pageStatus.handoffId
  handoff.disabled = !available
  pair.disabled = pairing || ensuring || !auth?.authenticated || state?.status === "connected" || !port
  pair.textContent = pairing || ensuring ? "正在连接…" : state?.status === "connected" ? "已配对" : "连接调试"
}
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
    if (event.type === "agents") { state = event.state; render(); void autoPair() }
    if (event.type === "tab.activeInfo") { active = event.tab; render() }
    if (event.type === "relay.result" && relayResult) {
      clearTimeout(relayResult.timer)
      relayResult.resolve(event.status)
      relayResult = undefined
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
    port = undefined; state = undefined; render()
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error("扩展后台已断开，请核对当前页状态")) }
    pending.clear()
    if (relayResult) { clearTimeout(relayResult.timer); relayResult.reject(new Error("配对时后台已断开")); relayResult = undefined }
    setTimeout(connect, 1000)
  })
  send({ type: "tab.activeInfo", windowId })
}
function relayConnected() { return state?.status === "connected" }
async function pairRelay() {
  if (pairing || state?.status === "connected") return
  if (!chat?.connectorState().authenticated) throw new Error("请先使用主机密码登录 Harness")
  if (!port) throw new Error("扩展后台正在重连")
  pairing = true; lastAttempt = Date.now(); render(); message()
  try {
    const result = await chat.connectorRpc("browse.mintPairingCode") as { code: string; port: number; endpoint: string }
    if (!result?.code) throw new Error("Harness 未返回 Browse 配对码")
    // 其他侧栏可能已经完成配对；不重置一个刚刚建立的连接。
    if (relayConnected()) return
    const status = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => { relayResult = undefined; reject(new Error("Browse 配对超时，请重试连接调试")) }, 20_000)
      relayResult = { resolve, reject, timer }
      try { send({ type: "relay.connect", address: pairingAddress(result.endpoint, result.port), code: result.code, ifNeeded: true }) }
      catch (error) { clearTimeout(timer); relayResult = undefined; reject(error) }
    })
    if (status !== "connected") throw new Error(`Browse 配对未完成：${status}`)
  } finally { pairing = false; render() }
}
async function autoPair() {
  if (!chat?.connectorState().authenticated || !state || state.relay.remote || !port || pairing || ensuring) return
  try {
    if (state.status === "offline" && Date.now() - lastEnsure >= 30_000) {
      ensuring = true; lastEnsure = Date.now(); render()
      try {
        await chat.connectorRpc("browse.ensureRelay")
        if (state?.status === "offline") send({ type: "agents.reconnect" })
      } finally { ensuring = false; render() }
    } else if (needsPairing(state.status) && Date.now() - lastAttempt >= 30_000) await pairRelay()
  } catch (error) { message(error instanceof Error ? error.message : String(error)) }
}
async function run(action: () => Promise<void>) {
  if (busy) return
  busy = true; message(); render()
  try { await action() } catch (error) { message(error instanceof Error ? error.message : String(error)) }
  finally { busy = false; render() }
}
attach.addEventListener("click", () => void run(async () => {
  if (!active) return
  await request({ type: "tab.toggleAttach", tabId: active.tabId })
}))
mention.addEventListener("click", () => void run(async () => {
  if (!active) return
  const tab = await request({ type: "tab.ensureAttached", tabId: active.tabId })
  if (!tab?.attached) throw new Error("当前页已关闭或收回，请重新选择标签页")
  await chat.insertBrowserContext(browserContext(tab))
}))
handoff.addEventListener("click", () => void run(async () => {
  const page = active?.pageStatus
  if (!active || page?.state !== "waiting" || !page.handoffId) return
  await request({ type: "handoff.complete", tabId: active.tabId, handoffId: page.handoffId })
}))
pair.addEventListener("click", () => void run(pairRelay))
node("settings").addEventListener("click", () => { form.hidden = !form.hidden; if (!form.hidden) address.focus() })
form.addEventListener("submit", (event) => {
  event.preventDefault()
  void run(async () => {
    await saveServerOrigin(address.value)
    await chrome.storage.local.set({ [TOOLBAR_MODE_KEY]: toolbar.checked ? "sidepanel" : "attach" })
    location.reload()
  })
})
async function tick() {
  const auth = chat.connectorState()
  if (!auth.online && Date.now() - healthAt > 10_000) {
    healthAt = Date.now()
    try { reachable = (await fetch(`${apiOrigin()}/api/health`, { signal: AbortSignal.timeout(1500), cache: "no-store" })).ok } catch { reachable = false }
  }
  harness.textContent = `Harness · ${auth.online ? "在线" : reachable === false ? "离线" : auth.authenticated ? "重连中" : "在线 · 未登录"}`
  harness.dataset.online = String(auth.online)
  if (auth.authenticated && !wasAuthenticated) { lastAttempt = 0; lastEnsure = 0 }
  wasAuthenticated = auth.authenticated
  render()
  await autoPair()
}
async function boot() {
  address.value = await loadServerOrigin()
  toolbar.checked = (await chrome.storage.local.get(TOOLBAR_MODE_KEY))[TOOLBAR_MODE_KEY] !== "attach"
  windowId = (await chrome.windows.getCurrent()).id
  chat = await import("./chat/app.js")
  connect()
  await tick()
  setInterval(() => { void tick() }, 1500)
}
void boot().catch((error: unknown) => message(`侧边栏启动失败：${error instanceof Error ? error.message : String(error)}`))
