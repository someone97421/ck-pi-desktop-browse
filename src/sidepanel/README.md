# 侧边栏与原版 Renderer

侧栏只加载 Harness 提供的桌面 Renderer iframe；不再在聊天面板上常驻 Browse 连接栏。Browse 状态、当前标签页操作入口由原版 Renderer 的 Composer 工具栏呈现，扩展后台继续维护 Relay 连接、自动 ensure、自动配对、当前 tab 状态以及父子消息转发。

默认 Harness 地址为 `http://127.0.0.1:7878`，在独立的 `settings.html` 设置页中修改。地址保存到 `chrome.storage.local` 的 `chromeSidebarServerOrigin`，与 `src/sidepanel/config.ts` 共用；Relay 地址、配对码和浏览器配置继续在设置页的 Advanced 区域维护。

iframe 地址为 `/?webRemote=true&parentOrigin=chrome-extension://<扩展ID>`。主机密码、设备 token、IPC 与附件请求全部在 iframe 内处理。扩展只收到认证/在线状态和已请求操作的结果，不接收 Bearer。双方都验证 `event.source` 和精确 `event.origin`。

消息格式：

- 父 → 子：`{type:"pi-desktop:status-request"}` 查询 Harness 状态。
- 子 → 父：`{type:"pi-desktop:remote-status",authenticated,online,canCompose}`。
- 父 → 子：`{type:"pi-desktop:browse-status",authenticated,online,busy,borrowed,browserContext}` 推送当前 tab 操作状态。
- 子 → 父：`{type:"pi-desktop:browse-request",requestId,method}`，method 为 `toggleAttach`、`insertCurrent` 或 `handoff`。
- 父 → 子：`{type:"pi-desktop:browse-response",requestId,ok,result}` 或 `{type:"pi-desktop:browse-response",requestId,ok:false,error}`。`insertCurrent` 的 result 带 `browserContext`，由 Renderer 写入原版 Composer。
- 父子之间仍使用既有 `pi-desktop:request/response` 处理 Harness 内部 RPC，例如 ensure Relay、生成配对码和插入 Composer 草稿。

Browse 操作收到请求后会先自动 ensure 或配对 Relay，再执行后台 tab/handoff 操作。借出/收回当前页与 `@当前页` 位于原版 Composer 工具栏，Relay 未配对时会返回连接错误而不是静默无响应。

验证命令：

```sh
bun run typecheck
bun run build
bun test ./test/sidepanel.test.ts
```

扩展构建本身不生成主程序 Renderer，也不代表已完成手机或 Chrome 实机验证。
