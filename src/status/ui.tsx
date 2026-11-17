// What the onboarding and settings pages share: the color scheme, the port to the worker, stored settings as signals,
// and a few small pieces of UI built on @opencode/ui.
import { createSignal, For, onCleanup, Show, type JSX } from "solid-js"
import {
  STATUS_PORT,
  type AgentRelayState,
  type FromStatusPage,
  type ToStatusPage,
} from "../shared/protocol"
import { richParts } from "./describe"
import "./pages.css"

/** 跟随系统深浅色。 */
export function applyColorScheme() {
  const dark = matchMedia("(prefers-color-scheme: dark)")
  const apply = () => (document.documentElement.dataset.colorScheme = dark.matches ? "dark" : "light")
  apply()
  dark.addEventListener("change", apply)
}

/** 设置页和引导页订阅后台状态，并在后台重启后重新连接。 */
export function createRelay() {
  const [state, setState] = createSignal<AgentRelayState>()
  let port: chrome.runtime.Port | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  const connect = () => {
    if (stopped) return
    const next = chrome.runtime.connect({ name: STATUS_PORT })
    port = next
    next.onMessage.addListener((message: ToStatusPage) => {
      if (port === next && message.type === "agents") setState(message.state)
    })
    next.onDisconnect.addListener(() => {
      void chrome.runtime.lastError
      if (port !== next || stopped) return
      port = undefined
      setState(undefined)
      timer = setTimeout(connect, 300)
    })
  }
  connect()
  onCleanup(() => { stopped = true; clearTimeout(timer); port?.disconnect(); port = undefined })
  return { state, send: (message: FromStatusPage) => port?.postMessage(message) }
}

/** A chrome.storage.local key as a signal: `read` turns what's stored (or nothing) into the value. */
export function createStored<T>(key: string, read: (stored: unknown) => T) {
  const [value, setValue] = createSignal<T>(read(undefined))
  void chrome.storage.local.get(key).then((stored) => setValue(() => read(stored[key])))
  const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === "local" && key in changes) setValue(() => read(changes[key]?.newValue))
  }
  chrome.storage.onChanged.addListener(changed)
  onCleanup(() => chrome.storage.onChanged.removeListener(changed))
  const save = (next: unknown) => void chrome.storage.local.set({ [key]: next })
  return [value, save] as const
}

/** Text with `code` spans. */
export function Rich(props: { text: string }) {
  return (
    <For each={richParts(props.text)}>{(part) => (part.code ? <code>{part.text}</code> : part.text)}</For>
  )
}


/** 共用产品标识与页面导航。 */
export function Brand(props: { page?: string; end?: JSX.Element }) {
  return (
    <header class="brand">
      <img src="/icons/icon-48.png" width="32" height="32" alt="" />
      <span class="brand-name">这是一个助手<span class="brand-product"> · 浏览器</span></span>
      <Show when={props.page}>
        <span class="brand-page">{props.page}</span>
      </Show>
      <span class="brand-end">{props.end}</span>
    </header>
  )
}

/** A line in a tone: neutral, good or a warning. */
export function Note(props: { tone?: "ok" | "warn" | "neutral"; children: JSX.Element }) {
  return (
    <p class="note hint" role="status" data-tone={props.tone ?? "neutral"}>
      {props.children}
    </p>
  )
}
