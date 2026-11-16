import { afterEach, describe, expect, test } from "bun:test"
import { contentReference, createBrowserReferences, injectExistingPickers, pageReference } from "../src/background/browser-references"
import { confirmedInsertion, tabReference } from "../src/sidepanel/context"
import type { FromSidepanel, ToSidepanel } from "../src/shared/protocol"

const tab = { id: 42, windowId: 8, title: "主页面", url: "https://example.test/" } as chrome.tabs.Tab
const originalChrome = globalThis.chrome
afterEach(() => { globalThis.chrome = originalChrome })

function event<T extends unknown[]>() {
  const listeners = new Set<(...args: T) => void>()
  return {
    addListener: (listener: (...args: T) => void) => { listeners.add(listener) },
    emit: (...args: T) => { for (const listener of listeners) listener(...args) },
  }
}

function setup(options: { storedId?: string | null; failWrite?: boolean; tabs?: chrome.tabs.Tab[] } = {}) {
  const onClosed = event<[{ windowId: number }]>()
  const changed = event<unknown[]>()
  const menu: { id: string; properties: unknown }[] = []
  const availability: { tabId: number; message: unknown }[] = []
  const getIds: number[] = []
  const installed = event<[]>()
  const storage = { reads: 0, writes: 0, values: { browserReferenceBrowserId: options.storedId === null ? undefined : options.storedId ?? "browser-profile" } as Record<string, unknown> }
  const injections: { target: { tabId: number; allFrames?: boolean }; files?: string[] }[] = []
  globalThis.chrome = {
    runtime: { id: "extension", onInstalled: installed, getURL: (path: string) => `chrome-extension://extension/${path}` },
    storage: { local: {
      get: async () => { storage.reads++; return { ...storage.values } },
      set: async (values: Record<string, unknown>) => {
        storage.writes++
        if (options.failWrite) throw new Error("存储不可写")
        Object.assign(storage.values, values)
      },
    } },
    scripting: { executeScript: async (injection: typeof injections[number]) => { injections.push(injection); if (injection.target.tabId === 44) throw new Error("受限页面") } },
    tabs: {
      get: async (id: number) => { getIds.push(id); return { ...tab, id } },
      query: async () => options.tabs ?? [tab, { ...tab, id: 43, windowId: 9, title: "未借出的标签" }],
      sendMessage: async (tabId: number, message: unknown) => { availability.push({ tabId, message }) },
      onCreated: changed, onUpdated: changed, onRemoved: event<unknown[]>(), onAttached: changed,
      onDetached: changed, onReplaced: event<unknown[]>(),
    },
    contextMenus: {
      update: (id: string, properties: unknown, done: () => void) => { menu.push({ id, properties }); done() },
      create: () => {}, onClicked: event<unknown[]>(),
    },
    notifications: { create: async () => "notification" },
    sidePanel: { onClosed, onOpened: event<[{ windowId: number }]>() },
  } as unknown as typeof chrome
  const service = createBrowserReferences()
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
  return { ...service, panel, request, onClosed, menu, availability, getIds, changed, installed, storage, injections }
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
})
