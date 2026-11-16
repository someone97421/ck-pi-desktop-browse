export const ELEMENT_MODIFIERS_KEY = "showweb_modifiers"
export const ELEMENT_PICKER_ENABLED_KEY = "elementPickerEnabled"
export const ELEMENT_MODIFIERS = ["ctrl", "alt", "shift"] as const
export type ElementModifier = (typeof ELEMENT_MODIFIERS)[number]
export const DEFAULT_ELEMENT_MODIFIERS: readonly ElementModifier[] = ["alt", "shift"]

export const ELEMENT_MODIFIER_LABELS: Record<ElementModifier, string> = {
  ctrl: "Ctrl",
  alt: "Alt",
  shift: "Shift",
}

export function elementModifiers(value: unknown): ElementModifier[] {
  if (!Array.isArray(value)) return [...DEFAULT_ELEMENT_MODIFIERS]
  const modifiers = ELEMENT_MODIFIERS.filter((modifier) => value.includes(modifier))
  return modifiers.length ? modifiers : [...DEFAULT_ELEMENT_MODIFIERS]
}

export function elementPickerEnabled(value: unknown): boolean {
  return typeof value === "boolean" ? value : true
}

export function matchesElementModifiers(
  event: Pick<KeyboardEvent, "ctrlKey" | "altKey" | "shiftKey">,
  modifiers: readonly ElementModifier[],
): boolean {
  return modifiers.length > 0 && modifiers.every((modifier) => {
    if (modifier === "ctrl") return event.ctrlKey
    if (modifier === "alt") return event.altKey
    return event.shiftKey
  })
}

export function formatElementShortcut(modifiers: readonly ElementModifier[]): string {
  return `${modifiers.map((modifier) => ELEMENT_MODIFIER_LABELS[modifier]).join(" + ")} + 点击`
}
