import { expect, test } from "bun:test"
import { parseExtensionCommand } from "../../src/agent-relay/protocol"
import { installChrome } from "../chrome-stub"
import { installFakeRelaySocket } from "../relay-stub"

const stub = installChrome()
Object.assign(globalThis, { __OPENCODE_BROWSER_BUILD__: "test" })
const TOKEN = "test-token-0123456789abcdefghijklmnopqrstuv"
const PORT = 19908
const socket = installFakeRelaySocket({ port: PORT, token: TOKEN })
await stub.chrome.storage.local.set({ agentRelayPort: PORT, agentRelayTokens: { [`127.0.0.1:${PORT}`]: TOKEN } })
const { createAgentRelay } = await import("../../src/background/agent-relay")
const relay = createAgentRelay({ changed: () => {}, badgesChanged: () => {} })

async function until(check: () => boolean) {
  for (let i = 0; i < 1_500 && !check(); i++) await Bun.sleep(10)
  expect(check()).toBe(true)
}
await until(() => relay.state().status === "connected")

let nextId = 1
async function query() {
  const id = nextId++
  socket().deliver({ id, method: "tabs.query" })
  await until(() => socket().received.some((message) => message.id === id))
  return socket().received.find((message) => message.id === id)!
}

test("协议接受不带参数的 tabs.query", () => {
  expect(parseExtensionCommand(JSON.stringify({ id: 7, method: "tabs.query" }))).toEqual({ id: 7, method: "tabs.query" })
})

test("tabs.query 直接查询所有窗口并返回未借出标签页元数据", async () => {
  const realQuery = chrome.tabs.query
  const calls: chrome.tabs.QueryInfo[] = []
  const tabs = [
    { id: 42, url: "https://example.test/", title: "原有页面", windowId: 8 },
    { id: 43, url: "file:///example.html", title: "另一个窗口", windowId: 9 },
    { id: 44, windowId: 9 },
    { url: "https://closed.test/", windowId: 8 },
  ] as chrome.tabs.Tab[]
  chrome.tabs.query = (async (info: chrome.tabs.QueryInfo) => { calls.push(info); return tabs }) as typeof chrome.tabs.query
  try {
    expect(relay.state().tabs).toEqual([])
    const reply = await query()
    expect(reply.error).toBeUndefined()
    expect(calls).toEqual([{}])
    expect(reply.result).toEqual({ tabs: [
      { tabId: 42, url: "https://example.test/", title: "原有页面", windowId: 8 },
      { tabId: 43, url: "file:///example.html", title: "另一个窗口", windowId: 9 },
      { tabId: 44, url: "", title: "", windowId: 9 },
    ] })
    expect(relay.state().tabs).toEqual([])
    expect(socket().received.some((message) => message.method === "toolbar.clicked")).toBe(false)
  } finally { chrome.tabs.query = realQuery }
})

test("tabs.query 查询失败时向 Relay 明确返回错误", async () => {
  const realQuery = chrome.tabs.query
  chrome.tabs.query = (async () => { throw new Error("无法查询标签页") }) as typeof chrome.tabs.query
  try {
    const reply = await query()
    expect(reply.result).toBeUndefined()
    expect(reply.error).toContain("无法查询标签页")
  } finally { chrome.tabs.query = realQuery }
})
