export const ELEMENT_PICKER_ENABLED_KEY = "elementPickerEnabled"
export const ELEMENT_DRAG_PREFIX = "application/x-browse-element-"

export function elementPickerEnabled(value: unknown): boolean {
  return typeof value === "boolean" ? value : true
}

export function elementDragType(sessionId: string): string {
  return `${ELEMENT_DRAG_PREFIX}${sessionId.toLowerCase()}`
}

export function isElementDrag(types: readonly string[], sessionId?: string): boolean {
  return sessionId !== undefined && types.includes(elementDragType(sessionId))
}
