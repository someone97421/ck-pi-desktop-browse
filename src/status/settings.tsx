// 主程序专用连接状态与浏览器操作偏好。
import { createSignal, Show, type JSX } from "solid-js"
import { render } from "solid-js/web"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { SegmentedControl, SegmentedControlItem } from "@opencode/ui/segmented-control"
import { Switch } from "@opencode/ui/switch"
import { TextInput } from "@opencode/ui/text-input"
import { showToast, Toast } from "@opencode/ui/toast"
import {
  AGENT_DIAGNOSTICS,
  AGENT_GROUPING_KEY,
  AGENT_WINDOW_KEY,
  BROWSER_NAME_KEY,
  HANDOFF_NOTIFICATIONS_KEY,
  HUMAN_INPUT_KEY,
  IDLE_MINUTES_KEY,
  agentGrouping,
  agentWindowPlacement,
  handoffNotifications,
  humanInput,
  idleMinutesSetting,
  type AgentGrouping,
  type AgentWindowPlacement,
  type RelayOverrides,
} from "../shared/protocol"
import { DEFAULT_SERVER_ORIGIN, SERVER_ORIGIN_KEY, normalizeServerOrigin } from "../sidepanel/config"
import { browserStatusText, describeStatus } from "./describe"
import { createDesktopService, desktopServiceText, openDesktopSidepanel } from "./desktop"
import { applyColorScheme, Brand, createRelay, createStored, Note, Rich } from "./ui"
import { ElementSettings } from "./element-settings"
import "./settings.css"


function Settings() {
  const relay = createRelay()
  const state = relay.state
  const desktop = createDesktopService()
  const open = () => void openDesktopSidepanel().catch(() => {
    showToast({ title: "请点击扩展图标打开侧栏", variant: "error" })
  })

  const [agentWindow, setAgentWindow] = createStored(AGENT_WINDOW_KEY, agentWindowPlacement)
  const [grouping, setGrouping] = createStored(AGENT_GROUPING_KEY, agentGrouping)
  const [idle, setIdle] = createStored(IDLE_MINUTES_KEY, idleMinutesSetting)
  const [human, setHuman] = createStored(HUMAN_INPUT_KEY, humanInput)
  const [notifications, setNotifications] = createStored(HANDOFF_NOTIFICATIONS_KEY, handoffNotifications)
  const [storedName] = createStored(BROWSER_NAME_KEY, (value) => (typeof value === "string" ? value : ""))
  const [storedHarnessOrigin] = createStored(SERVER_ORIGIN_KEY, (value) => (typeof value === "string" ? value : DEFAULT_SERVER_ORIGIN))

  const [harnessOrigin, setHarnessOrigin] = createSignal<string>()
  const saveHarnessOrigin = (event: SubmitEvent) => {
    event.preventDefault()
    try {
      const origin = normalizeServerOrigin(harnessOrigin() ?? storedHarnessOrigin())
      void chrome.storage.local.set({ [SERVER_ORIGIN_KEY]: origin }).then(() => {
        setHarnessOrigin(origin)
        showToast({ title: "桌面服务地址已保存", description: "下次打开侧栏时生效。", variant: "success" })
      })
    } catch (error) {
      showToast({ title: "桌面服务地址无效", description: "请输入有效的 HTTP 或 HTTPS 服务地址。", variant: "error" })
    }
  }
  const [name, setName] = createSignal<string>()
  const saveName = (event: SubmitEvent) => {
    event.preventDefault()
    const next = (name() ?? storedName()).trim().slice(0, 60)
    // The background reconnects on the change, and the relay names the browser afresh.
    void (next ? chrome.storage.local.set({ [BROWSER_NAME_KEY]: next }) : chrome.storage.local.remove(BROWSER_NAME_KEY)).then(() => {
      setName(undefined)
      showToast({ title: next ? "名称已保存" : "名称已重置", description: "重新连接后，智能体即可使用新名称。", variant: "success" })
    })
  }

  const reconnect = () => { desktop.check(); relay.send({ type: "agents.reconnect" }) }

  const copyDiagnostics = () =>
    void chrome.runtime
      .sendMessage({ action: AGENT_DIAGNOSTICS })
      .then((response: { text?: string } | undefined) => navigator.clipboard.writeText(response?.text ?? "暂无诊断信息。"))
      .then(() => showToast({ title: "诊断信息已复制", description: "可粘贴到问题反馈中。", variant: "success" }))

  return (
    <main class="settings">
      <Brand
        end={
          <a class="link" href={chrome.runtime.getURL("onboarding.html")}>
            连接指南
          </a>
        }
      />

      <section class="card">
        <header class="card-head" data-state={desktop.status() === "available" ? "connected" : desktop.status() === "checking" ? "connecting" : "offline"}>
          <div class="head-line">
            <span class="dot" aria-hidden="true" />
            <h1 class="head-status">{desktopServiceText(desktop.status())}</h1>
            <Button class="head-action" variant="neutral" size="small" onClick={open}>打开侧栏</Button>
          </div>
          <p class="head-sub hint">{desktop.origin()}</p>
          <p class="head-sub hint">{browserStatusText(state(), desktop.local())}。{describeStatus(state(), desktop.local())}</p>
          <Show when={desktop.status() === "unavailable"}>
            <Note tone="warn">请启动「这是一个助手」，确认「局域网远程控制」插件已启用，并核对服务地址。</Note>
          </Show>
        </header>

        <Section title="当前浏览器">
          <Row
            label="浏览器名称"
            description="供智能体区分浏览器；最先连接的浏览器为默认项。"
          >
            <form class="name-form" onSubmit={saveName}>
              <TextInput
                value={name() ?? storedName()}
                onInput={(event) => setName(event.currentTarget.value)}
                maxlength={60}
                placeholder="浏览器与计算机名称"
                aria-label="浏览器名称"
                autocomplete="off"
                spellcheck={false}
              />
              <Button type="submit" variant="neutral">
                保存
              </Button>
            </form>
          </Row>
        </Section>
        <Section title="桌面服务">
          <Row label="服务地址" description="「这是一个助手」主程序的服务地址；连接其他电脑时，在侧栏使用主机密码登录。">
            <form class="name-form" onSubmit={saveHarnessOrigin}>
              <TextInput
                value={harnessOrigin() ?? storedHarnessOrigin()}
                onInput={(event) => setHarnessOrigin(event.currentTarget.value)}
                placeholder={DEFAULT_SERVER_ORIGIN}
                aria-label="桌面服务地址"
                autocomplete="off"
                spellcheck={false}
              />
              <Button type="submit" variant="neutral">保存</Button>
            </form>
          </Row>
        </Section>

        <Section title="智能体标签页">
          <Row label="标签页打开位置" description="在当前窗口后台打开，或使用独立窗口。">
            <SegmentedControl
              class="seg-window"
              value={agentWindow()}
              onChange={(value) => value && setAgentWindow(value as AgentWindowPlacement)}
            >
              <SegmentedControlItem value="current">当前窗口</SegmentedControlItem>
              <SegmentedControlItem value="separate">独立窗口</SegmentedControlItem>
            </SegmentedControl>
          </Row>
          <Override overrides={state()?.overrides} setting="agentWindow" />
          <Row label="标签页分组" description="合并所有智能体标签页，或按会话分组。">
            <SegmentedControl
              class="seg-group"
              value={grouping()}
              onChange={(value) => value && setGrouping(value as AgentGrouping)}
            >
              <SegmentedControlItem value="shared">统一分组</SegmentedControlItem>
              <SegmentedControlItem value="session">按会话</SegmentedControlItem>
              <SegmentedControlItem value="none">不分组</SegmentedControlItem>
            </SegmentedControl>
          </Row>
          <Row
            label="闲置标签页自动关闭"
            description="脚本运行、录制或等待人工接手时保持打开。"
          >
            <SegmentedControl class="seg-idle" value={String(idle())} onChange={(value) => value !== null && setIdle(Number(value))}>
              <SegmentedControlItem value="10">10 分钟</SegmentedControlItem>
              <SegmentedControlItem value="30">30 分钟</SegmentedControlItem>
              <SegmentedControlItem value="60">1 小时</SegmentedControlItem>
              <SegmentedControlItem value="0">永不</SegmentedControlItem>
            </SegmentedControl>
          </Row>
        </Section>

        <Section title="智能体输入">
          <Row
            label="模拟真人输入"
            description="使用自然的鼠标轨迹、打字与滚动节奏；关闭后更快，但更易被网站识别。"
          >
            <Switch hideLabel checked={human() === "on"} onChange={(on) => setHuman(on ? "on" : "off")}>
              模拟真人输入
            </Switch>
          </Row>
          <Override overrides={state()?.overrides} setting="humanInput" />
        </Section>

        <Section title="人工接手">
          <Row
            label="每次接手时通知"
            description="同时发送系统通知；关闭后仅录制中的标签页发送通知。"
          >
            <Switch hideLabel checked={notifications() === "always"} onChange={(on) => setNotifications(on ? "always" : "recording")}>
              每次接手时通知
            </Switch>
          </Row>
        </Section>


        <div class="hr" />
        <details class="advanced">
          <summary class="advanced-summary">
            <span class="advanced-title">高级设置</span>
            <span class="advanced-hint">重新检测与诊断</span>
            <Icon class="advanced-chevron" name="chevron-down" size="small" />
          </summary>
          <div class="advanced-body">
            <p class="advanced-status hint">{describeStatus(state(), desktop.local())}</p>
            <div class="actions">
              <Button variant="neutral" icon="refresh" onClick={reconnect}>
                重新检测
              </Button>
              <Button
                variant="neutral"
                onClick={() => {
                  relay.send({ type: "tabs.cleanup" })
                  showToast({ title: "已发送关闭标签页请求", variant: "success" })
                }}
              >
                关闭智能体标签页
              </Button>
              <Button variant="neutral" icon="copy" onClick={copyDiagnostics}>
                复制诊断信息
              </Button>
            </div>
            <p class="advanced-id">
              扩展 ID <code>{chrome.runtime.id}</code>
            </p>
          </div>
        </details>
      </section>

      <ElementSettings />

      <footer class="settings-foot hint">点击扩展图标打开侧栏；网页引用会发送到侧栏当前对话。</footer>
      <Toast.Region />
    </main>
  )
}

/** A section of the card, under a hairline: a small heading, then a row per setting. */
function Section(props: { title: string; children: JSX.Element }) {
  return (
    <>
      <div class="hr" />
      <section class="section">
        <h2 class="section-title">{props.title}</h2>
        <div class="section-body">{props.children}</div>
      </section>
    </>
  )
}

/** A setting on one line: what it is (and a sentence on it) on the left, the control on the right; a narrow page stacks them. */
function Row(props: { label: string; description?: string; children: JSX.Element }) {
  return (
    <div class="row">
      <div class="row-text">
        <span class="row-label">{props.label}</span>
        <Show when={props.description}>
          {(description) => (
            <span class="row-desc hint">
              <Rich text={description()} />
            </span>
          )}
        </Show>
      </div>
      <div class="row-control">{props.children}</div>
    </div>
  )
}


// A setting the relay's environment fixes wins over the page's; say so, with the value in effect.
const overrideNotes: { [Key in keyof RelayOverrides]-?: { variable: string; labels: Record<NonNullable<RelayOverrides[Key]>, string> } } = {
  agentWindow: { variable: "OPENCODE_BROWSER_AGENT_WINDOW", labels: { current: "当前窗口", separate: "独立窗口" } },
  humanInput: { variable: "OPENCODE_BROWSER_HUMAN_INPUT", labels: { on: "开启", off: "关闭" } },
}
function Override(props: { overrides: RelayOverrides | undefined; setting: keyof RelayOverrides }) {
  const value = () => props.overrides?.[props.setting]
  return (
    <Show when={value()}>
      {(current) => (
        <Note tone="warn">
          当前生效：{(overrideNotes[props.setting].labels as Record<string, string>)[current()]}。由中继环境变量
          <code>{overrideNotes[props.setting].variable}</code> 指定。
        </Note>
      )}
    </Show>
  )
}


applyColorScheme()
render(() => <Settings />, document.getElementById("root")!)
