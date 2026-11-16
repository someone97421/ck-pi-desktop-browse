import type { BrowserElementInfo, BrowserReference } from "../shared/browser-reference"
import type { FromSidepanel, ToSidepanel } from "../shared/protocol"
import { ELEMENT_PICKER_ENABLED_KEY, elementPickerEnabled } from "../shared/element-settings"

const MENU_ID = "send-to-agent"
const REQUEST_TIMEOUT = 70_000
const BROWSER_ID_KEY = "browserReferenceBrowserId"

export async function injectExistingPickers() {
  const tabs = await chrome.tabs.query({})
  await Promise.all(tabs.map(async (tab) => {
    if (tab.id === undefined || !/^(https?|file):/.test(tab.url || tab.pendingUrl || "")) return
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true }, files: ["element-picker.js"],
    }).catch(() => undefined)
  }))
}

type Panel = { windowId?: number; available: boolean; open: boolean }
type Pending = {
  port: chrome.runtime.Port
  resolve: () => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export function pageReference(tab: chrome.tabs.Tab): BrowserReference {
  if (tab.id === undefined) throw new Error("标签页已关闭，请重新选择")
  return { kind: "page", tabId: tab.id, windowId: tab.windowId, title: tab.title || "", url: tab.url || "" }
}

function elementInfo(value: unknown): BrowserElementInfo | undefined {
  if (!value || typeof value !== "object") return
  const info = value as Record<string, unknown>
  const keys = ["tag", "role", "name", "locator", "text", "context", "html", "pageTitle", "pageUrl", "size"] as const
  if (!keys.every((key) => typeof info[key] === "string")
    || !Array.isArray(info.attributes) || !info.attributes.every((attribute) => typeof attribute === "string")) return
  return {
    tag: info.tag as string, role: info.role as string, name: info.name as string, locator: info.locator as string,
    text: info.text as string, context: info.context as string, html: info.html as string,
    pageTitle: info.pageTitle as string, pageUrl: info.pageUrl as string, size: info.size as string,
    attributes: [...info.attributes],
  }
}

/** 内容脚本只能提供引用内容；标签页和 frame 身份取自 Chrome。 */
export function contentReference(value: unknown, tab: chrome.tabs.Tab, sender: chrome.runtime.MessageSender): BrowserReference {
  if (!value || typeof value !== "object" || !("kind" in value)) throw new Error("网页引用内容无效")
  const reference = pageReference(tab)
  if (value.kind === "element") {
    const element = elementInfo("element" in value ? value.element : undefined)
    if (!element) throw new Error("网页元素信息无效，请重新拾取")
    reference.kind = "element"
    reference.element = element
  } else if (value.kind === "selection") {
    if (!("selection" in value) || typeof value.selection !== "string" || !value.selection.trim()) throw new Error("没有可发送的选中文字")
    reference.kind = "selection"
    reference.selection = value.selection
  } else if (value.kind !== "page") throw new Error("不支持的网页引用类型")
  if (Number.isInteger(sender.frameId)) reference.frameId = sender.frameId
  if (sender.url) reference.frameUrl = sender.url
  return reference
}

export function createBrowserReferences(ensureAttached: (tabId: number) => Promise<void>) {
  const panels = new Map<chrome.runtime.Port, Panel>()
  const pending = new Map<string, Pending>()
  const pickerAvailability = new Map<number, boolean>()
  type Pick = { id: string; tabId: number; port: chrome.runtime.Port; timer?: ReturnType<typeof setTimeout>; ending?: boolean }
  const picks = new Map<string, Pick>()

  function stopPick(pick: Pick) {
    clearTimeout(pick.timer)
    picks.delete(pick.id)
    void chrome.tabs.sendMessage(pick.tabId, { type: "browser.pickerStop", sessionId: pick.id }).catch(() => undefined)
  }
  function cancelPicks(matches: (pick: Pick) => boolean) {
    for (const pick of picks.values()) if (matches(pick)) stopPick(pick)
  }
  async function startPick(port: chrome.runtime.Port, id: string, tabId: number) {
    cancelPicks((pick) => pick.port === port || pick.tabId === tabId)
    const pick: Pick = { id, tabId, port }
    picks.set(id, pick)
    pick.timer = setTimeout(() => stopPick(pick), 120_000)
    try {
      const panel = panels.get(port)
      if (!panel?.available || !panel.open) throw new Error("请先登录侧栏并等待连接就绪")
      const [tab, stored] = await Promise.all([chrome.tabs.get(tabId), chrome.storage.local.get(ELEMENT_PICKER_ENABLED_KEY)])
      if (!elementPickerEnabled(stored[ELEMENT_PICKER_ENABLED_KEY])) throw new Error("网页元素拾取已关闭，请到扩展设置中启用")
      if (!tab.active || tab.windowId !== panel.windowId) throw new Error("当前标签页已变化，请重新拖动抓手")
      if (!/^(https?|file):/.test(tab.url || "")) throw new Error("此 Chrome 页面不支持 DOM 捕捉，请切换到普通网页")
      if (picks.get(id) !== pick || pick.ending) return
      await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["element-picker.js"] })
      if (picks.get(id) !== pick || pick.ending) return
      await chrome.tabs.sendMessage(tabId, { type: "browser.pickerStart", sessionId: id })
      // 注入和消息期间可能发生取消；补发停止，避免残留高亮。
      if (picks.get(id) !== pick || pick.ending) {
        void chrome.tabs.sendMessage(tabId, { type: "browser.pickerStop", sessionId: id }).catch(() => undefined)
      }
    } catch (error) {
      if (picks.get(id) !== pick) return
      stopPick(pick)
      post(port, { type: "picker.result", sessionId: id, ok: false, error: error instanceof Error ? `无法捕捉当前网页：${error.message}` : "此网页不允许注入 DOM 捕捉脚本" })
    }
  }
  let refreshing = false
  let refreshNeeded = false
  let browserId = ""
  let browserIdPromise: Promise<string> | undefined

  function getBrowserId(): Promise<string> {
    browserIdPromise ??= (async () => {
      const stored = await chrome.storage.local.get(BROWSER_ID_KEY)
      const existing = stored[BROWSER_ID_KEY]
      if (typeof existing === "string" && existing.trim()) return browserId = existing
      const generated = crypto.randomUUID()
      await chrome.storage.local.set({ [BROWSER_ID_KEY]: generated })
      return browserId = generated
    })().catch((error: unknown) => {
      browserIdPromise = undefined
      throw new Error("无法读取或保存浏览器引用标识，请检查扩展存储后重试", { cause: error })
    })
    return browserIdPromise
  }

  function clearPanelTabs(port: chrome.runtime.Port, error?: string) {
    post(port, { type: "browser.tabs", browserId, active: false, tabs: [], ...(error ? { error } : {}) })
  }

  function candidates(windowId: number) {
    return [...panels].filter(([, panel]) => panel.windowId === windowId && panel.available && panel.open)
  }

  function deliveryCandidates(windowId: number) {
    const local = candidates(windowId)
    return local.length ? local : [...panels].filter(([, panel]) => panel.available && panel.open)
  }

  function failPending(port: chrome.runtime.Port, message: string) {
    for (const [id, item] of pending) {
      if (item.port !== port) continue
      clearTimeout(item.timer)
      pending.delete(id)
      item.reject(new Error(message))
    }
  }

  function removePanel(port: chrome.runtime.Port) {
    if (!panels.delete(port)) return
    cancelPicks((pick) => pick.port === port)
    failPending(port, "所属窗口的侧栏已断开，请重新打开并登录")
    refresh()
  }

  function post(port: chrome.runtime.Port, message: ToSidepanel): boolean {
    try { port.postMessage(message); return true }
    catch { removePanel(port); return false }
  }

  function refresh() {
    refreshNeeded = true
    if (!refreshing) void refreshTabs()
  }

  async function refreshTabs() {
    refreshing = true
    try {
      while (refreshNeeded) {
        refreshNeeded = false
        const [tabs, browserId] = await Promise.all([chrome.tabs.query({}), getBrowserId()])
        if (refreshNeeded) continue
        const references = tabs.filter((tab) => tab.id !== undefined).map(pageReference).sort((a, b) => a.tabId - b.tabId)
        for (const [port, panel] of panels) {
          const active = panel.available && panel.open
          post(port, { type: "browser.tabs", browserId, active, tabs: active ? references : [] })
        }
        await Promise.all(tabs.map(async (tab) => {
          if (tab.id === undefined) return
          const available = deliveryCandidates(tab.windowId).length === 1
          if (pickerAvailability.get(tab.id) === available) return
          pickerAvailability.set(tab.id, available)
          await chrome.tabs.sendMessage(tab.id, { type: "agent.pickerAvailability", available }).catch(() => undefined)
        }))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "浏览器标签列表读取失败，请重试"
      for (const [port] of panels) clearPanelTabs(port, message)
    } finally {
      refreshing = false
      if (refreshNeeded) refresh()
    }
  }

  function addPanel(port: chrome.runtime.Port) {
    panels.set(port, { available: false, open: true })
    port.onDisconnect.addListener(() => removePanel(port))
    port.onMessage.addListener((message: FromSidepanel) => {
      const panel = panels.get(port)
      if (!panel || !message || typeof message !== "object") return
      if (message.type === "sidepanel.ready") {
        if (!Number.isInteger(message.windowId) || message.windowId < 0 || typeof message.available !== "boolean") return
        if (panel.windowId === message.windowId && panel.available === message.available) return
        if (panel.windowId !== message.windowId || !message.available) failPending(port, "所属窗口的侧栏尚未登录或已离线")
        if (panel.windowId !== message.windowId || !message.available) cancelPicks((pick) => pick.port === port)
        panel.windowId = message.windowId
        panel.available = message.available
        if (!panel.available || !panel.open) clearPanelTabs(port)
        refresh()
      } else if (message.type === "picker.start" && typeof message.sessionId === "string" && /^[a-z0-9-]{1,80}$/.test(message.sessionId) && Number.isInteger(message.tabId)) {
        void startPick(port, message.sessionId, message.tabId)
      } else if (message.type === "picker.end") {
        const pick = picks.get(message.sessionId)
        if (!pick || pick.port !== port) return
        if (message.cancel) stopPick(pick)
        else {
          // drop 与源 document 的 dragend 分属不同进程，保留短暂认领窗口。
          pick.ending = true
          clearTimeout(pick.timer)
          pick.timer = setTimeout(() => stopPick(pick), 250)
        }
      } else if (message.type === "reference.result" && typeof message.requestId === "string") {
        const item = pending.get(message.requestId)
        if (!item || item.port !== port) return
        clearTimeout(item.timer)
        pending.delete(message.requestId)
        if (message.ok === true && panel.available && panel.open) item.resolve()
        else item.reject(new Error(typeof message.error === "string" ? message.error : "主程序未确认插入网页引用"))
      }
    })
    refresh()
  }

  async function deliver(reference: BrowserReference, expectedPort?: chrome.runtime.Port) {
    if (reference.windowId === undefined) throw new Error("无法确定来源窗口，请在原窗口重试")
    const targets = deliveryCandidates(reference.windowId)
    if (!targets.length) throw new Error("请先打开 Agent 侧栏，登录并等待连接就绪")
    if (targets.length !== 1) throw new Error("有多个可用侧栏，无法确定接收位置，请在来源窗口打开侧栏后重试")
    const port = targets[0]![0]
    if (expectedPort && expectedPort !== port) throw new Error("接收侧栏已变化，请重新拖动抓手")
    await ensureAttached(reference.tabId)
    const confirmed = deliveryCandidates(reference.windowId)
    if (confirmed.length !== 1 || confirmed[0]![0] !== port) throw new Error("接收侧栏已变化，请重新发送网页引用")
    await new Promise<void>((resolve, reject) => {
      const requestId = crypto.randomUUID()
      const timer = setTimeout(() => {
        pending.delete(requestId)
        reject(new Error("侧栏未确认插入网页引用，请检查连接后重试"))
      }, REQUEST_TIMEOUT)
      pending.set(requestId, { port, resolve, reject, timer })
      post(port, { type: "reference.request", requestId, reference })
    })
  }

  function runtimeMessage(message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (value: unknown) => void): true | undefined {
    if (!message || typeof message !== "object" || !("type" in message)
      || !["agent.pickerAvailability", "agent.reference", "browser.elementPicked", "browser.pickerCancel"].includes(String(message.type))) return
    void (async () => {
      if (sender.id !== chrome.runtime.id || sender.tab?.id === undefined) throw new Error("无法确认引用来源标签页")
      if (message.type === "browser.pickerCancel") {
        const pick = "sessionId" in message && typeof message.sessionId === "string" ? picks.get(message.sessionId) : undefined
        if (pick?.tabId === sender.tab.id) stopPick(pick)
        sendResponse({ ok: true }); return
      }
      const pick = message.type === "browser.elementPicked" && "sessionId" in message && typeof message.sessionId === "string" ? picks.get(message.sessionId) : undefined
      if (message.type === "browser.elementPicked") {
        if (!pick || pick.tabId !== sender.tab.id) throw new Error("此次 DOM 捕捉已取消或已处理，请重新拖动抓手")
        // 在第一个 await 前认领，跨 frame 的重复请求不能重复投递。
        stopPick(pick)
      }
      try {
        const tab = await chrome.tabs.get(sender.tab.id)
        if (message.type === "agent.pickerAvailability") {
          sendResponse({ available: deliveryCandidates(tab.windowId).length === 1 })
          return
        }
        const reference = contentReference("reference" in message ? message.reference : undefined, tab, sender)
        if (pick && reference.kind !== "element") throw new Error("DOM 捕捉内容无效")
        await deliver(reference, pick?.port)
        if (pick) post(pick.port, { type: "picker.result", sessionId: pick.id, ok: true })
        sendResponse({ ok: true })
      } catch (error) {
        if (pick) post(pick.port, { type: "picker.result", sessionId: pick.id, ok: false, error: error instanceof Error ? error.message : "元素引用发送失败" })
        throw error
      }
    })().catch((error: unknown) => {
      const text = error instanceof Error ? error.message : "网页引用发送失败"
      sendResponse(message.type === "agent.pickerAvailability" ? { available: false } : { ok: false, error: text })
    })
    return true
  }

  function registerMenu() {
    const properties = { title: "发送给Agent", contexts: ["all"] as ["all"] }
    chrome.contextMenus.update(MENU_ID, properties, () => {
      if (!chrome.runtime.lastError) return
      chrome.contextMenus.create({ id: MENU_ID, ...properties }, () => { void chrome.runtime.lastError })
    })
  }
  chrome.runtime.onInstalled.addListener(() => {
    registerMenu()
    void injectExistingPickers().catch(() => undefined)
  })
  registerMenu()
  chrome.contextMenus.onClicked.addListener((info, clickedTab) => {
    if (info.menuItemId !== MENU_ID) return
    void (async () => {
      if (clickedTab?.id === undefined) throw new Error("无法确认来源标签页，请在原页面重试")
      const reference = pageReference(await chrome.tabs.get(clickedTab.id))
      if (info.selectionText?.trim()) { reference.kind = "selection"; reference.selection = info.selectionText }
      if (Number.isInteger(info.frameId)) reference.frameId = info.frameId
      if (info.frameUrl) reference.frameUrl = info.frameUrl
      await deliver(reference)
    })().catch((error: unknown) => {
      void chrome.notifications.create({
        type: "basic", title: "这是一个助手", iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
        message: error instanceof Error ? error.message : "网页引用发送失败，请检查侧栏连接",
      }).catch(() => undefined)
    })
  })

  chrome.tabs.onCreated.addListener(refresh)
  chrome.tabs.onUpdated.addListener(refresh)
  chrome.tabs.onRemoved.addListener((tabId) => { pickerAvailability.delete(tabId); refresh() })
  chrome.tabs.onAttached.addListener(refresh)
  chrome.tabs.onDetached.addListener(refresh)
  chrome.tabs.onReplaced.addListener((_, removedTabId) => { pickerAvailability.delete(removedTabId); refresh() })
  chrome.tabs.onActivated.addListener((info) => cancelPicks((pick) => pick.tabId !== info.tabId && panels.get(pick.port)?.windowId === info.windowId))
  chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (change?.status === "loading" || change?.url) cancelPicks((pick) => pick.tabId === tabId)
  })
  chrome.tabs.onRemoved.addListener((tabId) => cancelPicks((pick) => pick.tabId === tabId))
  chrome.tabs.onDetached.addListener((tabId) => cancelPicks((pick) => pick.tabId === tabId))
  chrome.tabs.onReplaced.addListener((_, tabId) => cancelPicks((pick) => pick.tabId === tabId))
  chrome.windows.onFocusChanged.addListener((windowId) => cancelPicks((pick) => panels.get(pick.port)?.windowId !== windowId))
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && ELEMENT_PICKER_ENABLED_KEY in changes && !elementPickerEnabled(changes[ELEMENT_PICKER_ENABLED_KEY]?.newValue)) cancelPicks(() => true)
  })

  type PanelEvent = { windowId: number }
  const panelEvents = chrome.sidePanel as typeof chrome.sidePanel & {
    onClosed?: chrome.events.Event<(info: PanelEvent) => void>
    onOpened?: chrome.events.Event<(info: PanelEvent) => void>
  }
  function setOpen(windowId: number, open: boolean) {
    for (const [port, panel] of panels) {
      if (panel.windowId !== windowId) continue
      panel.open = open
      if (!open) {
        cancelPicks((pick) => pick.port === port)
        failPending(port, "所属窗口的侧栏已关闭，请重新打开")
        clearPanelTabs(port)
      }
    }
    refresh()
  }
  panelEvents.onClosed?.addListener((info) => setOpen(info.windowId, false))
  panelEvents.onOpened?.addListener((info) => setOpen(info.windowId, true))

  return { addPanel, removePanel, runtimeMessage }
}
