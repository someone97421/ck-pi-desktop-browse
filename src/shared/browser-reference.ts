export interface BrowserElementInfo {
  tag: string
  role: string
  name: string
  locator: string
  text: string
  attributes: string[]
  context: string
  html: string
  pageTitle: string
  pageUrl: string
  size: string
}

export interface BrowserReference {
  kind: "page" | "selection" | "element"
  tabId: number
  windowId?: number
  title: string
  url: string
  selection?: string
  frameId?: number
  frameUrl?: string
  element?: BrowserElementInfo
}
