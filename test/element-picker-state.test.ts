import { afterEach, describe, expect, test } from "bun:test"
import { extensionContextAvailable, installElementPicker, pickerErrorMessage } from "../src/content/element-picker"

const keys = ["chrome", "window", "document", "requestAnimationFrame", "cancelAnimationFrame"] as const
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

describe("拾取器失效清理与真实反馈", () => {
  test("保留后台错误内容，短 hint 压缩空白并截断", () => {
    expect(pickerErrorMessage({ ok: false, error: "没有可用 Agent\n请在主程序选择会话" })).toBe("没有可用 Agent 请在主程序选择会话")
    expect(pickerErrorMessage({ error: "错".repeat(200) })).toHaveLength(160)
    expect(pickerErrorMessage({ error: "错".repeat(200) }).endsWith("…")).toBe(true)
    expect(pickerErrorMessage(undefined)).toContain("未添加")
  })
  test("runtime.id 缺失或读取抛错时判定上下文失效", () => {
    replace("chrome", { runtime: {} })
    expect(extensionContextAvailable()).toBe(false)
    replace("chrome", { get runtime() { throw new Error("Extension context invalidated") } })
    expect(extensionContextAvailable()).toBe(false)
    replace("chrome", { runtime: { id: "extension" } })
    expect(extensionContextAvailable()).toBe(true)
  })
  test("已激活拾取后扩展失效，点击仍交还网页且移除监听", async () => {
    const page = new EventTarget(), view = new EventTarget()
    let cancelled = 0
    const runtime = {
      id: "extension",
      onMessage: { addListener: () => {}, removeListener: () => {} },
      sendMessage: async () => ({ available: true }),
    }
    replace("window", view)
    replace("document", Object.assign(page, { hidden: false }))
    replace("chrome", {
      runtime,
      storage: {
        local: { get: async () => ({}) },
        onChanged: { addListener: () => {}, removeListener: () => {} },
      },
    })
    replace("requestAnimationFrame", () => 1)
    replace("cancelAnimationFrame", () => { cancelled++ })
    const dispose = installElementPicker()
    try {
      await Promise.resolve(); await Promise.resolve()
      const chord = Object.assign(new Event("keydown"), { key: "Shift", altKey: true, shiftKey: true, ctrlKey: false })
      view.dispatchEvent(chord)
      Object.defineProperty(runtime, "id", { get() { throw new Error("Extension context invalidated") } })
      const click = Object.assign(new Event("click", { cancelable: true }), { altKey: true, shiftKey: true, ctrlKey: false, button: 0 })
      expect(view.dispatchEvent(click)).toBe(true)
      expect(click.defaultPrevented).toBe(false)
      expect(cancelled).toBe(1)
      view.dispatchEvent(chord)
      expect(cancelled).toBe(1)
    } finally { dispose() }
  })
})
