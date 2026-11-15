import type { ActiveTabInfo, AgentRelayStatus } from "../shared/protocol"

export function browserContext(tab: Pick<ActiveTabInfo, "tabId" | "title" | "url">): string {
  return `[浏览器调试上下文: tab=${tab.tabId}, title=${JSON.stringify(tab.title)}, url=${JSON.stringify(tab.url)} — 已挂载至 browse 工具，可直接对该 tab 调用 snapshot/console/network/screenshot/eval/click 等工具]`
}
export function needsPairing(status: AgentRelayStatus | undefined): boolean {
  return status === "unpaired" || status === "untrusted"
}
export function pairingAddress(endpoint: string, port: number): string {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Relay 返回了无效端口")
  return `${new URL(endpoint).hostname}:${port}`
}

export type RemoteStatus = { authenticated: boolean; online: boolean; canCompose: boolean }
export function validFrameMessage(event: Pick<MessageEvent, "source" | "origin" | "data">, source: Window | null, origin: string): boolean {
  return source !== null && event.source === source && event.origin === origin && event.data !== null && typeof event.data === "object"
}
