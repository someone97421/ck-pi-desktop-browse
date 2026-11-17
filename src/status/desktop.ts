import { createEffect, createSignal, onCleanup } from "solid-js"
import { DEFAULT_SERVER_ORIGIN, SERVER_ORIGIN_KEY, isLoopbackOrigin, normalizeServerOrigin } from "../sidepanel/config"
import { createStored } from "./ui"

export type DesktopServiceStatus = "checking" | "available" | "unavailable"

export function createDesktopService() {
  const [origin] = createStored(SERVER_ORIGIN_KEY, (value) => {
    try { return normalizeServerOrigin(typeof value === "string" ? value : DEFAULT_SERVER_ORIGIN) }
    catch { return DEFAULT_SERVER_ORIGIN }
  })
  const [status, setStatus] = createSignal<DesktopServiceStatus>("checking")
  const [revision, setRevision] = createSignal(0)

  createEffect(() => {
    const address = origin()
    revision()
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let request: AbortController | undefined
    setStatus("checking")
    const check = async () => {
      const controller = new AbortController()
      request = controller
      const timeout = setTimeout(() => controller.abort(), 3000)
      try {
        const response = await fetch(new URL("/api/health", address), {
          cache: "no-store", credentials: "omit", redirect: "error", signal: controller.signal,
        })
        const body: unknown = await response.json()
        const health = body && typeof body === "object" && "ok" in body && body.ok === true && "result" in body ? body.result : undefined
        const valid = response.ok && health && typeof health === "object" && "protocolVersion" in health && health.protocolVersion === 2
          && "authMode" in health && health.authMode === "password"
        if (!stopped) setStatus(valid ? "available" : "unavailable")
      } catch {
        if (!stopped) setStatus("unavailable")
      } finally {
        clearTimeout(timeout)
        if (!stopped) timer = setTimeout(() => void check(), 5000)
      }
    }
    void check()
    onCleanup(() => { stopped = true; clearTimeout(timer); request?.abort() })
  })

  return { origin, status, local: () => isLoopbackOrigin(origin()), check: () => setRevision((value) => value + 1) }
}

export const desktopServiceText = (status: DesktopServiceStatus) => ({
  checking: "正在检测主程序服务…",
  available: "主程序服务可用",
  unavailable: "未连接到主程序服务",
})[status]

export async function openDesktopSidepanel() {
  const current = await chrome.windows.getCurrent()
  if (current.id === undefined) throw new Error("无法确定当前浏览器窗口，请点击扩展图标打开侧栏。")
  await chrome.sidePanel.open({ windowId: current.id })
}
