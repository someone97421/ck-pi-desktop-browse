import { createSignal, createUniqueId, For, onCleanup } from "solid-js"
import {
  DEFAULT_ELEMENT_MODIFIERS,
  ELEMENT_MODIFIERS,
  ELEMENT_MODIFIERS_KEY,
  ELEMENT_MODIFIER_LABELS,
  ELEMENT_PICKER_ENABLED_KEY,
  elementModifiers,
  elementPickerEnabled,
  formatElementShortcut,
  type ElementModifier,
} from "../shared/element-settings"
import "./element-settings.css"

export function ElementSettings() {
  const id = createUniqueId()
  const [enabled, setEnabled] = createSignal(true)
  const [modifiers, setModifiers] = createSignal<ElementModifier[]>([...DEFAULT_ELEMENT_MODIFIERS])
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
    if (ELEMENT_MODIFIERS_KEY in changes) {
      changedKeys.add(ELEMENT_MODIFIERS_KEY)
      setModifiers(elementModifiers(changes[ELEMENT_MODIFIERS_KEY]?.newValue))
    }
  }
  chrome.storage.onChanged.addListener(changed)
  void chrome.storage.local.get([ELEMENT_PICKER_ENABLED_KEY, ELEMENT_MODIFIERS_KEY]).then((stored) => {
    if (disposed) return
    if (!changedKeys.has(ELEMENT_PICKER_ENABLED_KEY)) setEnabled(elementPickerEnabled(stored[ELEMENT_PICKER_ENABLED_KEY]))
    if (!changedKeys.has(ELEMENT_MODIFIERS_KEY)) setModifiers(elementModifiers(stored[ELEMENT_MODIFIERS_KEY]))
    setLoaded(true)
  }).catch(() => {
    if (!disposed) {
      setError(true)
      setFeedback("设置读取失败，请重新打开设置页")
    }
  })

  const save = async (key: string, value: boolean | ElementModifier[]) => {
    if (!loaded() || saving()) return
    const previousEnabled = enabled()
    const previousModifiers = modifiers()
    if (key === ELEMENT_PICKER_ENABLED_KEY) setEnabled(value as boolean)
    else setModifiers(value as ElementModifier[])
    setSaving(true)
    try {
      await chrome.storage.local.set({ [key]: value })
      if (!disposed) flash(key === ELEMENT_MODIFIERS_KEY ? "快捷键已更新" : "拾取设置已保存")
    } catch {
      if (!disposed) {
        if (key === ELEMENT_PICKER_ENABLED_KEY) setEnabled(previousEnabled)
        else setModifiers(previousModifiers)
        flash("保存失败，请重试", true)
      }
    } finally {
      if (!disposed) setSaving(false)
    }
  }

  const changeModifier = (modifier: ElementModifier, input: HTMLInputElement) => {
    const next = ELEMENT_MODIFIERS.filter((item) => item === modifier ? input.checked : modifiers().includes(item))
    if (!next.length) {
      input.checked = true
      flash("至少保留一个修饰键", true)
      return
    }
    void save(ELEMENT_MODIFIERS_KEY, next)
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
            onChange={(event) => void save(ELEMENT_PICKER_ENABLED_KEY, event.currentTarget.checked)}
          />
          <span class="element-settings-switch-track" aria-hidden="true" />
        </label>
      </div>
      <fieldset class="element-settings-shortcut" disabled={!loaded() || saving()}>
        <legend class="element-settings-label">拾取快捷键</legend>
        <div class="element-settings-keys">
          <For each={ELEMENT_MODIFIERS}>
            {(modifier) => (
              <label class="element-settings-key" data-checked={modifiers().includes(modifier)}>
                <input
                  class="element-settings-key-input"
                  type="checkbox"
                  checked={modifiers().includes(modifier)}
                  onChange={(event) => changeModifier(modifier, event.currentTarget)}
                />
                <kbd class="element-settings-keycap">{ELEMENT_MODIFIER_LABELS[modifier]}</kbd>
              </label>
            )}
          </For>
        </div>
      </fieldset>
      <div class="element-settings-current" title="按住所选修饰键后点击页面元素；Escape 退出拾取">
        <span class="element-settings-current-label">当前组合</span>
        <span class="element-settings-combination">{formatElementShortcut(modifiers())}</span>
      </div>
      <p class="element-settings-hint" role="status" aria-live="polite" data-error={error()}>
        {feedback() || (loaded() ? (enabled() ? "侧栏可接收时生效，修改自动保存" : "拾取已关闭，快捷键设置保留") : "正在读取设置…")}
      </p>
    </section>
  )
}
