import { getElementInfo, normalizeText } from "./element-extractor"
import {
  DEFAULT_ELEMENT_MODIFIERS,
  ELEMENT_MODIFIERS_KEY,
  ELEMENT_PICKER_ENABLED_KEY,
  elementModifiers,
  elementPickerEnabled,
  matchesElementModifiers,
  type ElementModifier,
} from "../shared/element-settings"

export function extensionContextAvailable(): boolean {
  try { return typeof chrome !== "undefined" && !!chrome.runtime?.id }
  catch { return false }
}

export function pickerErrorMessage(response: unknown): string {
  const error = response && typeof response === "object" && "error" in response ? response.error : undefined
  return typeof error === "string" && error.trim()
    ? normalizeText(error, 160) : "元素引用未添加，请检查侧栏连接后重试"
}

/** 每个 frame 独立安装；标签页与 frame 身份由 background 根据 sender 补全。 */
export function installElementPicker(): () => void {
  let modifiers: ElementModifier[] = [...DEFAULT_ELEMENT_MODIFIERS]
  let enabled = true
  let loaded = false
  let available = false
  let disposed = false
  let active = false
  let awaitingRelease = false
  let sending = false
  let availabilityRevision = 0
  let uiRevision = 0
  const changedKeys = new Set<string>()
  let point: { x: number; y: number } | undefined
  let highlighted: Element | undefined
  let host: HTMLDivElement | undefined
  let outline: HTMLDivElement | undefined
  let hint: HTMLDivElement | undefined
  let hintTimer: ReturnType<typeof setTimeout> | undefined
  let animation: number | undefined

  const ready = () => ensureContext() && loaded && enabled && available && !document.hidden

  function ensureContext(): boolean {
    if (disposed) return false
    if (extensionContextAvailable()) return true
    dispose()
    return false
  }

  function removeUi() {
    clearTimeout(hintTimer)
    hintTimer = undefined
    host?.remove()
    host = undefined
    outline = undefined
    hint = undefined
  }

  function deactivate() {
    uiRevision++
    active = false
    highlighted = undefined
    if (animation !== undefined) cancelAnimationFrame(animation)
    animation = undefined
    removeUi()
  }

  function createUi() {
    if (host?.isConnected) return
    removeUi()
    host = document.createElement("div")
    for (const [name, value] of Object.entries({
      all: "initial", position: "fixed", top: "0", left: "0", width: "100%", height: "100%",
      display: "block", margin: "0", padding: "0", border: "0", "pointer-events": "none", "z-index": "2147483647",
    })) host.style.setProperty(name, value, "important")
    const root = host.attachShadow({ mode: "closed" })
    const style = document.createElement("style")
    style.textContent = `
      :host { color-scheme: light dark; }
      * { box-sizing: border-box; pointer-events: none !important; }
      .outline { position: fixed; border: 2px solid #0d9488; border-radius: 5px;
        background: rgb(20 184 166 / 12%); box-shadow: 0 0 0 1px rgb(255 255 255 / 65%); }
      .hint { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
        max-width: min(420px, calc(100vw - 32px)); padding: 9px 14px; border: 1px solid #cbd5e1;
        border-radius: 10px; background: #fafaf7; color: #243337;
        font: 13px/1.5 system-ui, sans-serif; box-shadow: 0 6px 24px rgb(15 23 42 / 16%); }
      @media (prefers-color-scheme: dark) {
        .hint { background: #202a2d; color: #e5eeec; border-color: #47575b; }
      }
    `
    outline = document.createElement("div")
    outline.className = "outline"
    outline.hidden = true
    hint = document.createElement("div")
    hint.className = "hint"
    hint.setAttribute("role", "status")
    hint.hidden = true
    root.append(style, outline, hint)
    document.documentElement.append(host)
  }

  function showHint(message: string) {
    if (!ready()) return
    createUi()
    hint!.textContent = normalizeText(message, 160)
    hint!.hidden = false
    clearTimeout(hintTimer)
    hintTimer = setTimeout(() => {
      if (active) hint!.hidden = true
      else removeUi()
    }, 1800)
  }

  function elementAt(x: number, y: number): Element | undefined {
    let element = document.elementFromPoint(x, y)
    while (element?.shadowRoot?.mode === "open") {
      const nested = element.shadowRoot.elementFromPoint(x, y)
      if (!nested || nested === element) break
      element = nested
    }
    return element && element !== host ? element : undefined
  }

  function draw() {
    animation = undefined
    if (!active || !ready() || !point) return
    highlighted = elementAt(point.x, point.y)
    if (!highlighted) {
      if (outline) outline.hidden = true
      return
    }
    createUi()
    const rect = highlighted.getBoundingClientRect()
    outline!.style.left = `${rect.left}px`
    outline!.style.top = `${rect.top}px`
    outline!.style.width = `${rect.width}px`
    outline!.style.height = `${rect.height}px`
    outline!.hidden = false
  }

  function scheduleDraw() {
    if (active && animation === undefined) animation = requestAnimationFrame(draw)
  }

  function updateChord(event: Pick<KeyboardEvent, "ctrlKey" | "altKey" | "shiftKey">) {
    if (!ensureContext()) return
    if (!matchesElementModifiers(event, modifiers)) {
      awaitingRelease = false
      if (active) deactivate()
      return
    }
    if (!ready() || awaitingRelease || sending) return
    if (!active) {
      deactivate()
      active = true
    }
    scheduleDraw()
  }

  function onKeyDown(event: KeyboardEvent) {
    if (!ensureContext()) return
    if (event.key === "Escape") {
      awaitingRelease = true
      deactivate()
      return
    }
    updateChord(event)
  }

  function onKeyUp(event: KeyboardEvent) {
    updateChord(event)
  }

  function onPointerMove(event: PointerEvent) {
    point = { x: event.clientX, y: event.clientY }
    updateChord(event)
    scheduleDraw()
  }

  function onPointerDown(event: PointerEvent) {
    if (!ensureContext()) return
    point = { x: event.clientX, y: event.clientY }
    updateChord(event)
    if (!active || !ready() || event.button !== 0) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  function onClick(event: MouseEvent) {
    if (!ensureContext()) return
    if (!active || !ready() || event.button !== 0) return
    if (!matchesElementModifiers(event, modifiers)) {
      updateChord(event)
      return
    }
    event.preventDefault()
    event.stopImmediatePropagation()
    awaitingRelease = true
    const element = elementAt(event.clientX, event.clientY)
    deactivate()
    if (!element) return
    sending = true
    void sendElement(element).finally(() => { sending = false })
  }

  async function sendElement(element: Element) {
    const revision = uiRevision
    try {
      const info = getElementInfo(element)
      const response: unknown = await chrome.runtime.sendMessage({
        type: "agent.reference",
        reference: {
          kind: "element", title: info.pageTitle, url: info.pageUrl,
          frameUrl: location.href, element: info,
        },
      })
      if (revision !== uiRevision) return
      if (response && typeof response === "object" && "ok" in response && response.ok === true) {
        showHint("元素引用已添加到侧栏")
      } else {
        showHint(pickerErrorMessage(response))
      }
    } catch {
      if (ensureContext() && revision === uiRevision) showHint("元素引用发送失败，请检查侧栏连接后重试")
    }
  }

  function onBlur() {
    awaitingRelease = true
    point = undefined
    deactivate()
  }

  function onVisibilityChange() {
    if (document.hidden) onBlur()
  }

  function onAvailability(message: unknown) {
    if (!message || typeof message !== "object" || !("type" in message)
      || message.type !== "agent.pickerAvailability" || !("available" in message)
      || typeof message.available !== "boolean") return
    availabilityRevision++
    available = message.available
    if (!available) {
      awaitingRelease = true
      deactivate()
    }
  }

  function onStorage(changes: Record<string, chrome.storage.StorageChange>, area: string) {
    if (area !== "local") return
    if (ELEMENT_MODIFIERS_KEY in changes) {
      changedKeys.add(ELEMENT_MODIFIERS_KEY)
      modifiers = elementModifiers(changes[ELEMENT_MODIFIERS_KEY]?.newValue)
      awaitingRelease = true
      deactivate()
    }
    if (ELEMENT_PICKER_ENABLED_KEY in changes) {
      changedKeys.add(ELEMENT_PICKER_ENABLED_KEY)
      enabled = elementPickerEnabled(changes[ELEMENT_PICKER_ENABLED_KEY]?.newValue)
      if (!enabled) {
        awaitingRelease = true
        deactivate()
      }
    }
  }

  chrome.runtime.onMessage.addListener(onAvailability)
  chrome.storage.onChanged.addListener(onStorage)
  const revision = availabilityRevision
  void chrome.runtime.sendMessage({ type: "agent.pickerAvailability" }).then((response: unknown) => {
    if (disposed || revision !== availabilityRevision) return
    available = !!response && typeof response === "object" && "available" in response && response.available === true
  }).catch(() => undefined)
  void chrome.storage.local.get([ELEMENT_MODIFIERS_KEY, ELEMENT_PICKER_ENABLED_KEY]).then((stored) => {
    if (disposed) return
    if (!changedKeys.has(ELEMENT_MODIFIERS_KEY)) modifiers = elementModifiers(stored[ELEMENT_MODIFIERS_KEY])
    if (!changedKeys.has(ELEMENT_PICKER_ENABLED_KEY)) enabled = elementPickerEnabled(stored[ELEMENT_PICKER_ENABLED_KEY])
    loaded = true
  }).catch(() => undefined)

  window.addEventListener("keydown", onKeyDown, true)
  window.addEventListener("keyup", onKeyUp, true)
  window.addEventListener("pointermove", onPointerMove, true)
  window.addEventListener("pointerdown", onPointerDown, true)
  window.addEventListener("click", onClick, true)
  window.addEventListener("blur", onBlur)
  window.addEventListener("resize", scheduleDraw)
  document.addEventListener("scroll", scheduleDraw, true)
  document.addEventListener("visibilitychange", onVisibilityChange)
  window.addEventListener("pagehide", onBlur)

  function dispose() {
    if (disposed) return
    disposed = true
    deactivate()
    try { chrome.runtime.onMessage.removeListener(onAvailability) } catch {}
    try { chrome.storage.onChanged.removeListener(onStorage) } catch {}
    window.removeEventListener("keydown", onKeyDown, true)
    window.removeEventListener("keyup", onKeyUp, true)
    window.removeEventListener("pointermove", onPointerMove, true)
    window.removeEventListener("pointerdown", onPointerDown, true)
    window.removeEventListener("click", onClick, true)
    window.removeEventListener("blur", onBlur)
    window.removeEventListener("resize", scheduleDraw)
    document.removeEventListener("scroll", scheduleDraw, true)
    document.removeEventListener("visibilitychange", onVisibilityChange)
    window.removeEventListener("pagehide", onBlur)
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
