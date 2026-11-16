import type { AgentRelayState, CliUpdateNotice, ToStatusPage } from "../shared/protocol"
import { installCommand } from "./install"

export type RelayResult = Extract<ToStatusPage, { type: "relay.result" }>

export const unpackedReloadText = "请从个人源码手动更新扩展，然后在 `chrome://extensions` 找到「这是一个助手 · 浏览器」并点击重新加载。"

export const cliUpdateText = (notice: CliUpdateNotice) =>
  `Browse CLI ${notice.current} 有可用更新 ${notice.latest}。请手动运行 \`${notice.command}\`。`

export function relayResultText(result: RelayResult["status"], address: string, codeSent: boolean) {
  const local = address.startsWith("localhost:")
  const at = local ? `本机中继（${address}）` : `中继 ${address}`
  return {
    "invalid-address": "地址无效。请输入 localhost、主机名或 IP，可附带端口，如 devbox.tailnet.ts.net:19988。",
    "invalid-code": "配对码无效。请输入中继所在计算机运行 `browse pair` 后生成的 8 位配对码（XXXX-XXXX）。",
    connected: `已连接${at}。`,
    connecting: `${at} 尚未响应，连接后将自动刷新状态。`,
    offline: codeSent
      ? `配对码已保存。${at} 启动后将自动配对，请在生成配对码后 10 分钟内完成。`
      : local
        ? `${at} 尚未响应。智能体首次使用 Browse 工具时会启动中继。`
        : `${at} 尚未响应。请核对地址，确认远程中继已启动并运行过 \`browse set hostname 0.0.0.0\`。`,
    unpaired: `${at} 已响应，但尚未配对。请在该计算机运行 \`browse pair\` 并输入配对码。`,
    untrusted: `${at} 未接受配对。请在该计算机运行 \`browse pair\`，输入新的配对码。`,
    conflict: `${at} 已被其他浏览器或用户配置中的扩展连接。`,
    incompatible: `${at} 与此扩展的协议不兼容，请手动更新两者后重新连接。`,
  }[result]
}

export const relayResultTone = (result: RelayResult["status"]): "ok" | "warn" | "neutral" =>
  result === "connected" ? "ok" : result === "connecting" || result === "offline" ? "neutral" : "warn"

export function describeStatus(state: AgentRelayState, unpacked: boolean) {
  const tabs = state.tabs.length
  const remote = state.relay.remote ? state.relay.address : undefined
  if (state.status === "connected") {
    const connected = remote ? `已连接中继 ${remote}。` : "已连接。"
    return tabs ? `${connected}智能体正在使用 ${tabs} 个标签页。` : `${connected}暂无智能体使用标签页。`
  }
  if (state.status === "connecting") return "正在连接中继…"
  if (state.status === "conflict")
    return "其他浏览器或用户配置中的扩展已连接中继。请先关闭该扩展或浏览器，再重新连接。"
  if (state.status === "incompatible" && state.skew === "update-cli")
    return `本机 Browse CLI 版本较旧。请手动运行 \`${installCommand}\` 更新，然后重新连接。`
  if (state.status === "incompatible" && state.skew === "update-extension")
    return state.unpacked || unpacked
      ? unpackedReloadText
      : "此扩展版本较旧。请从个人源码手动更新，并在 `chrome://extensions` 重新加载扩展。"
  if (state.status === "incompatible") return "扩展与 CLI 版本不兼容。请重新运行安装命令，再重新连接。"
  if (state.status === "unpaired")
    return "尚未配对。请运行连接指南中的安装命令，或在高级设置输入配对码。"
  if (state.status === "untrusted" && remote)
    return `中继 ${remote} 未接受此浏览器。请在该计算机运行 \`browse pair\`，在高级设置输入新配对码。`
  if (state.status === "untrusted")
    return state.unpacked
      ? "本机中继未接受此浏览器。请重新运行安装命令，或在高级设置输入 `browse pair` 生成的新配对码。"
      : "本机中继未接受此浏览器。请在高级设置输入 `browse pair` 生成的新配对码，或手动更新 CLI。"
  if (remote) return `正在等待中继 ${remote}。远程智能体首次使用 Browse 工具时会启动中继。`
  return "正在等待智能体首次使用 Browse 工具并启动中继。"
}

export const richParts = (text: string) => text.split(/`([^`]+)`/).map((part, index) => ({ code: index % 2 === 1, text: part }))
