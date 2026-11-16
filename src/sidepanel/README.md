# 侧边栏与原版 Renderer

侧栏只加载 Harness 提供的桌面 Renderer iframe；不再在聊天面板上常驻 Browse 连接栏。Browse 状态、当前标签页操作入口由原版 Renderer 的 Composer 工具栏呈现，扩展后台继续维护 Relay 连接、自动 ensure、自动配对、当前 tab 状态以及父子消息转发。

默认 Harness 地址为 `http://127.0.0.1:7878`，在独立的 `settings.html` 设置页中修改。地址保存到 `chrome.storage.local` 的 `chromeSidebarServerOrigin`，与 `src/sidepanel/config.ts` 共用；Relay 地址、配对码和浏览器配置继续在设置页的“高级设置”区域维护。

iframe 地址为 `/?webRemote=true&parentOrigin=chrome-extension://<扩展ID>`。主机密码、设备 token、IPC 与附件请求全部在 iframe 内处理。扩展只收到认证/在线状态和已请求操作的结果，不接收 Bearer。双方都验证 `event.source` 和精确 `event.origin`。

消息格式：

- 父 → 子：`{type:"pi-desktop:status-request"}` 查询 Harness 状态。
- 子 → 父：`{type:"pi-desktop:remote-status",authenticated,online,canCompose}`。
- 父 → 子：`{type:"pi-desktop:browse-status",authenticated,online,busy,borrowed,browserContext}` 推送当前 tab 操作状态。
- 子 → 父：`{type:"pi-desktop:browse-request",requestId,method}`，method 为 `toggleAttach`、`insertCurrent` 或 `handoff`。
- 父 → 子：`{type:"pi-desktop:browse-response",requestId,ok,result}` 或 `{type:"pi-desktop:browse-response",requestId,ok:false,error}`。`insertCurrent` 确认 chip 已插入后返回 `inserted:true` 和目标 `clientId`。
- 父子之间仍使用既有 `pi-desktop:request/response` 处理 Harness 内部 RPC，例如 ensure Relay、生成配对码和插入 Composer 草稿。

Browse 操作收到请求后会先自动 ensure 或配对 Relay，再执行后台 tab/handoff 操作。借出/收回当前页与 `@当前页` 位于原版 Composer 工具栏，Relay 未配对时会返回连接错误而不是静默无响应。

## 浏览器引用

扩展名称为“这是一个助手 · 浏览器”，设置、引导和通知使用中文及主程序图标。构建后在 Chrome 扩展管理页重新加载扩展，再打开侧栏并登录；同时需要包含浏览器引用 IPC 的新版主程序。

侧栏开启且在线时，桌面和侧栏 Composer 输入 `@` 均可搜索所有已打开标签页的标题或 URL，插入页面 chip；不需要先借出标签页。页面、选文、DOM 三类 chip 使用不同图标，悬停可查看完整引用。

网页右键菜单“发送给Agent”根据选区插入页面或选文 chip。设置页“网页元素拾取”可独立启停，并选择 Ctrl、Alt、Shift 的组合；默认 Alt + Shift + 点击。按住组合点击元素直接插入 DOM chip，Escape 退出。提取保留 ShowWeb 的角色、名称、CSS／开放 Shadow DOM 定位、文本、属性、上下文及 HTML 摘要，不保留浮窗面板。

引用写入最近聚焦的 Agent 草稿光标或选区；工具栏“当前页”只写入当前侧栏。切换草稿、连接断开或未收到确认时明确失败。发送优先通过来源窗口的在线侧栏转发，没有时可使用其他窗口唯一的在线侧栏。Chrome 受保护页面和关闭的 Shadow DOM 不支持完整拾取。

验证命令：

```sh
bun run typecheck
bun run build
bun test ./test/sidepanel.test.ts ./test/browser-references.test.ts ./test/element-picker-state.test.ts
```

扩展构建本身不生成主程序 Renderer，也不代表已完成手机或 Chrome 实机验证。
