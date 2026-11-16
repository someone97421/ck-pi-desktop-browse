# 侧边栏与原版 Renderer

侧栏只加载 Harness 提供的桌面 Renderer iframe。DOM 抓手通过 LAN 插件的 `adapter/browser-grip.js` 集成到 Chrome 侧栏聊天输入框底部的原工具栏，位于加号按钮之后，复用原有按钮样式；按钮、提示和动画均由该适配器维护，仅 Chrome 侧栏显示。Browse 状态、当前标签页操作入口仍由原版 Renderer 的 Composer 工具栏呈现，扩展后台继续维护 Relay 连接、自动 ensure、自动配对、当前 tab 状态以及父子消息转发。

默认 Harness 地址为 `http://127.0.0.1:7878`，在独立的 `settings.html` 设置页中修改。地址保存到 `chrome.storage.local` 的 `chromeSidebarServerOrigin`，与 `src/sidepanel/config.ts` 共用；Relay 地址、配对码和浏览器配置继续在设置页的“高级设置”区域维护。

iframe 地址为 `/?webRemote=true&parentOrigin=chrome-extension://<扩展ID>`。主机密码、设备 token、IPC 与附件请求全部在 iframe 内处理。扩展只收到认证/在线状态和已请求操作的结果，不接收 Bearer。双方都验证 `event.source` 和精确 `event.origin`。

消息格式：

- 父 → 子：`{type:"pi-desktop:status-request"}` 查询 Harness 状态。
- 子 → 父：`{type:"pi-desktop:remote-status",authenticated,online,canCompose}`。
- 父 → 子：`{type:"pi-desktop:browse-status",authenticated,online,busy,borrowed,browserContext}` 推送当前 tab 操作状态。
- 子 → 父：`{type:"pi-desktop:browse-request",requestId,method}`，method 为 `toggleAttach`、`insertCurrent` 或 `handoff`。
- 父 → 子：`{type:"pi-desktop:browse-response",requestId,ok,result}` 或 `{type:"pi-desktop:browse-response",requestId,ok:false,error}`。`insertCurrent` 确认 chip 已插入后返回 `inserted:true` 和目标 `clientId`。
- 父子之间仍使用既有 `pi-desktop:request/response` 处理 Harness 内部 RPC，例如 ensure Relay、生成配对码和插入 Composer 草稿。
- 子 → 父：`{type:"pi-desktop:element-picker",action:"start"|"end",sessionId,cancel?}` 发送工具栏抓手的拖动起止；`sessionId` 为 1–80 个小写字母、数字或连字符，`end` 只匹配当前会话，`cancel:true` 立即取消，否则保留后台既有的 drop／dragend 竞态处理。
- 父 → 子：`{type:"pi-desktop:element-picker-result",sessionId,ok,error?}` 返回启动错误或后台确认的投递结果；未匹配的旧结果不转发。此消息沿用精确 iframe source／origin 校验。

Browse 操作收到请求后会先自动 ensure 或配对 Relay，再执行后台 tab/handoff 操作。借出/收回当前页与 `@当前页` 位于原版 Composer 工具栏，Relay 未配对时会返回连接错误而不是静默无响应。

## 浏览器引用

扩展名称为“这是一个助手 · 浏览器”，设置、引导和通知使用中文及主程序图标。构建后在 Chrome 扩展管理页重新加载扩展，再打开侧栏并登录；同时需要包含浏览器引用 IPC 的新版主程序。

侧栏开启且在线时，桌面和侧栏 Composer 输入 `@` 均可搜索所有已打开标签页的标题或 URL，插入页面 chip；不需要先借出标签页。页面、选文、DOM 三类 chip 使用不同图标，悬停可查看完整引用。

新版 Rust Relay 的标签列表直接返回已连接浏览器的现有页面，首次读取或操作时自动接入原标签页，无需再点击借出。右键发送、选文和元素引用也会先确认接入，再插入 chip；接入失败会明确提示，不发送无法读取的引用。现有用户标签页沿用归还语义，工具关闭只解除接入，不关闭页面。扩展与 Rust Relay 需要同时更新并重新加载／启动；旧 Relay 仍保留原有的借出限制。

网页右键菜单“发送给Agent”根据选区插入页面或选文 chip。DOM 捕捉从 Chrome 侧栏聊天输入框底部工具栏的小手按钮启动：按住按钮拖进网页，滑动时显示元素边界，松手将当前元素插入 DOM chip。Escape、在网页外松手、窗口失焦、切换或导航标签页、关闭或断开侧栏都会取消并清理高亮；取消不生成 chip。设置页“网页元素拾取”仅保留独立启停，旧 `showweb_modifiers` 值忽略且不重写。提取继续保留 ShowWeb 的角色、名称、CSS／开放 Shadow DOM 定位、文本、属性、上下文及 HTML 摘要。

工具栏适配器通过原生 `draggable` 跨 document 拖动，设置 `application/x-browse-element-<sessionId>` 专用标记，网页只接收本次会话的标记，普通网页拖动不受影响。后台注入所有可访问 frame，各 frame 使用自己的视口坐标拾取，不换算侧栏坐标；整个拖动只认领一次 drop，并抑制网页默认投放。接入与 Renderer 的 `inserted:true`、目标 `clientId` 回执都确认后，扩展才向 iframe 转发成功结果，由工具栏适配器显示反馈及尊重“减少动态效果”偏好的轻量动画。扩展侧栏外层只负责消息，不生成抓手、提示或动画 DOM；受限页面或脚本注入失败的错误同样交给适配器显示。

引用写入最近聚焦的 Agent 草稿光标或选区；工具栏“当前页”只写入当前侧栏。切换草稿、连接断开或未收到确认时明确失败。发送优先通过来源窗口的在线侧栏转发，没有时可使用其他窗口唯一的在线侧栏。Chrome 受保护页面和关闭的 Shadow DOM 不支持完整拾取。

验证命令：

```sh
bun run typecheck
bun run build
bun test ./test/sidepanel.test.ts ./test/browser-references.test.ts ./test/element-picker-state.test.ts
bun test ./test/isolated/sidepanel-frame.ts
bun test ./test/isolated/sidepanel-background.ts
```

扩展构建本身不生成主程序 Renderer，也不代表已完成手机或 Chrome 实机验证。
