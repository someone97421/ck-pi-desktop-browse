import { getElementInfo, normalizeText } from "./element-extractor"
import { ELEMENT_DRAG_PREFIX, isElementDrag } from "../shared/element-settings"

export function extensionContextAvailable(): boolean {
  try { return typeof chrome !== "undefined" && !!chrome.runtime?.id }
  catch { return false }
}

export function pickerErrorMessage(response: unknown): string {
  const error = response && typeof response === "object" && "error" in response ? response.error : undefined
  return typeof error === "string" && error.trim()
    ? normalizeText(error, 160) : "元素引用未添加，请检查侧栏连接后重试"
}

/** 每个 frame 使用自己的视口坐标；后台对整个拖动只接受一次捕捉。 */
export function installElementPicker(): () => void {
  let sessionId: string | undefined
  let disposed = false
  let host: HTMLDivElement | undefined
  let outline: HTMLDivElement | undefined
  let point: { x: number; y: number } | undefined
  let animation: number | undefined

  function ready() {
    if (disposed) return false
    if (!extensionContextAvailable()) { dispose(); return false }
    return !document.hidden
  }
  function clearOutline() {
    if (animation !== undefined) cancelAnimationFrame(animation)
    animation = undefined
    point = undefined
    host?.remove()
    host = undefined
    outline = undefined
  }
  function deactivate() { sessionId = undefined; clearOutline() }
  function elementAt(x: number, y: number): Element | undefined {
    let element = document.elementFromPoint(x, y)
    while (element?.shadowRoot?.mode === "open") {
      const nested = element.shadowRoot.elementFromPoint(x, y)
      if (!nested || nested === element) break
      element = nested
    }
    // 子 frame 会收到自己的 dragover/drop，不把其父 iframe 外框作为目标。
    return element && element !== host && !["IFRAME", "FRAME"].includes(element.tagName) ? element : undefined
  }
  function draw() {
    animation = undefined
    if (!ready() || !sessionId || !point) return
    const element = elementAt(point.x, point.y)
    if (!element) { if (outline) outline.hidden = true; return }
    if (!host) {
      host = document.createElement("div")
      for (const [name, value] of Object.entries({
        all: "initial", position: "fixed", inset: "0", display: "block",
        "pointer-events": "none", "z-index": "2147483647",
      })) host.style.setProperty(name, value, "important")
      const root = host.attachShadow({ mode: "closed" })
      outline = document.createElement("div")
      outline.style.cssText = "position:fixed;box-sizing:border-box;pointer-events:none;border:2px solid #0d9488;border-radius:5px;background:rgb(20 184 166 / 12%);box-shadow:0 0 0 1px rgb(255 255 255 / 65%)"
      root.append(outline)
      document.documentElement.append(host)
    }
    const rect = element.getBoundingClientRect()
    Object.assign(outline!.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` })
    outline!.hidden = false
  }
  function scheduleDraw() {
    if (point && sessionId && animation === undefined) animation = requestAnimationFrame(draw)
  }
  function ownedDrag(event: DragEvent) {
    return ready() && isElementDrag(Array.from(event.dataTransfer?.types ?? []), sessionId)
  }
  function onDragOver(event: DragEvent) {
    if (!ownedDrag(event)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"
    point = { x: event.clientX, y: event.clientY }
    scheduleDraw()
  }
  function onDragLeave(event: DragEvent) {
    if (!ownedDrag(event)) return
    clearOutline()
  }
  function onDrop(event: DragEvent) {
    if (!ready()) return
    const types = Array.from(event.dataTransfer?.types ?? [])
    // 专用标记即使刚被取消，也不能触发网页默认投放行为。
    if (!types.some((type) => type.startsWith(ELEMENT_DRAG_PREFIX))) return
    event.preventDefault()
    event.stopImmediatePropagation()
    const id = sessionId
    const element = isElementDrag(types, id) ? elementAt(event.clientX, event.clientY) : undefined
    deactivate()
    if (!id || !element) return
    try {
      const info = getElementInfo(element)
      void chrome.runtime.sendMessage({
        type: "browser.elementPicked", sessionId: id,
        reference: { kind: "element", title: info.pageTitle, url: info.pageUrl, frameUrl: location.href, element: info },
      }).catch(() => undefined)
    } catch {
      void chrome.runtime.sendMessage({ type: "browser.pickerCancel", sessionId: id }).catch(() => undefined)
    }
  }
  function cancel() {
    const id = sessionId
    deactivate()
    if (id && extensionContextAvailable()) {
      void chrome.runtime.sendMessage({ type: "browser.pickerCancel", sessionId: id }).catch(() => undefined)
    }
  }
  function onKeyDown(event: KeyboardEvent) { if (event.key === "Escape") cancel() }
  function onVisibilityChange() { if (document.hidden) cancel() }
  function onMessage(message: unknown) {
    if (!ready() || !message || typeof message !== "object" || !("type" in message)) return
    if (message.type === "browser.pickerStart" && "sessionId" in message && typeof message.sessionId === "string") {
      deactivate(); sessionId = message.sessionId
    } else if (message.type === "browser.pickerStop" && "sessionId" in message && message.sessionId === sessionId) {
      deactivate()
    } else if (message.type === "agent.pickerAvailability" && "available" in message && message.available === false) {
      deactivate()
    }
  }
  chrome.runtime.onMessage.addListener(onMessage)
  window.addEventListener("dragover", onDragOver, true)
  window.addEventListener("dragleave", onDragLeave, true)
  window.addEventListener("drop", onDrop, true)
  window.addEventListener("keydown", onKeyDown, true)
  window.addEventListener("blur", clearOutline)
  window.addEventListener("resize", scheduleDraw)
  window.addEventListener("pagehide", cancel)
  document.addEventListener("scroll", scheduleDraw, true)
  document.addEventListener("visibilitychange", onVisibilityChange)
  function dispose() {
    if (disposed) return
    disposed = true
    deactivate()
    try { chrome.runtime.onMessage.removeListener(onMessage) } catch {}
    window.removeEventListener("dragover", onDragOver, true)
    window.removeEventListener("dragleave", onDragLeave, true)
    window.removeEventListener("drop", onDrop, true)
    window.removeEventListener("keydown", onKeyDown, true)
    window.removeEventListener("blur", clearOutline)
    window.removeEventListener("resize", scheduleDraw)
    window.removeEventListener("pagehide", cancel)
    document.removeEventListener("scroll", scheduleDraw, true)
    document.removeEventListener("visibilitychange", onVisibilityChange)
    const current = globalThis as PickerGlobal
    if (current.__browseElementPickerDispose === dispose) delete current.__browseElementPickerDispose
  }
  return dispose
}

type PickerGlobal = typeof globalThis & { __browseElementPickerDispose?: () => void }
const pickerGlobal = globalThis as PickerGlobal
if (typeof document !== "undefined" && extensionContextAvailable() && !pickerGlobal.__browseElementPickerDispose) {
  pickerGlobal.__browseElementPickerDispose = installElementPicker()
}
