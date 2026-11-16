import { afterEach, describe, expect, test } from "bun:test"
import { extensionContextAvailable, installElementPicker, pickerErrorMessage } from "../src/content/element-picker"
import { elementDragType, isElementDrag } from "../src/shared/element-settings"

const keys = ["chrome", "window", "document", "location", "requestAnimationFrame", "cancelAnimationFrame"] as const
const original = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
afterEach(() => {
  for (const key of keys) {
    const descriptor = original.get(key)
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
})
function replace(key: typeof keys[number], value: unknown) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
}
function setup() {
  const page = new EventTarget(), view = new EventTarget()
  const sent: any[] = [], points: number[][] = []
  const listeners = new Set<(message: unknown) => void>()
  const frames = new Map<number, FrameRequestCallback>()
  let removed = 0, next = 0
  const node = () => ({
    style: { setProperty() {}, cssText: "" }, hidden: false,
    attachShadow: () => ({ append() {} }), remove: () => { removed++ },
  })
  const element: any = {
    tagName: "BUTTON", localName: "button", id: "save", classList: [], textContent: "保存", parentElement: null,
    getAttribute: () => null, hasAttribute: () => false,
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 40, height: 30 }),
    getRootNode: () => page,
  }
  const runtime = {
    id: "extension",
    onMessage: { addListener: (listener: (message: unknown) => void) => listeners.add(listener), removeListener: (listener: (message: unknown) => void) => listeners.delete(listener) },
    sendMessage: async (message: unknown) => { sent.push(message); return { ok: true } },
  }
  Object.assign(page, {
    hidden: false, title: "页面", location: { href: "https://frame.test/" },
    documentElement: { append() {} }, createElement: node, querySelectorAll: () => [element],
    elementFromPoint: (x: number, y: number) => { points.push([x, y]); return element },
  })
  element.ownerDocument = page
  replace("window", view); replace("document", page); replace("location", { href: "https://frame.test/" })
  replace("chrome", { runtime })
  replace("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++next, callback); return next })
  replace("cancelAnimationFrame", (id: number) => { frames.delete(id) })
  const dispose = installElementPicker()
  function drag(type: string, types = [elementDragType("pick-1")], x = 12, y = 24) {
    const event = Object.assign(new Event(type, { cancelable: true }), { clientX: x, clientY: y, dataTransfer: { types, dropEffect: "none" } })
    view.dispatchEvent(event)
    return event
  }
  function message(value: unknown) { for (const listener of listeners) listener(value) }
  function draw() { for (const [id, callback] of frames) { frames.delete(id); callback(0) } }
  return { dispose, drag, message, draw, page, view, runtime, sent, points, element, frames, listeners, removed: () => removed }
}

describe("侧栏拖动拾取", () => {
  test("保留后台错误内容，短 hint 压缩空白并截断", () => {
    expect(pickerErrorMessage({ error: "没有可用 Agent\n请在主程序选择会话" })).toBe("没有可用 Agent 请在主程序选择会话")
    expect(pickerErrorMessage({ error: "错".repeat(200) })).toHaveLength(160)
    expect(pickerErrorMessage(undefined)).toContain("未添加")
  })
  test("专用标记绑定本次拖动，网页原生拖动不匹配", () => {
    expect(isElementDrag(["text/plain"], "pick-1")).toBe(false)
    expect(isElementDrag([elementDragType("other")], "pick-1")).toBe(false)
    expect(isElementDrag([elementDragType("pick-1")])).toBe(false)
    expect(isElementDrag([elementDragType("pick-1")], "pick-1")).toBe(true)
  })
  test("只有后台启动后的抓手拖动才高亮，使用当前 frame 坐标，drop 仅发送一次", async () => {
    const picker = setup()
    try {
      expect(picker.drag("dragover").defaultPrevented).toBe(false)
      picker.message({ type: "browser.pickerStart", sessionId: "pick-1" })
      expect(picker.drag("dragover", ["text/plain"]).defaultPrevented).toBe(false)
      expect(picker.drag("dragover").defaultPrevented).toBe(true)
      picker.draw()
      expect(picker.points).toEqual([[12, 24]])
      const drop = picker.drag("drop", undefined, 18, 28)
      expect(drop.defaultPrevented).toBe(true)
      expect(picker.points.at(-1)).toEqual([18, 28])
      expect(picker.sent).toHaveLength(1)
      expect(picker.sent[0]).toMatchObject({ type: "browser.elementPicked", sessionId: "pick-1", reference: { kind: "element", element: { locator: "#save", text: "保存" } } })
      picker.drag("drop")
      expect(picker.sent).toHaveLength(1)
      expect(picker.removed()).toBe(1)
    } finally { picker.dispose() }
  })
  test("Escape、切页与后台取消不生成 chip，专用 drop 仍抑制网页默认行为", () => {
    for (const reason of ["escape", "hidden", "stop", "pagehide"] as const) {
      const picker = setup()
      try {
        picker.message({ type: "browser.pickerStart", sessionId: "pick-1" })
        picker.drag("dragover"); picker.draw()
        if (reason === "escape") picker.view.dispatchEvent(Object.assign(new Event("keydown"), { key: "Escape" }))
        if (reason === "hidden") { Object.assign(picker.page, { hidden: true }); picker.page.dispatchEvent(new Event("visibilitychange")); Object.assign(picker.page, { hidden: false }) }
        if (reason === "stop") picker.message({ type: "browser.pickerStop", sessionId: "pick-1" })
        if (reason === "pagehide") picker.view.dispatchEvent(new Event("pagehide"))
        expect(picker.drag("drop").defaultPrevented).toBe(true)
        expect(picker.sent.some((message) => message.type === "browser.elementPicked")).toBe(false)
        expect(picker.removed()).toBe(1)
      } finally { picker.dispose() }
    }
  })
  test("iframe 外框不冒充内部元素", () => {
    const picker = setup()
    try {
      picker.element.tagName = "IFRAME"
      picker.message({ type: "browser.pickerStart", sessionId: "pick-1" })
      picker.drag("drop")
      expect(picker.sent).toEqual([])
    } finally { picker.dispose() }
  })
  test("扩展上下文失效后移除监听，普通网页拖动恢复原生行为", () => {
    const picker = setup()
    try {
      picker.message({ type: "browser.pickerStart", sessionId: "pick-1" })
      picker.drag("dragover")
      Object.defineProperty(picker.runtime, "id", { get() { throw new Error("Extension context invalidated") } })
      expect(extensionContextAvailable()).toBe(false)
      expect(picker.drag("dragover").defaultPrevented).toBe(false)
      expect(picker.frames.size).toBe(0)
      expect(picker.listeners.size).toBe(0)
    } finally { picker.dispose() }
  })
})
