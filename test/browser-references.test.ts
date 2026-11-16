import { afterEach, describe, expect, test } from "bun:test"
import { contentReference, createBrowserReferences, injectExistingPickers, pageReference } from "../src/background/browser-references"
import { confirmedInsertion, tabReference } from "../src/sidepanel/context"
import type { FromSidepanel, ToSidepanel } from "../src/shared/protocol"

const tab = { id: 42, windowId: 8, active: true, title: "主页面", url: "https://example.test/" } as chrome.tabs.Tab
const originalChrome = globalThis.chrome
afterEach(() => { globalThis.chrome = originalChrome })

function event<T extends unknown[]>() {
  const listeners = new Set<(...args: T) => void>()
  return {
    addListener: (listener: (...args: T) => void) => { listeners.add(listener) },
    emit: (...args: T) => { for (const listener of listeners) listener(...args) },
  }
}

function setup(options: { storedId?: string | null; failWrite?: boolean; tabs?: chrome.tabs.Tab[]; ensureAttached?: (tabId: number) => Promise<void> } = {}) {
  const onClosed = event<[{ windowId: number }]>()
  const changed = event<unknown[]>()
  const activated = event<[{ tabId: number; windowId: number }]>(), focused = event<[number]>()
  const storageChanged = event<[Record<string, chrome.storage.StorageChange>, string]>()
  const menu: { id: string; properties: unknown }[] = []
  const availability: { tabId: number; message: unknown }[] = []
  const getIds: number[] = []
  const installed = event<[]>()
  const storage = { reads: 0, writes: 0, values: { browserReferenceBrowserId: options.storedId === null ? undefined : options.storedId ?? "browser-profile" } as Record<string, unknown> }
  const injections: { target: { tabId: number; allFrames?: boolean }; files?: string[] }[] = []
  const attachments: number[] = []
  const notifications: unknown[] = []
  const clicked = event<[chrome.contextMenus.OnClickData, chrome.tabs.Tab?]>()
  globalThis.chrome = {
    runtime: { id: "extension", onInstalled: installed, getURL: (path: string) => `chrome-extension://extension/${path}` },
    storage: { onChanged: storageChanged, local: {
      get: async () => { storage.reads++; return { ...storage.values } },
      set: async (values: Record<string, unknown>) => {
        storage.writes++
        if (options.failWrite) throw new Error("存储不可写")
        Object.assign(storage.values, values)
      },
    } },
    scripting: { executeScript: async (injection: typeof injections[number]) => { injections.push(injection); if (injection.target.tabId === 44) throw new Error("受限页面") } },
    tabs: {
      get: async (id: number) => { getIds.push(id); return { ...(options.tabs?.find((item) => item.id === id) ?? tab), id } },
      query: async () => options.tabs ?? [tab, { ...tab, id: 43, windowId: 9, title: "未借出的标签" }],
      sendMessage: async (tabId: number, message: unknown) => { availability.push({ tabId, message }) },
      onCreated: changed, onUpdated: changed, onRemoved: event<unknown[]>(), onAttached: changed,
      onDetached: changed, onReplaced: event<unknown[]>(),
      onActivated: activated,
    },
    contextMenus: {
      update: (id: string, properties: unknown, done: () => void) => { menu.push({ id, properties }); done() },
      create: () => {}, onClicked: clicked,
    },
    notifications: { create: async (notification: unknown) => { notifications.push(notification); return "notification" } },
    windows: { onFocusChanged: focused },
    sidePanel: { onClosed, onOpened: event<[{ windowId: number }]>() },
  } as unknown as typeof chrome
  const service = createBrowserReferences(async (tabId) => {
    attachments.push(tabId)
    await options.ensureAttached?.(tabId)
  })
  function panel(windowId: number, available = true) {
    const inbox = event<[FromSidepanel]>(), disconnected = event<[]>()
    const sent: ToSidepanel[] = []
    const port = { onMessage: inbox, onDisconnect: disconnected, postMessage: (value: ToSidepanel) => { sent.push(value) } } as unknown as chrome.runtime.Port
    service.addPanel(port)
    inbox.emit({ type: "sidepanel.ready", windowId, available })
    return { inbox, disconnected, sent, port }
  }
  const sender: chrome.runtime.MessageSender = { id: "extension", tab, frameId: 7, url: "https://frame.test/" }
  const request = (responses: unknown[]) => service.runtimeMessage({ type: "agent.reference", reference: { kind: "page", tabId: 999, windowId: 999 } }, sender, (response) => { responses.push(response) })
  return { ...service, panel, request, onClosed, menu, availability, getIds, changed, installed, storage, injections, attachments, notifications, clicked, activated, focused, storageChanged }
}

async function flush() { for (let step = 0; step < 24; step++) await Promise.resolve() }

describe("网页引用身份与回执", () => {
  test("页面 chip 保留真实标签页信息，不增加借用状态", () => {
    expect(pageReference(tab)).toEqual({ kind: "page", tabId: 42, windowId: 8, title: "主页面", url: "https://example.test/" })
    expect(tabReference({ tabId: 42, windowId: 8, title: "主页面", url: "https://example.test/" })).toEqual(pageReference(tab))
  })
  test("内容脚本不能伪造标签页、窗口和 frame 身份", () => {
    const reference = contentReference({ kind: "selection", selection: "选中文字", tabId: 999, windowId: 999, frameId: 99, frameUrl: "https://forged.test/" }, tab, { frameId: 7, url: "https://frame.test/" })
    expect(reference).toEqual({ ...pageReference(tab), kind: "selection", selection: "选中文字", frameId: 7, frameUrl: "https://frame.test/" })
    expect(() => contentReference({ kind: "selection", selection: "  " }, tab, {})).toThrow()
    expect(() => contentReference({ kind: "element", element: { tag: "input" } }, tab, {})).toThrow()
  })
  test("空结果或没有明确接收 client 的结果不能冒充成功", () => {
    for (const result of [undefined, null, {}, { inserted: true }, { inserted: false, clientId: "a" }, { inserted: true, clientId: " " }]) expect(confirmedInsertion(result)).toBe(false)
    expect(confirmedInsertion({ inserted: true, clientId: "agent-a" })).toBe(true)
  })
  test("菜单使用稳定 ID、精确标题并覆盖全部网页右键位置", () => {
    const service = setup()
    expect(service.menu[0]).toEqual({ id: "send-to-agent", properties: { title: "发送给Agent", contexts: ["all"] } })
  })
  test("只投给来源窗口，且必须等待该端口的成功回执", async () => {
    const service = setup(), current = service.panel(8), other = service.panel(9)
    const responses: unknown[] = []
    service.request(responses)
    await flush()
    const request = current.sent.find((message) => message.type === "reference.request")
    expect(request?.type).toBe("reference.request")
    if (request?.type !== "reference.request") throw new Error("没有定向投递")
    expect(request.reference.tabId).toBe(42)
    expect(service.getIds).toContain(42)
    expect(other.sent.some((message) => message.type === "reference.request")).toBe(false)
    expect(responses).toEqual([])
    other.inbox.emit({ type: "reference.result", requestId: request.requestId, ok: true })
    await flush()
    expect(responses).toEqual([])
    current.inbox.emit({ type: "reference.result", requestId: request.requestId, ok: true })
    await flush()
    expect(responses).toEqual([{ ok: true }])
  })
  test("来源窗口没有可用侧栏时可借助另一窗口的唯一侧栏转发", async () => {
    const service = setup(), other = service.panel(9), loggedOut = service.panel(8, false)
    const responses: unknown[] = []
    service.request(responses)
    await flush()
    const request = other.sent.find((message) => message.type === "reference.request")
    if (request?.type !== "reference.request") throw new Error("没有跨窗口转发")
    expect(loggedOut.sent.some((message) => message.type === "reference.request")).toBe(false)
    other.inbox.emit({ type: "reference.result", requestId: request.requestId, ok: true })
    await flush()
    expect(responses).toEqual([{ ok: true }])
  })
  test("只有未登录侧栏时明确失败", async () => {
    const service = setup()
    service.panel(8, false)
    const responses: unknown[] = []
    service.request(responses)
    await flush()
    expect(responses).toEqual([{ ok: false, error: expect.stringContaining("登录") }])
  })
  test("同窗口多个可用侧栏会明确失败，不随机选择", async () => {
    const service = setup()
    service.panel(8); service.panel(8)
    const responses: unknown[] = []
    service.request(responses)
    await flush()
    expect(responses).toEqual([{ ok: false, error: expect.stringContaining("多个") }])
  })
  test("端口断开清理正在等待的引用并广播不可用", async () => {
    const service = setup(), current = service.panel(8)
    const responses: unknown[] = []
    service.request(responses)
    await flush()
    current.disconnected.emit()
    await flush()
    expect(responses).toEqual([{ ok: false, error: expect.stringContaining("断开") }])
    expect(service.availability).toContainEqual({ tabId: 42, message: { type: "agent.pickerAvailability", available: false } })
  })
  test("真实关闭时清空列表，列表包含未借出的标签", async () => {
    const service = setup(), current = service.panel(8)
    await flush()
    const listing = current.sent.find((message) => message.type === "browser.tabs" && message.active)
    if (listing?.type !== "browser.tabs") throw new Error("没有标签列表")
    expect(listing.tabs.map((reference) => reference.tabId)).toEqual([42, 43])
    expect(listing.tabs.every((reference) => reference.kind === "page")).toBe(true)
    service.onClosed.emit({ windowId: 8 })
    await flush()
    expect(current.sent.at(-1)).toEqual({ type: "browser.tabs", browserId: "browser-profile", active: false, tabs: [] })
  })
  test("同 profile 多侧栏共用已保存的 browserId", async () => {
    const service = setup(), first = service.panel(8), second = service.panel(9)
    await flush()
    for (const panel of [first, second]) {
      expect(panel.sent).toContainEqual(expect.objectContaining({ type: "browser.tabs", browserId: "browser-profile", active: true }))
    }
    expect(service.storage.reads).toBe(1)
    expect(service.storage.writes).toBe(0)
  })
  test("缺省 ID 只生成保存一次，重启复用，另一 profile 生成不同 ID", async () => {
    const first = setup({ storedId: null })
    first.panel(8); first.panel(9)
    first.changed.emit(); first.changed.emit()
    await flush()
    const id = first.storage.values.browserReferenceBrowserId
    expect(typeof id).toBe("string")
    expect(first.storage.writes).toBe(1)
    const restarted = setup({ storedId: id as string }), panel = restarted.panel(8)
    await flush()
    expect(panel.sent).toContainEqual(expect.objectContaining({ browserId: id, active: true }))
    expect(restarted.storage.writes).toBe(0)
    const other = setup({ storedId: null })
    other.panel(8)
    await flush()
    expect(other.storage.values.browserReferenceBrowserId).not.toBe(id)
  })
  test("ID 保存失败不会上报临时 ID 或有效列表", async () => {
    const service = setup({ storedId: null, failWrite: true }), panel = service.panel(8)
    await flush()
    expect(panel.sent.some((message) => message.type === "browser.tabs" && message.active)).toBe(false)
    expect(panel.sent.at(-1)).toEqual({ type: "browser.tabs", browserId: "", active: false, tabs: [], error: expect.stringContaining("浏览器引用标识") })
    expect(service.storage.values.browserReferenceBrowserId).toBeUndefined()
  })
  test("安装后只向普通页面补注入 picker，受限页失败不影响其他标签", async () => {
    const service = setup({ tabs: [tab, { ...tab, id: 43, url: "chrome://extensions/" }, { ...tab, id: 44, url: "https://chromewebstore.google.com/" }] })
    service.installed.emit()
    await flush()
    expect(service.injections).toEqual([
      { target: { tabId: 42, allFrames: true }, files: ["element-picker.js"] },
      { target: { tabId: 44, allFrames: true }, files: ["element-picker.js"] },
    ])
    await expect(injectExistingPickers()).resolves.toBeUndefined()
  })
  test("原标签页接入确认前不发送 chip，确认后仍等待插入回执", async () => {
    let attached!: () => void
    const waiting = new Promise<void>((resolve) => { attached = resolve })
    const service = setup({ ensureAttached: () => waiting }), panel = service.panel(8)
    const responses: unknown[] = []
    service.request(responses)
    await flush()
    expect(service.attachments).toEqual([42])
    expect(panel.sent.some((message) => message.type === "reference.request")).toBe(false)
    expect(responses).toEqual([])
    attached()
    await flush()
    const request = panel.sent.find((message) => message.type === "reference.request")
    if (request?.type !== "reference.request") throw new Error("接入后没有发送引用")
    expect(responses).toEqual([])
    panel.inbox.emit({ type: "reference.result", requestId: request.requestId, ok: true })
    await flush()
    expect(responses).toEqual([{ ok: true }])
  })
  test("选文和元素接入失败明确返回错误，不向侧栏发送引用", async () => {
    const element = { tag: "button", role: "button", name: "提交", locator: "#submit", text: "提交", context: "表单", html: "<button>提交</button>", pageTitle: "页面", pageUrl: tab.url!, size: "40x20", attributes: [] }
    for (const reference of [{ kind: "selection", selection: "选中文字" }, { kind: "element", element }]) {
      const service = setup({ ensureAttached: async () => { throw new Error("标签页接入失败") } }), panel = service.panel(8)
      const responses: unknown[] = []
      service.runtimeMessage({ type: "agent.reference", reference }, { id: "extension", tab }, (value) => { responses.push(value) })
      await flush()
      expect(service.attachments).toEqual([42])
      expect(responses).toEqual([{ ok: false, error: "标签页接入失败" }])
      expect(panel.sent.some((message) => message.type === "reference.request")).toBe(false)
    }
  })
  test("右键接入失败通过通知返回错误，不发送引用", async () => {
    const service = setup({ ensureAttached: async () => { throw new Error("无法接入原标签页") } }), panel = service.panel(8)
    service.clicked.emit({ menuItemId: "send-to-agent", editable: false, selectionText: "选文" }, tab)
    await flush()
    expect(service.attachments).toEqual([42])
    expect(panel.sent.some((message) => message.type === "reference.request")).toBe(false)
    expect(service.notifications).toContainEqual(expect.objectContaining({ message: "无法接入原标签页" }))
  })
  test("没有接收目标时不接入标签页", async () => {
    const service = setup(), responses: unknown[] = []
    service.request(responses)
    await flush()
    expect(service.attachments).toEqual([])
    expect(responses).toEqual([{ ok: false, error: expect.stringContaining("侧栏") }])
  })
  test("接入期间侧栏断开时明确失败，不投递到失效端口", async () => {
    let attached!: () => void
    const waiting = new Promise<void>((resolve) => { attached = resolve })
    const service = setup({ ensureAttached: () => waiting }), panel = service.panel(8)
    const responses: unknown[] = []
    service.request(responses)
    await flush()
    panel.disconnected.emit()
    attached()
    await flush()
    expect(responses).toEqual([{ ok: false, error: expect.stringContaining("接收侧栏已变化") }])
    expect(panel.sent.some((message) => message.type === "reference.request")).toBe(false)
  })
})

describe("侧栏抓手捕捉会话", () => {
  const element = { tag: "button", role: "button", name: "提交", locator: "#submit", text: "提交", context: "表单", html: "<button>提交</button>", pageTitle: "页面", pageUrl: tab.url!, size: "40x20", attributes: [] }
  function picked(service: ReturnType<typeof setup>, id: string, responses: unknown[], frameId = 7) {
    service.runtimeMessage({ type: "browser.elementPicked", sessionId: id, reference: { kind: "element", element } }, { id: "extension", tab, frameId, url: `https://frame-${frameId}.test/` }, (response) => responses.push(response))
  }
  test("启动注入所有 frame，跨 frame 只认领一次并等待真实插入回执", async () => {
    const service = setup(), panel = service.panel(8), first: unknown[] = [], duplicate: unknown[] = []
    panel.inbox.emit({ type: "picker.start", sessionId: "drag-1", tabId: 42 })
    await flush()
    expect(service.injections).toContainEqual({ target: { tabId: 42, allFrames: true }, files: ["element-picker.js"] })
    expect(service.availability).toContainEqual({ tabId: 42, message: { type: "browser.pickerStart", sessionId: "drag-1" } })
    picked(service, "drag-1", first, 7)
    picked(service, "drag-1", duplicate, 9)
    await flush()
    expect(first).toEqual([])
    expect(duplicate).toEqual([{ ok: false, error: expect.stringContaining("已处理") }])
    const requests = panel.sent.filter((item) => item.type === "reference.request")
    expect(requests).toHaveLength(1)
    const request = requests[0]!
    if (request.type !== "reference.request") throw new Error("没有投递 DOM chip")
    expect(request.reference).toMatchObject({ tabId: 42, frameId: 7, frameUrl: "https://frame-7.test/" })
    expect(panel.sent.some((item) => item.type === "picker.result")).toBe(false)
    panel.inbox.emit({ type: "reference.result", requestId: request.requestId, ok: true })
    await flush()
    expect(first).toEqual([{ ok: true }])
    expect(panel.sent.at(-1)).toEqual({ type: "picker.result", sessionId: "drag-1", ok: true })
    panel.disconnected.emit()
  })
  test("源 dragend 先抵达后台时，已发出的 drop 仍可认领", async () => {
    const service = setup(), panel = service.panel(8), responses: unknown[] = []
    panel.inbox.emit({ type: "picker.start", sessionId: "drag-race", tabId: 42 })
    await flush()
    panel.inbox.emit({ type: "picker.end", sessionId: "drag-race", cancel: false })
    picked(service, "drag-race", responses)
    await flush()
    const request = panel.sent.find((item) => item.type === "reference.request")
    if (request?.type !== "reference.request") throw new Error("drop 被 dragend 错误取消")
    panel.inbox.emit({ type: "reference.result", requestId: request.requestId, ok: false, error: "草稿已切换" })
    await flush()
    expect(responses).toEqual([{ ok: false, error: "草稿已切换" }])
    expect(panel.sent.at(-1)).toMatchObject({ type: "picker.result", ok: false, error: "草稿已切换" })
    panel.disconnected.emit()
  })
  test("取消、失焦、切页、关闭与禁用后不投递 chip", async () => {
    for (const reason of ["cancel", "focus", "tab", "navigate", "close", "disconnect", "disabled"] as const) {
      const service = setup(), panel = service.panel(8), responses: unknown[] = []
      panel.inbox.emit({ type: "picker.start", sessionId: "drag-cancel", tabId: 42 })
      await flush()
      if (reason === "cancel") panel.inbox.emit({ type: "picker.end", sessionId: "drag-cancel", cancel: true })
      if (reason === "focus") service.focused.emit(-1)
      if (reason === "tab") service.activated.emit({ tabId: 43, windowId: 8 })
      if (reason === "navigate") service.changed.emit(42, { status: "loading" })
      if (reason === "close") service.onClosed.emit({ windowId: 8 })
      if (reason === "disconnect") panel.disconnected.emit()
      if (reason === "disabled") service.storageChanged.emit({ elementPickerEnabled: { newValue: false } }, "local")
      picked(service, "drag-cancel", responses)
      await flush()
      expect(responses).toEqual([{ ok: false, error: expect.stringContaining("已取消") }])
      expect(panel.sent.some((item) => item.type === "reference.request")).toBe(false)
      expect(service.availability).toContainEqual({ tabId: 42, message: { type: "browser.pickerStop", sessionId: "drag-cancel" } })
      panel.disconnected.emit()
    }
  })
  test("受限页面、注入失败与关闭开关都明确返回错误", async () => {
    for (const reason of ["chrome", "injection", "disabled"] as const) {
      const target = { ...tab, id: reason === "injection" ? 44 : 42, url: reason === "chrome" ? "chrome://settings/" : tab.url }
      const service = setup({ tabs: [target] }), panel = service.panel(8)
      if (reason === "disabled") service.storage.values.elementPickerEnabled = false
      panel.inbox.emit({ type: "picker.start", sessionId: "drag-error", tabId: target.id! })
      await flush()
      expect(panel.sent).toContainEqual(expect.objectContaining({ type: "picker.result", sessionId: "drag-error", ok: false, error: expect.any(String) }))
      expect(panel.sent.some((item) => item.type === "reference.request")).toBe(false)
      panel.disconnected.emit()
    }
  })
  test("旧修饰键存储不影响抓手启用，不重写旧值", async () => {
    const service = setup(), panel = service.panel(8)
    service.storage.values.showweb_modifiers = ["ctrl"]
    panel.inbox.emit({ type: "picker.start", sessionId: "drag-legacy", tabId: 42 })
    await flush()
    expect(service.availability).toContainEqual({ tabId: 42, message: { type: "browser.pickerStart", sessionId: "drag-legacy" } })
    expect(service.storage.values.showweb_modifiers).toEqual(["ctrl"])
    expect(service.storage.writes).toBe(0)
    panel.disconnected.emit()
  })
})
