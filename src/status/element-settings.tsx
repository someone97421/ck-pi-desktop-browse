import { createSignal, createUniqueId, onCleanup } from "solid-js"
import { ELEMENT_PICKER_ENABLED_KEY, elementPickerEnabled } from "../shared/element-settings"
import "./element-settings.css"

export function ElementSettings() {
  const id = createUniqueId()
  const [enabled, setEnabled] = createSignal(true)
  const [loaded, setLoaded] = createSignal(false)
  const [saving, setSaving] = createSignal(false)
  const [feedback, setFeedback] = createSignal("")
  const [error, setError] = createSignal(false)
  const changedKeys = new Set<string>()
  let disposed = false
  let feedbackTimer: ReturnType<typeof setTimeout> | undefined

  const flash = (message: string, failed = false) => {
    clearTimeout(feedbackTimer)
    setError(failed)
    setFeedback(message)
    feedbackTimer = setTimeout(() => {
      setFeedback("")
      setError(false)
    }, 2400)
  }

  const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== "local") return
    if (ELEMENT_PICKER_ENABLED_KEY in changes) {
      changedKeys.add(ELEMENT_PICKER_ENABLED_KEY)
      setEnabled(elementPickerEnabled(changes[ELEMENT_PICKER_ENABLED_KEY]?.newValue))
    }
  }
  chrome.storage.onChanged.addListener(changed)
  void chrome.storage.local.get(ELEMENT_PICKER_ENABLED_KEY).then((stored) => {
    if (disposed) return
    if (!changedKeys.has(ELEMENT_PICKER_ENABLED_KEY)) setEnabled(elementPickerEnabled(stored[ELEMENT_PICKER_ENABLED_KEY]))
    setLoaded(true)
  }).catch(() => {
    if (!disposed) {
      setError(true)
      setFeedback("设置读取失败，请重新打开设置页")
    }
  })

  const save = async (value: boolean) => {
    if (!loaded() || saving()) return
    const previousEnabled = enabled()
    setEnabled(value)
    setSaving(true)
    try {
      await chrome.storage.local.set({ [ELEMENT_PICKER_ENABLED_KEY]: value })
      if (!disposed) flash("拾取设置已保存")
    } catch {
      if (!disposed) {
        setEnabled(previousEnabled)
        flash("保存失败，请重试", true)
      }
    } finally {
      if (!disposed) setSaving(false)
    }
  }


  onCleanup(() => {
    disposed = true
    clearTimeout(feedbackTimer)
    chrome.storage.onChanged.removeListener(changed)
  })

  return (
    <section class="element-settings" aria-labelledby={`${id}-title`} aria-busy={saving()}>
      <div class="element-settings-heading">
        <h2 id={`${id}-title`} class="element-settings-title">网页元素拾取</h2>
        <label class="element-settings-toggle" title="仅在有可接收引用的智能体侧栏时响应">
          <span class="element-settings-toggle-label">启用拾取</span>
          <input
            class="element-settings-switch-input"
            type="checkbox"
            role="switch"
            checked={enabled()}
            disabled={!loaded() || saving()}
            onChange={(event) => void save(event.currentTarget.checked)}
          />
          <span class="element-settings-switch-track" aria-hidden="true" />
        </label>
      </div>
      <p class="element-settings-hint" role="status" aria-live="polite" data-error={error()}>
        {feedback() || (loaded() ? (enabled() ? "按住 Chrome 侧栏抓手拖到网页，松手添加元素引用" : "拾取已关闭") : "正在读取设置…")}
      </p>
    </section>
  )
}
