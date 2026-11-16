import type { BrowserElementInfo } from "../shared/browser-reference"

export function normalizeText(value: unknown, maxLength = 180): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim()
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1))}…` : text
}

function escapeCss(value: string): string {
  if (typeof globalThis.CSS?.escape === "function") return CSS.escape(value)
  return [...value].map((char, index) => {
    const code = char.codePointAt(0)!
    if (code === 0) return "\uFFFD"
    if (code < 32 || code === 127 || (/\d/.test(char) && (index === 0 || (index === 1 && value[0] === "-")))) {
      return `\\${code.toString(16)} `
    }
    if (index === 0 && char === "-" && value.length === 1) return "\\-"
    return code >= 128 || /[\w-]/.test(char) ? char : `\\${char}`
  }).join("")
}

function escapeAttribute(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\n\r\f]/g, (char) => `\\${char.charCodeAt(0).toString(16)} `)
}

function getRole(element: Element): string {
  const explicit = element.getAttribute("role")
  if (explicit) return explicit
  const tag = element.localName
  const type = (element.getAttribute("type") ?? "").toLowerCase()
  if (tag === "input") {
    if (["button", "submit", "reset", "image"].includes(type)) return "button"
    if (type === "checkbox") return "checkbox"
    if (type === "radio") return "radio"
    if (type === "range") return "slider"
    return "textbox"
  }
  const roles: Record<string, string> = {
    a: element.hasAttribute("href") ? "link" : "generic",
    button: "button", select: "combobox", textarea: "textbox", img: "img",
    nav: "navigation", main: "main", header: "banner", footer: "contentinfo", form: "form", table: "table",
  }
  return roles[tag] ?? "generic"
}

function labelsOf(element: Element): readonly HTMLLabelElement[] {
  if (!("labels" in element)) return []
  const labels = (element as HTMLInputElement).labels
  return labels ? Array.from(labels) : []
}

function visibleText(element: Element): string {
  return (element as HTMLElement).innerText || element.textContent || ""
}

function getAccessibleName(element: Element): string {
  const ariaLabel = normalizeText(element.getAttribute("aria-label"))
  if (ariaLabel) return ariaLabel
  const labelledBy = element.getAttribute("aria-labelledby")
  if (labelledBy) {
    const root = element.getRootNode() as Document | ShadowRoot
    const label = labelledBy.split(/\s+/).map((id) => root.getElementById?.(id)?.textContent ?? "").join(" ")
    if (normalizeText(label)) return normalizeText(label)
  }
  const labels = normalizeText(labelsOf(element).map((label) => label.textContent).join(" "))
  if (labels) return labels
  for (const attribute of ["alt", "title", "placeholder"]) {
    const value = normalizeText(element.getAttribute(attribute))
    if (value) return value
  }
  if (element.localName === "input") {
    const type = (element.getAttribute("type") || "text").toLowerCase()
    return ["button", "submit", "reset"].includes(type) ? normalizeText(element.getAttribute("value")) : ""
  }
  if (element.localName === "textarea") return ""
  return normalizeText(visibleText(element))
}

function isProbablyStableClass(className: string): boolean {
  return !!className && className.length <= 48 && !/\d{4,}/.test(className)
    && !/^(css|jsx|sc|emotion)-[a-z0-9]{5,}$/i.test(className)
}

function queryIsUnique(root: ParentNode, selector: string, element: Element): boolean {
  try {
    const matches = root.querySelectorAll(selector)
    return matches.length === 1 && matches[0] === element
  } catch {
    return false
  }
}

function getStableAttributeSelector(element: Element): string {
  for (const attribute of ["data-testid", "data-test-id", "data-test", "data-cy", "data-qa", "aria-label", "name"]) {
    const value = element.getAttribute(attribute)
    if (!value || value.length > 100) continue
    const selector = `${element.localName}[${attribute}="${escapeAttribute(value)}"]`
    if (queryIsUnique(element.getRootNode() as ParentNode, selector, element)) return selector
  }
  return ""
}

function buildSelectorSegment(element: Element, root: ParentNode): string {
  if (element.id) {
    const selector = `#${escapeCss(element.id)}`
    if (queryIsUnique(root, selector, element)) return selector
  }
  const attribute = getStableAttributeSelector(element)
  if (attribute) return attribute
  const classes = [...element.classList].filter(isProbablyStableClass).slice(0, 2)
  let segment = `${element.localName}${classes.map((name) => `.${escapeCss(name)}`).join("")}`
  const parent = element.parentElement
  if (parent) {
    const siblings = [...parent.children].filter((child) => child.tagName === element.tagName)
    if (siblings.length > 1) segment += `:nth-of-type(${siblings.indexOf(element) + 1})`
  }
  return segment
}

function buildSelectorWithinRoot(element: Element, root: ParentNode): string {
  const id = element.id ? `#${escapeCss(element.id)}` : ""
  if (id && queryIsUnique(root, id, element)) return id
  const attribute = getStableAttributeSelector(element)
  if (attribute) return attribute
  const segments: string[] = []
  let current: Element | null = element
  while (current) {
    segments.unshift(buildSelectorSegment(current, root))
    const selector = segments.join(" > ")
    if (queryIsUnique(root, selector, element)) return selector
    const parent: Element | null = current.parentElement
    if (!parent || parent === element.ownerDocument.documentElement) break
    current = parent
  }
  return segments.join(" > ")
}

export function getElementLocator(element: Element): string {
  const parts: string[] = []
  let current = element
  while (current) {
    const root = current.getRootNode() as Document | ShadowRoot
    parts.unshift(buildSelectorWithinRoot(current, root))
    if (!("host" in root) || root.mode !== "open") break
    current = root.host
  }
  return parts.join(" >>> ")
}

function getElementText(element: Element): string {
  if (["input", "textarea"].includes(element.localName)) {
    return normalizeText(element.getAttribute("aria-label") || element.getAttribute("placeholder") || labelsOf(element)[0]?.textContent || "")
  }
  return normalizeText(visibleText(element))
}

function getUsefulAttributes(element: Element): string[] {
  const attributes: string[] = []
  for (const name of [
    "id", "role", "type", "name", "href", "aria-label", "aria-expanded", "aria-selected", "aria-checked",
    "data-testid", "data-test-id", "data-test", "data-cy", "data-qa",
  ]) {
    if (!element.hasAttribute(name)) continue
    let value = normalizeText(element.getAttribute(name), 100)
    if (name === "href") {
      try {
        const url = new URL(value, element.ownerDocument.location.href)
        value = `${url.origin}${url.pathname}${url.search}`
      } catch {
        // 无法解析的相对链接仍保留原文。
      }
    }
    attributes.push(`${name}="${value}"`)
  }
  const classes = [...element.classList].filter(isProbablyStableClass).slice(0, 3)
  if (classes.length) attributes.push(`class="${classes.join(" ")}"`)
  return attributes
}

function getContextPath(element: Element): string {
  const context: string[] = []
  let current = element.parentElement
  while (current && current !== element.ownerDocument.documentElement && context.length < 4) {
    const tag = current.localName
    if (["main", "nav", "header", "footer", "aside", "form", "section", "article"].includes(tag)
      || current.id || current.hasAttribute("data-testid") || current.hasAttribute("aria-label")) {
      let segment = tag
      if (current.id) segment += `#${current.id}`
      else if (current.hasAttribute("data-testid")) segment += `[data-testid="${normalizeText(current.getAttribute("data-testid"), 60)}"]`
      else if (current.hasAttribute("aria-label")) segment += `[aria-label="${normalizeText(current.getAttribute("aria-label"), 60)}"]`
      context.unshift(segment)
    }
    current = current.parentElement
  }
  return context.join(" > ") || "document"
}

function getHtmlSignature(element: Element): string {
  const tag = element.localName
  const attributes = getUsefulAttributes(element).join(" ")
  const opening = `<${tag}${attributes ? ` ${attributes}` : ""}>`
  if (["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source"].includes(tag)) return opening
  const text = getElementText(element)
  return `${opening}${text ? normalizeText(text, 100) : ""}</${tag}>`
}

export function getElementInfo(element: Element): BrowserElementInfo {
  const rect = element.getBoundingClientRect()
  const document = element.ownerDocument
  const url = new URL(document.location.href)
  url.hash = ""
  url.username = ""
  url.password = ""
  return {
    tag: element.localName,
    role: getRole(element),
    name: getAccessibleName(element),
    locator: getElementLocator(element),
    text: getElementText(element),
    attributes: getUsefulAttributes(element),
    context: getContextPath(element),
    html: getHtmlSignature(element),
    pageTitle: normalizeText(document.title, 120) || "(无标题页面)",
    pageUrl: normalizeText(url.href, 260),
    size: `${Math.round(rect.width)} × ${Math.round(rect.height)}`,
  }
}

export function formatAiElementCard(info: BrowserElementInfo): string {
  const lines = [
    "[网页元素定位卡]",
    `页面: ${info.pageTitle}`,
    `URL: ${info.pageUrl}`,
    `目标: ${info.role}${info.name ? ` "${info.name}"` : ""}`,
    `定位: ${info.locator}`,
    `上下文: ${info.context}`,
  ]
  if (info.text && info.text !== info.name) lines.push(`文本: "${info.text}"`)
  if (info.attributes.length) lines.push(`属性: ${info.attributes.join(" ")}`)
  lines.push(`HTML: ${info.html}`)
  return lines.join("\n")
}
