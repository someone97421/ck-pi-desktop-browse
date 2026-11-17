import type { AgentRelayState } from "../shared/protocol"

export function browserStatusText(state: AgentRelayState | undefined, local = true) {
  if (local && state?.relay.remote) return "等待切换至主程序调试服务"
  switch (state?.status) {
    case "connected": return "浏览器调试已连接"
    case "connecting": return "正在连接浏览器调试…"
    case "conflict": return "浏览器调试连接被占用"
    case "incompatible": return "浏览器调试版本不兼容"
    case "unpaired":
    case "untrusted": return local ? "等待主程序自动连接" : "浏览器调试尚未连接"
    default: return local ? "等待侧栏连接浏览器调试" : "浏览器调试尚未连接"
  }
}

export function describeStatus(state: AgentRelayState | undefined, local = true) {
  if (local && state?.relay.remote) return "打开侧栏后，将自动改用主程序提供的本机调试服务。"
  if (state?.status === "connected") {
    return state.tabs.length ? `助手正在使用 ${state.tabs.length} 个标签页。` : "打开普通网页和侧栏，即可开始网页调试。"
  }
  if (state?.status === "conflict") return "请关闭占用连接的其他浏览器或重复扩展，然后重新检测。"
  if (state?.status === "incompatible") {
    return state.skew === "update-cli"
      ? "请更新并重启「这是一个助手」，内置浏览器组件随主程序更新。"
      : state.skew === "update-extension"
        ? "请从本扩展仓库下载新版，并在扩展管理页重新加载。"
        : "请更新主程序和本扩展，然后重新打开侧栏。"
  }
  if (state?.status === "connecting") return "正在连接主程序提供的浏览器调试服务。"
  return local ? "打开侧栏后，主程序会自动准备调试服务并完成连接。"
    : "在侧栏登录主程序即可对话；网页调试请在主程序所在电脑使用本机扩展。"
}

export const richParts = (text: string) => text.split(/`([^`]+)`/).map((part, index) => ({ code: index % 2 === 1, text: part }))
