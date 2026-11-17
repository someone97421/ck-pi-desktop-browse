# 侧边栏与原版 Renderer

侧栏只加载 Harness 提供的桌面 Renderer iframe。DOM 抓手通过 LAN 插件的 `adapter/browser-grip.js` 集成到 Chrome 侧栏聊天输入框底部的原工具栏，位于加号按钮之后，复用原有按钮样式；按钮、提示和动画均由该适配器维护，仅 Chrome 侧栏显示。Browse 状态、当前标签页操作入口仍由原版 Renderer 的 Composer 工具栏呈现，扩展后台继续维护 Relay 连接、自动 ensure、自动配对、当前 tab 状态以及父子消息转发。

默认主程序服务地址为 `http://127.0.0.1:7878`，可在独立的 `settings.html` 设置页中修改。地址保存到 `chrome.storage.local` 的 `chromeSidebarServerOrigin`，与 `src/sidepanel/config.ts` 共用。安装引导显示主程序服务可用性和浏览器调试状态，并提供打开侧栏、重新检测和设置入口；Relay 连接与配对由主程序和扩展在后台处理。

自动准备调试服务与配对仅在主程序服务地址为回环地址时执行。本机侧栏遇到旧远程 Relay 配置时，先通过主程序准备本机服务，再通过后台共用连接任务切换；多窗口不并发覆盖配对信息。主程序服务位于其他电脑时，保留对话与已有调试连接，不自动替换调试地址。

iframe 地址为 `/?webRemote=true&parentOrigin=chrome-extension://<扩展ID>`。本机地址（`localhost`、`127.0.0.0/8`、`[::1]`）由 iframe 请求扩展会话，扩展在真实 `chrome-extension://` 上下文中向已配置的 API origin 发送 `POST /api/extension-session`，使用 `Content-Type: application/json` 和空对象请求体。服务端须核对真实允许的扩展 Origin 和 loopback socket；返回 `{ok:true,result:{token,deviceId,deviceName,expiresAt}}`。扩展只提取 `result.token` 传回 iframe，令牌仅在内存中流转，不写 storage；请求不带 Cookie、禁止重定向并在 12 秒后超时。跨机地址继续在 iframe 内使用主机密码登录。IPC 与附件请求仍由 iframe 处理，双方验证 `event.source` 和精确 `event.origin`。

消息格式：

- 父 → 子：`{type:"pi-desktop:status-request"}` 查询 Harness 状态。
- 子 → 父：`{type:"pi-desktop:extension-session-request",requestId}` 请求本机免密码会话，仅接受当前 iframe 的精确 source／origin。
- 父 → 子：`{type:"pi-desktop:extension-session-response",requestId,ok:true,token}` 或 `{type:"pi-desktop:extension-session-response",requestId,ok:false,error}`，`error` 为字符串；跨机请求返回密码登录提示，不访问会话端点。
- 子 → 父：`{type:"pi-desktop:remote-status",authenticated,online,canCompose}`。
- 父 → 子：`{type:"pi-desktop:browse-status",authenticated,online,busy,borrowed,browserContext}` 推送当前 tab 操作状态。
- 子 → 父：`{type:"pi-desktop:browse-request",requestId,method}`，method 为 `toggleAttach`、`insertCurrent` 或 `handoff`。
- 父 → 子：`{type:"pi-desktop:browse-response",requestId,ok,result}` 或 `{type:"pi-desktop:browse-response",requestId,ok:false,error}`。`insertCurrent` 确认 chip 已插入后返回 `inserted:true` 和目标 `clientId`。
- 父子之间仍使用既有 `pi-desktop:request/response` 处理 Harness 内部 RPC，例如 ensure Relay、生成配对码和插入 Composer 草稿。
- 子 → 父：`{type:"pi-desktop:element-picker",action:"start"|"end",sessionId,cancel?}` 发送工具栏抓手的拖动起止；`sessionId` 为 1–80 个小写字母、数字或连字符，`end` 只匹配当前会话，`cancel:true` 立即取消，否则保留后台既有的 drop／dragend 竞态处理。
- 父 → 子：`{type:"pi-desktop:element-picker-result",sessionId,ok,error?}` 返回启动错误或后台确认的投递结果；未匹配的旧结果不转发。此消息沿用精确 iframe source／origin 校验。

Browse 操作收到请求后会先自动 ensure 或配对 Relay，再执行后台 tab/handoff 操作。离线时先 ensure 并重连，等待 `connected` 或 `unpaired/untrusted`；待配对时自动获取一次性配对码并交由后台连接，并发操作共用同一次配对任务。配对码不显示在侧栏，无需手动配对。借出/收回当前页与 `@当前页` 位于原版 Composer 工具栏，失败会返回连接错误。

## 浏览器引用

扩展名称为“这是一个助手 · 浏览器”，设置、引导和通知使用中文及主程序图标。构建后在 Chrome 扩展管理页重新加载扩展，再打开侧栏；本机由主程序自动签发会话，跨机配置主程序服务地址并使用主机密码登录。同时需要包含扩展会话端点与浏览器引用 IPC 的新版主程序。

首次打开侧栏时，新版主程序创建独立的临时草稿；输入框就绪后，扩展自动接入当前普通网页进行调试，并把页面 chip 放入该草稿。首次发送才保存正式会话。自动初始化只在本次侧栏页面启动时执行，之后切换页面或短暂重连不会另建对话，也不会覆盖用户已经切换到的会话。Chrome 内部页面等受限地址不自动调试。

侧栏开启且在线时，桌面和侧栏 Composer 输入 `@` 均可搜索所有已打开标签页的标题或 URL，插入页面 chip；不需要先借出标签页。页面、选文、DOM 三类 chip 使用不同图标，悬停可查看完整引用。

新版 Rust Relay 的标签列表直接返回已连接浏览器的现有页面，首次读取或操作时自动接入原标签页，无需再点击借出。右键发送、选文和元素引用也会先确认接入，再插入 chip；接入失败会明确提示，不发送无法读取的引用。现有用户标签页沿用归还语义，工具关闭只解除接入，不关闭页面。扩展与 Rust Relay 需要同时更新并重新加载／启动；旧 Relay 仍保留原有的借出限制。

网页右键菜单“发送给Agent”根据选区插入页面或选文 chip。DOM 捕捉从 Chrome 侧栏聊天输入框底部工具栏的小手按钮启动：按住按钮拖进网页，滑动时显示元素边界，松手将当前元素插入 DOM chip。Escape、在网页外松手、窗口失焦、切换或导航标签页、关闭或断开侧栏都会取消并清理高亮；取消不生成 chip。设置页“网页元素拾取”仅保留独立启停，旧 `showweb_modifiers` 值忽略且不重写。提取继续保留 ShowWeb 的角色、名称、CSS／开放 Shadow DOM 定位、文本、属性、上下文及 HTML 摘要。

工具栏适配器通过原生 `draggable` 跨 document 拖动，设置 `application/x-browse-element-<sessionId>` 专用标记，网页只接收本次会话的标记，普通网页拖动不受影响。后台注入所有可访问 frame，各 frame 使用自己的视口坐标拾取，不换算侧栏坐标；整个拖动只认领一次 drop，并抑制网页默认投放。接入与 Renderer 的 `inserted:true`、目标 `clientId` 回执都确认后，扩展才向 iframe 转发成功结果，由工具栏适配器显示反馈及尊重“减少动态效果”偏好的轻量动画。扩展侧栏外层只负责消息，不生成抓手、提示或动画 DOM；受限页面或脚本注入失败的错误同样交给适配器显示。

页面发送、选文和 DOM 捕捉默认写入接收侧栏的当前对话，在其最近草稿光标或选区插入；桌面输入框是否聚焦不影响该目标。工具栏“当前页”也沿用此目标。切换草稿、连接断开或未收到确认时明确失败。发送优先通过来源窗口的在线侧栏转发，没有时可使用其他窗口唯一的在线侧栏。Chrome 受保护页面和关闭的 Shadow DOM 不支持完整拾取。

连接恢复保持当前 Renderer 与草稿：WebSocket 心跳同时续期标签列表，重连后立即重注册输入框；本机扩展会话失效时重新申请内存令牌，不刷新页面。桥接等待令牌 15 秒，覆盖扩展请求的 12 秒超时，同一次并发申请共用请求。若主程序尚未启动导致 iframe 首次加载失败，侧栏定期检查健康端点，主程序恢复后重新加载尚未建立连接的页面。

验证命令：

```sh
bun run typecheck
bun run build
bun test ./test/sidepanel.test.ts ./test/sidepanel-session.test.ts ./test/browser-references.test.ts ./test/element-picker-state.test.ts
bun test ./test/isolated/sidepanel-frame.ts
bun test ./test/isolated/sidepanel-background.ts
```

扩展构建本身不生成主程序 Renderer，也不代表已完成手机或 Chrome 实机验证。
