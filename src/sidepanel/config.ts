export const DEFAULT_SERVER_ORIGIN = "http://127.0.0.1:7878"
export const SERVER_ORIGIN_KEY = "chromeSidebarServerOrigin"
let serverOrigin = DEFAULT_SERVER_ORIGIN

export function normalizeServerOrigin(input: string): string {
  const url = new URL(input.trim())
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw new Error("请填写 http://主机:端口 或 https://主机:端口")
  return url.origin
}
export function isLoopbackOrigin(origin: string): boolean {
  const host = new URL(normalizeServerOrigin(origin)).hostname
  return host === "localhost" || host === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(host)
}
export function apiOrigin(): string { return serverOrigin }
export function frameUrl(server: string, parentOrigin: string): string {
  if (!/^chrome-extension:\/\/[a-p]{32}$/.test(parentOrigin)) throw new Error("无效的扩展来源")
  const url = new URL("/", normalizeServerOrigin(server))
  url.searchParams.set("webRemote", "true")
  url.searchParams.set("parentOrigin", parentOrigin)
  return url.href
}
export async function loadServerOrigin(): Promise<string> {
  const stored = await chrome.storage.local.get(SERVER_ORIGIN_KEY)
  const value = stored[SERVER_ORIGIN_KEY]
  try { serverOrigin = normalizeServerOrigin(typeof value === "string" ? value : DEFAULT_SERVER_ORIGIN) }
  catch { serverOrigin = DEFAULT_SERVER_ORIGIN }
  return serverOrigin
}
export async function saveServerOrigin(input: string): Promise<void> {
  const origin = normalizeServerOrigin(input)
  await chrome.storage.local.set({ [SERVER_ORIGIN_KEY]: origin })
}
