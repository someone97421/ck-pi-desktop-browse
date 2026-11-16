// The onboarding page (onboarding.html): opened on install, and by the toolbar button while this browser isn't paired.
// One card, laid out like Console's Connect OpenCode guide: a tab for an agent on this computer and one for an agent on
// another computer, each a few numbered steps that check themselves off from the worker's state and the first agent
// tab.
import { createEffect, createMemo, createSignal, For, Match, onCleanup, Show, Switch, type JSX } from "solid-js"
import { render } from "solid-js/web"
import { Tabs } from "@kobalte/core/tabs"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { TextInput } from "@opencode/ui/text-input"
import { unpackedExtensionId } from "../../cli/src/protocol"
import { relayPorts } from "../agent-relay/protocol"
import { probeRelayPort, type RelayProbe } from "../agent-relay/probe"
import { cliUpdateNotice } from "../shared/protocol"
import { cliUpdateText, unpackedReloadText } from "./describe"
import { firstRunStep, shouldProbe, type FirstRunStep } from "./first-run"
import { pairingLink } from "./pairing-link"
import { TRY_PROMPT, checklist } from "./checklist"
import { installCommand, installMethod, installMethods, remoteInstallMethod, remoteInstallMethods, type InstallMethod } from "./install"
import { RelayForm } from "./relay-form"
import { applyColorScheme, Brand, createFlash, createRelay, Note, Rich, type Relay } from "./ui"
import "./onboarding.css"

// `browse install` opens the setup page with a one-time code in the fragment (welcome.html#code=…, which forwards
// here), plus the relay's port when it isn't 19988, for a store build (cli/src/setup.ts pairStoreExtension). Take
// them, then drop the whole fragment from the URL (address bar and history) before anything else.
const link = pairingLink(location.hash)
let fragmentCode = link?.code
const fragmentPort = link?.port
const installTab = !!fragmentCode
if (link !== undefined || /^#(code|ticket|pair)=/.test(location.hash))
  history.replaceState(null, "", location.pathname + location.search)

const settingsUrl = () => chrome.runtime.getURL("settings.html")
const AGENT_PROMPT = `Set up browse so you can use my Chrome: run ${installCommand}`

type Where = "here" | "remote"
type How = "agent" | "manual"

function Onboarding() {
  const relay = createRelay()
  const [probe, setProbe] = createSignal<RelayProbe>("unknown")
  const [installWaiting, setInstallWaiting] = createSignal(installTab)
  const [wasConnected, setWasConnected] = createSignal(false)
  const [tried, setTried] = createSignal(false)
  const [pairedBy, setPairedBy] = createSignal<"link" | "code">()
  const [linkNote, setLinkNote] = createSignal<string>()
  const [where, setWhere] = createSignal<Where>()
  const [how, setHow] = createSignal<How>("agent")
  const [pickedMethod, setPickedMethod] = createSignal(installMethod.id)
  const [pickedRemoteMethod, setPickedRemoteMethod] = createSignal(remoteInstallMethod.id)

  const step = createMemo(() => firstRunStep(relay.state(), installWaiting() ? "install-waiting" : probe()))
  const list = createMemo(() => checklist({ state: relay.state(), wasConnected: wasConnected(), tried: tried() }))
  const connected = () => list().agent === "done"
  const method = createMemo(() => installMethods.find((option) => option.id === pickedMethod()) ?? installMethod)
  const remoteMethod = createMemo(() => remoteInstallMethods.find((option) => option.id === pickedRemoteMethod()) ?? remoteInstallMethod)
  // Until the user picks, it follows where the extension already points.
  const remote = () => (where() ?? (relay.state()?.relay.remote ? "remote" : "here")) === "remote"

  createEffect(() => {
    const state = relay.state()
    if (!state) return
    if (state.status === "connected") setWasConnected(true)
    if (state.status === "connected" && state.tabs.length > 0) setTried(true)
    if (installWaiting() && state.status === "connected") {
      setInstallWaiting(false)
      void returnToFirstRunTab().catch(() => {})
    }
    // The code from install's URL, used once, and only when this extension isn't paired with the relay (no token, or
    // one the relay refused). A working pairing is never replaced; the page says it ignored the link instead. While
    // it's still connecting (or the relay is starting), wait for a status that tells.
    if (fragmentCode && state.status !== "offline" && state.status !== "connecting") {
      if (state.status === "unpaired" || state.status === "untrusted")
        relay.send({
          type: "pairing.link",
          code: fragmentCode,
          ...(fragmentPort !== undefined ? { port: fragmentPort } : {}),
        })
      else setLinkNote("已与中继配对，已忽略安装链接中的配对码。")
      fragmentCode = undefined
    }
    if (shouldProbe(state)) void probeRelay()
  })
  relay.onMessage((message) => {
    if (message?.type !== "pairing.link.result") return
    if (message.ok) setPairedBy("link")
    else setLinkNote("已与中继配对，已忽略安装链接中的配对码。")
  })

  /**
   * Asks the port the worker is using whether a browse relay answers (its /version is open), while the extension has
   * no token or code to connect with. One probe at a time, and again while the page stays in that state. When the
   * worker finds the relay on another port (a fallback relay), the probe follows it right away.
   */
  let probing = false
  let probedPort: number | undefined
  let probeTimer: ReturnType<typeof setTimeout> | undefined
  async function probeRelay() {
    if (probing) return
    const port = Number(/:(\d+)$/.exec(relay.state()?.relay.address ?? "")?.[1]) || undefined
    if (port !== probedPort) {
      clearTimeout(probeTimer)
      probeTimer = undefined
    } else if (probeTimer !== undefined) return
    probing = true
    probedPort = port
    const result = port === undefined ? "absent" : await probeRelayPort(port)
    // A relay on a fallback port isn't pre-filled in the form (it may not be this browser's), but it still tells the
    // step apart: "pair with it" rather than "install browse".
    const elsewhere = result === "absent"
      ? (await Promise.all(relayPorts.filter((candidate) => candidate !== port).map((candidate) => probeRelayPort(candidate))))
        .find((answer) => answer !== "absent")
      : undefined
    probing = false
    setProbe(result === "absent" ? elsewhere ?? "absent" : result)
    probeTimer = setTimeout(() => {
      probeTimer = undefined
      if (shouldProbe(relay.state())) void probeRelay()
    }, 3_000)
  }
  onCleanup(() => clearTimeout(probeTimer))

  const tryIt = (number: number) => (
    <Step
      number={number}
      title="试用一下"
      done={list().tryIt === "done"}
      description={list().tryIt === "done" ? "智能体已打开标签页，连接可用。" : "将以下示例发送给智能体："}
    >
      <Show when={list().tryIt !== "done"}>
        <Command text={TRY_PROMPT} label="复制提示词" />
        <Show when={connected()}>
          <Waiting>正在等待智能体打开第一个标签页…</Waiting>
        </Show>
      </Show>
    </Step>
  )

  const installStep = (how: How) => (
    <Step
      number={1}
      title={how === "agent" ? "发送给你的智能体" : method().title}
      done={connected()}
      description={
        connected() ? (
          <AgentDone relay={relay} pairedBy={pairedBy()} />
        ) : how === "agent" ? (
          "支持 OpenCode、Claude Code、Codex、Cursor 等可执行命令的智能体。"
        ) : (
          "从个人源码安装 Browse CLI，配置本机智能体并连接此浏览器。"
        )
      }
    >
      <Show when={!connected()}>
        <AgentStep
          relay={relay}
          step={step()}
          command={
            how === "agent" ? (
              <Command text={AGENT_PROMPT} label="复制提示词" />
            ) : (
              <Command
                text={method().command}
                label="复制命令"
                picker={<MethodMenu methods={installMethods} value={method()} onChange={(option) => setPickedMethod(option.id)} />}
              />
            )
          }
          linkNote={linkNote()}
          onPaired={() => setPairedBy("code")}
        />
      </Show>
    </Step>
  )

  return (
    <main class="page">
      <Brand />

      <section class="guide" aria-labelledby="guide-title">
        <header class="guide-head">
          <h1 id="guide-title" class="guide-title">
            {remote() ? "连接其他计算机上的智能体" : "连接你的智能体"}
            <Show when={connected()}>
              <span class="guide-connected">
                <span aria-hidden="true">·</span>
                <span class="ok">已连接</span>
              </span>
            </Show>
          </h1>
          <p class="guide-sub hint">
            <Show when={remote()} fallback="连接进度会自动更新。">
              适用于服务器或其他计算机。{" "}
              <button type="button" class="link" onClick={() => setWhere("here")}>
                改为连接本机
              </button>
            </Show>
          </p>
        </header>

        <Show when={connected() ? cliUpdateNotice(relay.state()?.autoUpdate) : undefined}>
          {(notice) => (
            <div class="guide-notice">
              <Note tone="warn">
                <Rich text={cliUpdateText(notice())} />
              </Note>
            </div>
          )}
        </Show>

        <Show
          when={remote()}
          fallback={
            <Tabs value={how()} onChange={(value) => setHow(value as How)}>
              <Tabs.List class="tabs" aria-label="安装方式">
                <Tabs.Trigger class="tab" value="agent">
                  <span>让智能体配置</span>
                </Tabs.Trigger>
                <Tabs.Trigger class="tab" value="manual">
                  <span>手动配置</span>
                </Tabs.Trigger>
                <Tabs.Indicator class="tab-indicator" />
              </Tabs.List>
              <div class="hr" />
              <Tabs.Content class="guide-body" value="agent">
                <div class="steps">
                  {installStep("agent")}
                  {tryIt(2)}
                </div>
              </Tabs.Content>
              <Tabs.Content class="guide-body" value="manual">
                <div class="steps">
                  {installStep("manual")}
                  {tryIt(2)}
                </div>
              </Tabs.Content>
            </Tabs>
          }
        >
          <div class="hr" />
          <div class="guide-body">
            <div class="steps">
              <Step
                number={1}
                title="在远程计算机运行"
                done={connected()}
                description="安装 Browse CLI、允许远程连接，并生成中继地址与配对码。"
              >
                <Show when={!connected()}>
                  <Command
                    text={remoteMethod().command}
                    label="复制命令"
                    picker={
                      <MethodMenu
                        methods={remoteInstallMethods}
                        value={remoteMethod()}
                        onChange={(option) => setPickedRemoteMethod(option.id)}
                      />
                    }
                  />
                </Show>
              </Step>
              <Step
                number={2}
                title="输入中继地址与配对码"
                done={connected()}
                description={connected() ? <AgentDone relay={relay} pairedBy={pairedBy()} /> : "配对码 10 分钟内有效，仅可用一次。"}
              >
                <Show when={!connected()}>
                  <RelayForm relay={relay} remote />
                </Show>
              </Step>
              {tryIt(3)}
            </div>
          </div>
        </Show>

        <Show when={!remote() && !list().finished}>
          <div class="hr" />
          <footer class="guide-foot">
            <span class="muted">
              智能体在其他计算机上？{" "}
              <button type="button" class="link" onClick={() => setWhere("remote")}>
                连接远程智能体
              </button>
            </span>
          </footer>
        </Show>

        <Show when={list().finished}>
          <div class="hr" />
          <footer class="guide-foot">
            <Button variant="neutral" size="large" onClick={() => location.assign(settingsUrl())}>
              打开设置
            </Button>
            <span class="sep" aria-hidden="true" />
            <span class="muted hint">配置完成。需要登录时，页面会提示你接手。</span>
          </footer>
        </Show>
      </section>
    </main>
  )
}

/** One numbered step on the rail: the number turns into a check once it's done. */
function Step(props: { number: number; title: string; description?: JSX.Element; done?: boolean; children?: JSX.Element }) {
  return (
    <div class="step" data-done={props.done ? "" : undefined}>
      <div class="rail" aria-hidden="true">
        <span class="num">
          <Show when={props.done} fallback={props.number}>
            <Icon name="check" size="small" />
          </Show>
        </span>
        <span class="line" />
      </div>
      <div class="step-body">
        <div class="step-text">
          <h2 class="step-title">{props.title}</h2>
          <Show when={props.description}>
            <p class="step-desc hint">{props.description}</p>
          </Show>
        </div>
        {props.children}
      </div>
    </div>
  )
}

/** A command or prompt to copy: [picker ▾ | text ⧉]. */
function Command(props: { text: string; label: string; picker?: JSX.Element }) {
  const [copied, flash] = createFlash("copy", "check")
  return (
    <div class="cmd">
      <Show when={props.picker}>
        {(picker) => (
          <>
            {picker()}
            <span class="cmd-sep" />
          </>
        )}
      </Show>
      <div class="cmd-text">
        <code>{props.text}</code>
        <IconButton
          variant="ghost-muted"
          size="small"
          aria-label={copied() === "check" ? "已复制" : props.label}
          icon={<Icon name={copied() === "check" ? "check" : "copy"} size="small" />}
          onClick={() => void navigator.clipboard.writeText(props.text).then(flash)}
        />
      </div>
    </div>
  )
}

/** The install method picker that sits on the left of a command box. */
function MethodMenu(props: { methods: InstallMethod[]; value: InstallMethod; onChange: (method: InstallMethod) => void }) {
  return (
    <Menu placement="bottom-start" gutter={4}>
      <Menu.Trigger class="cmd-menu" aria-label="安装方式">
        {props.value.label}
        <Icon name="chevron-down" size="small" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content>
          <Menu.RadioGroup
            value={props.value.id}
            onChange={(id) => {
              const picked = props.methods.find((option) => option.id === id)
              if (picked) props.onChange(picked)
            }}
          >
            <For each={props.methods}>{(method) => <Menu.RadioItem value={method.id} closeOnSelect>{method.label}</Menu.RadioItem>}</For>
          </Menu.RadioGroup>
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  )
}

function Waiting(props: { children: JSX.Element }) {
  return (
    <p class="waiting" aria-live="polite">
      <span class="pulse" aria-hidden="true" />
      <span>{props.children}</span>
    </p>
  )
}

function AgentDone(props: { relay: Relay; pairedBy: "link" | "code" | undefined }) {
  const state = () => props.relay.state()
  const remote = () => (state()?.relay.remote ? state()?.relay.address : undefined)
  return (
    <>
      {props.pairedBy ? "已配对并连接" : "已连接"}
      <Show when={state()?.browser}>
        {(browser) => (
          <>
            {"。浏览器标识："}
            <span class="kbd">{browser().id}</span>
          </>
        )}
      </Show>
      <Show when={remote()}>{(address) => <>{"；中继："}<span class="kbd">{address()}</span></>}</Show>
      。
    </>
  )
}

/** Step 1 on this computer: the prompt or command that installs browse, and whatever the connection says to do next. */
function AgentStep(props: {
  relay: Relay
  step: FirstRunStep
  command: JSX.Element
  linkNote: string | undefined
  onPaired: () => void
}) {
  const here = (remote: string | undefined) => (remote ? `中继 ${remote}` : "本机中继")
  const kind = () => props.step.kind
  const remote = () => ("remote" in props.step ? props.step.remote : undefined)
  const unpacked = () => (props.step.kind === "update-extension" ? props.step.unpacked || chrome.runtime.id === unpackedExtensionId : false)
  const showInstall = () => kind() === "install" || (kind() === "pair" && !remote()) || kind() === "mismatch"

  return (
    <>
      <Show when={showInstall()}>{props.command}</Show>

      <Switch>
        <Match when={kind() === "checking"}>
          <Waiting>正在检查…</Waiting>
        </Match>
        <Match when={kind() === "install"}>
          <Waiting>正在等待智能体连接…</Waiting>
        </Match>
        <Match when={kind() === "finishing"}>
          <Waiting>正在完成配置，请保持终端中的安装命令运行。</Waiting>
        </Match>
        <Match when={props.step.kind === "pair" && props.step}>
          {(pair) => (
            <>
              <Note tone="warn">
                {pair().reason === "code-rejected"
                  ? `${here(pair().remote)}未接受配对码：可能输入有误、已使用或已过期。`
                  : pair().reason === "refused"
                    ? `${here(pair().remote)}拒绝配对：可能已取消配对或重新安装中继。`
                    : `已发现${here(pair().remote)}，此浏览器尚未配对。`}{" "}
                {pair().remote ? "" : "请重新运行安装命令以配对，或输入配对码。"}
              </Note>
              <CodeForm
                relay={props.relay}
                label={pair().remote ? "在远程计算机运行 `browse pair` 并输入配对码：" : "也可输入 `browse pair` 生成的配对码："}
                onPaired={props.onPaired}
              />
            </>
          )}
        </Match>
        <Match when={props.step.kind === "waiting" && props.step}>
          {(waiting) =>
            waiting().pairing === "code" ? (
              <Waiting>
                配对码已保存，{here(waiting().remote)}启动后将自动配对。请在生成配对码后 10 分钟内完成。
              </Waiting>
            ) : (
              <Waiting>已与{here(waiting().remote)}配对。智能体使用 Browse 工具时会启动中继。</Waiting>
            )
          }
        </Match>
        <Match when={props.step.kind === "connecting" && props.step}>
          {(connecting) => <Waiting>正在{connecting().pairing ? "配对" : "连接"}{here(connecting().remote)}…</Waiting>}
        </Match>
        <Match when={kind() === "update-cli"}>
          <Note tone="warn">
            本机 Browse CLI 版本较旧。请手动运行以下命令更新，然后重启智能体。
          </Note>
          <Command text={installCommand} label="复制命令" />
        </Match>
        <Match when={kind() === "update-extension"}>
          <Show
            when={!unpacked()}
            fallback={
              <Note tone="warn">
                <Rich text={unpackedReloadText} />
              </Note>
            }
          >
            <Note tone="warn">
              此扩展版本较旧。请从个人源码手动更新，然后在扩展管理页重新加载。
            </Note>
            <div class="actions">
              <Button variant="neutral" onClick={() => void chrome.tabs.create({ url: "chrome://extensions" })}>
                打开扩展管理页
              </Button>
            </div>
          </Show>
        </Match>
        <Match when={kind() === "mismatch"}>
          <Note tone="warn">扩展与本机 Browse CLI 版本不兼容。请重新运行安装命令后连接。</Note>
          <div class="actions">
            <Button variant="neutral" icon="refresh" onClick={() => props.relay.send({ type: "agents.reconnect" })}>
              重新连接
            </Button>
          </div>
        </Match>
        <Match when={kind() === "conflict"}>
          <Note tone="warn">
            其他浏览器或用户配置中的扩展已占用中继连接。请先关闭该扩展或浏览器，再重新连接。
          </Note>
          <div class="actions">
            <Button variant="neutral" icon="refresh" onClick={() => props.relay.send({ type: "agents.reconnect" })}>
              重新连接
            </Button>
          </div>
        </Match>
      </Switch>

      <Show when={props.linkNote}>{(text) => <Note>{text()}</Note>}</Show>
    </>
  )
}

/** A pairing code for the relay the extension already points at. */
function CodeForm(props: { relay: Relay; label: string; onPaired: () => void }) {
  const [code, setCode] = createSignal("")
  const [pending, setPending] = createSignal(false)
  const [note, setNote] = createSignal<string>()
  props.relay.onMessage((message) => {
    if (message === undefined) return setPending(false)
    if (message.type !== "relay.result" || !pending()) return
    setPending(false)
    if (message.status === "connected") props.onPaired()
    if (message.status === "invalid-code") return setNote("配对码无效。请输入 `browse pair` 生成的 8 位配对码（XXXX-XXXX）。")
    setCode("")
    const address = message.address ?? ""
    setNote(message.status === "connecting" ? `${address.startsWith("localhost:") ? "本机中继" : `中继 ${address}`}尚未响应，连接后将自动刷新状态。` : undefined)
  })
  return (
    <form
      class="code-form"
      onSubmit={(event) => {
        event.preventDefault()
        if (!code().trim()) return
        setPending(true)
        setNote(undefined)
        // connectTo treats the shown port submitted unchanged as automatic, not as a typed hint.
        props.relay.send({ type: "relay.connect", address: props.relay.state()?.relay.address ?? "", code: code() })
      }}
    >
      <p class="hint">
        <Rich text={props.label} />
      </p>
      <div class="inline-form">
        <TextInput value={code()} onInput={(event) => setCode(event.currentTarget.value)} placeholder="XXXX-XXXX" aria-label="配对码" autocomplete="off" spellcheck={false} />
        <Button type="submit" variant="contrast" disabled={pending()}>
          {pending() ? "正在配对…" : "配对"}
        </Button>
      </div>
      <Show when={note()}>{(text) => <Note tone="warn"><Rich text={text()} /></Note>}</Show>
    </form>
  )
}

// Only remove this install-created code tab, after success, if the original first-run tab still exists in its window.
async function returnToFirstRunTab() {
  const self = await chrome.tabs.getCurrent()
  if (self?.id === undefined) return
  const firstRun = new Set(["onboarding.html?first-run", "welcome.html?first-run"].map((page) => chrome.runtime.getURL(page)))
  const original = (await chrome.tabs.query({ windowId: self.windowId })).find((tab) => tab.url !== undefined && firstRun.has(tab.url))
  if (original?.id === undefined || original.id === self.id) return
  if (self.active) await chrome.tabs.update(original.id, { active: true })
  await chrome.tabs.remove(self.id)
}

applyColorScheme()
render(() => <Onboarding />, document.getElementById("root")!)
