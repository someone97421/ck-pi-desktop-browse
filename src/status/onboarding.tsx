import { createSignal, Show, type JSX } from "solid-js"
import { render } from "solid-js/web"
import { Button } from "@opencode/ui/button"
import { browserStatusText, describeStatus } from "./describe"
import { createDesktopService, desktopServiceText, openDesktopSidepanel } from "./desktop"
import { applyColorScheme, Brand, createRelay, Note } from "./ui"
import "./onboarding.css"

const legacySetup = /^#(?:code|ticket|pair)=/.test(location.hash)
if (location.hash) history.replaceState(null, "", location.pathname + location.search)

function Onboarding() {
  const relay = createRelay()
  const desktop = createDesktopService()
  const [error, setError] = createSignal<string>()
  const open = async () => {
    setError(undefined)
    try { await openDesktopSidepanel() }
    catch { setError("未能打开侧栏，请点击浏览器工具栏中的扩展图标。") }
  }
  const check = () => { desktop.check(); relay.send({ type: "agents.reconnect" }) }

  return (
    <main class="page">
      <Brand end={<a class="link" href={chrome.runtime.getURL("settings.html")}>设置</a>} />
      <section class="guide" aria-labelledby="guide-title">
        <header class="guide-head">
          <h1 id="guide-title" class="guide-title">连接「这是一个助手」</h1>
          <p class="guide-sub hint">启动桌面主程序，打开侧栏即可开始。</p>
        </header>
        <div class="guide-body">
          <div class="connection-grid" aria-live="polite">
            <div class="connection-item" data-state={desktop.status()}>
              <span class="connection-label">主程序服务</span>
              <strong>{desktopServiceText(desktop.status())}</strong>
              <span class="hint connection-address">{desktop.origin()}</span>
            </div>
            <div class="connection-item" data-state={relay.state()?.status === "connected" && (!desktop.local() || !relay.state()?.relay.remote) ? "available" : relay.state()?.status}>
              <span class="connection-label">浏览器调试</span>
              <strong>{browserStatusText(relay.state(), desktop.local())}</strong>
              <p class="hint">{describeStatus(relay.state(), desktop.local())}</p>
            </div>
          </div>
          <Show when={desktop.status() === "unavailable"}>
            <Note tone="warn">请启动主程序，确认「局域网远程控制」插件已启用，并在扩展设置中核对服务地址。</Note>
          </Show>
          <Show when={legacySetup}>
            <Note>此扩展现由「这是一个助手」自动连接，请打开侧栏完成连接。</Note>
          </Show>
          <Show when={!desktop.local()}>
            <Note>连接其他电脑上的主程序时，请先开启远控访问，并在侧栏使用主机密码登录。</Note>
          </Show>
          <div class="actions">
            <Button variant="contrast" onClick={() => void open()}>打开侧栏</Button>
            <Button variant="neutral" icon="refresh" onClick={check}>重新检测</Button>
            <a class="link" href={chrome.runtime.getURL("settings.html")}>连接设置</a>
          </div>
          <Show when={error()}>{(message) => <Note tone="warn">{message()}</Note>}</Show>
          <div class="steps">
            <Step number={1} title="启动主程序">
              <a class="link" href="https://github.com/someone97421/CK-PI-Desktop/releases" target="_blank" rel="noreferrer">下载「这是一个助手」</a>
            </Step>
            <Step number={2} title="打开侧栏">
              <p class="hint">侧栏自动连接主程序；本机使用无需安装命令或配对码。</p>
            </Step>
            <Step number={3} title="开始对话与网页调试">
              <p class="hint">首次打开会创建临时草稿，并加入当前可调试网页。选文、DOM 和标签页引用发送到侧栏当前对话。</p>
            </Step>
          </div>
        </div>
      </section>
    </main>
  )
}

function Step(props: { number: number; title: string; children: JSX.Element }) {
  return (
    <section class="step">
      <span class="num">{props.number}</span>
      <div class="step-body">
        <h2 class="step-title">{props.title}</h2>
        {props.children}
      </div>
    </section>
  )
}

applyColorScheme()
render(() => <Onboarding />, document.getElementById("root")!)
