import { isLoopbackOrigin } from "./config"

export async function extensionSession(origin: string): Promise<string> {
  if (!isLoopbackOrigin(origin)) throw new Error("跨机侧栏请使用主机密码登录")
  const response = await fetch(new URL("/api/extension-session", origin), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(12_000),
  })
  const result: unknown = await response.json()
  if (!result || typeof result !== "object") throw new Error("主程序未返回有效的扩展会话")
  if (!response.ok || !("ok" in result) || result.ok !== true) {
    throw new Error("error" in result && typeof result.error === "string" ? result.error : "主程序拒绝扩展会话请求")
  }
  const session = "result" in result ? result.result : undefined
  if (!session || typeof session !== "object" || !("token" in session) || typeof session.token !== "string" || !session.token.trim()) throw new Error("主程序未返回扩展会话令牌")
  return session.token
}
