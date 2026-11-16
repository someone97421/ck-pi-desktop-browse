import { describe, expect, test } from "bun:test"
import type { AgentRelayState } from "../src/shared/protocol"
import { checklist, type ChecklistInput } from "../src/status/checklist"
import { relayResultText, richParts } from "../src/status/describe"

const state = (overrides: Partial<AgentRelayState> = {}): AgentRelayState => ({
  status: "unpaired",
  pairing: "none",
  tabs: [],
  relay: { address: "localhost:19988", remote: false },
  ...overrides,
})
const input = (overrides: Partial<ChecklistInput> = {}): ChecklistInput => ({
  state: state(),
  wasConnected: false,
  tried: false,
  ...overrides,
})

describe("onboarding checklist", () => {
  test("a fresh install starts on the agent step, with the rest not reached", () => {
    expect(checklist(input())).toEqual({ agent: "active", tryIt: "upcoming", finished: false })
    expect(checklist(input({ state: undefined }))).toMatchObject({ agent: "active" })
  })

  test("connecting the agent moves on to trying it", () => {
    const connected = state({ status: "connected", pairing: "token" })
    expect(checklist(input({ state: connected }))).toEqual({ agent: "done", tryIt: "active", finished: false })
  })

  test("an agent tab finishes it", () => {
    const used = state({ status: "connected", pairing: "token", tabs: [{ tabId: 3 }] })
    expect(checklist(input({ state: used }))).toEqual({ agent: "done", tryIt: "done", finished: true })
    expect(checklist(input({ state: state({ status: "connected", pairing: "token" }), tried: true })).finished).toBe(true)
  })

  test("the agent step stays done while a paired relay stops, not when it refuses the browser", () => {
    expect(checklist(input({ state: state({ status: "offline", pairing: "token" }), wasConnected: true })).agent).toBe("done")
    expect(checklist(input({ state: state({ status: "offline", pairing: "token" }) })).agent).toBe("active")
    expect(checklist(input({ state: state({ status: "untrusted", pairing: "token" }), wasConnected: true })).agent).toBe("active")
  })
})

describe("relay results", () => {
  test("say where, in plain words", () => {
    expect(relayResultText("connected", "devbox:19988", false)).toBe("已连接中继 devbox:19988。")
    expect(relayResultText("offline", "localhost:19988", false)).toContain("本机中继（localhost:19988）")
    expect(relayResultText("offline", "devbox:19988", true)).toStartWith("配对码已保存。")
  })

  test("mark commands as code", () => {
    expect(richParts("run `pair` there")).toEqual([
      { code: false, text: "run " },
      { code: true, text: "pair" },
      { code: false, text: " there" },
    ])
  })
})
