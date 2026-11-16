// 设置页订阅连接状态，独立侧栏端口另负责当前窗口的引用与标签列表。
import { AGENT_DIAGNOSTICS, SIDEPANEL_PORT, STATUS_PORT, TOOLBAR_MODE_KEY, type ActiveTabInfo, type FromSidepanel, type FromStatusPage, type ToStatusPage } from "../shared/protocol"
import { createAgentRelay } from "./agent-relay"
import { TabCleanup } from "./tab-cleanup"
import { createBrowserReferences } from "./browser-references"

const BADGE_COLORS: Record<string, string> = { default: "#3b3b3b", RUN: "#b45309", WAIT: "#2563eb" }
const pages = new Set<chrome.runtime.Port>()
const windows = new Map<chrome.runtime.Port, number>()
const tabOperations = new Map<number, Promise<void>>()
const browserReferences = createBrowserReferences(ensureAttached)
const agents = createAgentRelay({
  changed: (state) => {
    broadcast({ type: "agents", state })
    void updateActiveTabs()
  },
  badgesChanged: () => { void updateBadges(); void updateActiveTabs() },
})

let toolbarMode = "sidepanel"
let sidepanelConnect: ReturnType<typeof agents.connectTo> | undefined
async function configureToolbar() {
  const stored = await chrome.storage.local.get(TOOLBAR_MODE_KEY)
  toolbarMode = stored[TOOLBAR_MODE_KEY] === "attach" ? "attach" : "sidepanel"
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: toolbarMode === "sidepanel" })
}
void configureToolbar()
chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && TOOLBAR_MODE_KEY in changes) void configureToolbar() })
chrome.action.onClicked.addListener((tab) => {
  if (toolbarMode !== "attach") return
  const status = agents.state().status
  if (status === "unpaired" || status === "untrusted" || status === "incompatible") {
    void chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") })
  } else if (tab.id !== undefined) void agents.attachTab(tab.id)
})

declare const __OPENCODE_BROWSER_TEST_HOOKS__: boolean
if (__OPENCODE_BROWSER_TEST_HOOKS__)
  Object.assign(globalThis, { __opencodeBrowserTest: { toolbarClick: (tabId: number) => agents.attachTab(tabId) } })

chrome.runtime.onConnect.addListener((port) => {
  const sender = port.sender
  const origin = `chrome-extension://${chrome.runtime.id}`
  const page = sender?.id === chrome.runtime.id &&
    sender.url?.startsWith(`${origin}/`) === true &&
    (sender.origin === undefined || sender.origin === origin || sender.origin === `${origin}/`)
  const sidepanelPage = sender?.url?.split(/[?#]/)[0] === chrome.runtime.getURL("sidepanel.html")
  const sidepanel = port.name === SIDEPANEL_PORT && sidepanelPage
  if (!page || !(sidepanel || (port.name === STATUS_PORT && !sidepanelPage))) return
  if (sidepanel) browserReferences.addPanel(port)
  pages.add(port)
  port.onDisconnect.addListener(() => { pages.delete(port); windows.delete(port) })
  port.onMessage.addListener((message: FromSidepanel) => {
    if (typeof message !== "object" || message === null || message.type === "sidepanel.ready" || message.type === "reference.result") return
    if (message.type === "agents.reconnect") agents.reconnect()
    if (message.type === "tabs.cleanup") void TabCleanup.cleanup({ minutes: 0 })
    if (message.type === "autoUpdate.set") agents.setAutoUpdate(message.mode)
    if (message.type === "pairing.link")
      void agents.pairLink(message.code, message.port).then((ok) => post(port, { type: "pairing.link.result", ok }))
    if (message.type === "relay.connect")
      void connectRelay(message).then((result) => post(port, { type: "relay.result", ...result })).catch(() => post(port, { type: "relay.result", status: "untrusted" }))
    if (message.type === "tab.activeInfo") {
      if (Number.isInteger(message.windowId)) windows.set(port, message.windowId!)
      void sendActiveTab(port)
    }
    if (message.type === "tab.attachCurrent" || message.type === "tab.toggleAttach" || message.type === "tab.ensureAttached" || message.type === "handoff.complete")
      void handleTabRequest(port, message)
  })
  post(port, { type: "agents", state: agents.state() })
})

async function connectRelay(message: Extract<FromStatusPage, { type: "relay.connect" }>) {
  if (!message.ifNeeded) return agents.connectTo(message.address, message.code)
  if (agents.state().status === "connected") return { status: "connected" as const, address: agents.state().relay.address }
  if (!sidepanelConnect) sidepanelConnect = agents.connectTo(message.address, message.code).finally(() => { sidepanelConnect = undefined })
  return sidepanelConnect
}

async function tabInfo(tabId: number): Promise<ActiveTabInfo> {
  const tab = await chrome.tabs.get(tabId)
  const attached = agents.state().tabs.find((item) => item.tabId === tabId)
  return { tabId, windowId: tab.windowId, title: tab.title || "", url: tab.url || "", attached: !!attached,
    badge: agents.badge(tabId)?.text || "", pageStatus: attached?.status }
}

async function activeTab(windowId?: number) {
  const [tab] = await chrome.tabs.query(windowId === undefined ? { active: true, lastFocusedWindow: true } : { active: true, windowId })
  return tab?.id === undefined ? null : tabInfo(tab.id)
}

async function sendActiveTab(port: chrome.runtime.Port) {
  const tab = await activeTab(windows.get(port)).catch(() => null)
  post(port, { type: "tab.activeInfo", tab })
}

async function updateActiveTabs() {
  await Promise.all([...windows.keys()].map(sendActiveTab))
}

async function withTabOperation(tabId: number, action: () => Promise<void>) {
  const previous = tabOperations.get(tabId) ?? Promise.resolve()
  const operation = previous.catch(() => {}).then(action)
  tabOperations.set(tabId, operation)
  try { await operation } finally { if (tabOperations.get(tabId) === operation) tabOperations.delete(tabId) }
}

async function changeAttachment(tabId: number, ensure: boolean) {
  if (agents.state().status !== "connected") throw new Error("请先连接浏览器连接服务")
  const before = await tabInfo(tabId)
  if (ensure && before.attached) return
  const desired = ensure || !before.attached
  await agents.attachTab(tabId)
  const deadline = Date.now() + 8_000
  while ((await tabInfo(tabId)).attached !== desired) {
    if (Date.now() > deadline) throw new Error("标签页挂载未确认，请检查该页面是否支持调试")
    if (agents.state().status !== "connected") throw new Error("浏览器连接服务已断开，请重新连接")
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

function ensureAttached(tabId: number) {
  return withTabOperation(tabId, () => changeAttachment(tabId, true))
}

type TabRequest = Extract<FromStatusPage, { requestId: string }>
async function handleTabRequest(port: chrome.runtime.Port, message: TabRequest) {
  try {
    const current = message.type === "tab.attachCurrent" ? await activeTab(message.windowId ?? windows.get(port)) : null
    const tabId = message.type === "tab.attachCurrent" ? current?.tabId : message.tabId
    if (!Number.isInteger(tabId)) throw new Error("没有可操作的当前标签页")
    const id = tabId!
    await withTabOperation(id, async () => {
      if (message.type === "handoff.complete") {
        await tabInfo(id)
        agents.completeHandoff(id, message.handoffId)
        return
      }
      await changeAttachment(id, message.type === "tab.ensureAttached")
    })
    post(port, { type: "tab.result", requestId: message.requestId, ok: true, tab: await tabInfo(id).catch(() => undefined) })
    await sendActiveTab(port)
  } catch (error) {
    post(port, { type: "tab.result", requestId: message.requestId, ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const reference = browserReferences.runtimeMessage(message, sender, sendResponse)
  if (reference !== undefined) return reference
  const relay = agents.runtimeMessage(message, sender, sendResponse)
  if (relay !== undefined) return relay
  const page = sender.id === chrome.runtime.id && sender.url?.startsWith(`chrome-extension://${chrome.runtime.id}/`)
  if (!page || typeof message !== "object" || message?.action !== AGENT_DIAGNOSTICS) return false
  void agents.diagnostics().then(
    (text) => sendResponse({ text }),
    (error: unknown) => sendResponse({ text: `诊断失败：${String(error)}` }),
  )
  return true
})

chrome.runtime.onInstalled.addListener((details) => {
  void configureToolbar()
  if (details.reason === "install") void chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html?first-run") })
})
chrome.tabs.onActivated.addListener(() => { void updateActiveTabs() })
chrome.tabs.onRemoved.addListener(() => { void updateActiveTabs() })
chrome.tabs.onUpdated.addListener((_tabId, change, tab) => {
  if (change.url || change.status === "loading") void updateBadges([tab])
  if (change.url || change.title || change.status) void updateActiveTabs()
})
chrome.windows.onFocusChanged.addListener(() => { void updateActiveTabs() })
void chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS.default })
void chrome.action.setBadgeTextColor?.({ color: "#ffffff" })

async function updateBadges(tabs?: chrome.tabs.Tab[]) {
  const targets = tabs ?? (await chrome.tabs.query({}))
  await Promise.all(targets.map(async (tab) => {
    if (tab.id === undefined) return
    const badge = agents.badge(tab.id)
    await chrome.action.setBadgeText({ tabId: tab.id, text: badge?.text ?? "" }).catch(() => undefined)
    await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: BADGE_COLORS[badge?.text ?? ""] ?? BADGE_COLORS.default }).catch(() => undefined)
    await chrome.action.setTitle({ tabId: tab.id, title: badge?.title ?? "这是一个助手 · 打开侧栏对话与浏览器调试" }).catch(() => undefined)
  }))
}
function broadcast(message: ToStatusPage) { pages.forEach((port) => post(port, message)) }
function post(port: chrome.runtime.Port, message: ToStatusPage) {
  try { port.postMessage(message) } catch { pages.delete(port); windows.delete(port); browserReferences.removePanel(port) }
}
