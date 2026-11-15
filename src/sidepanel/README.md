# 侧边栏对话前端

`chat/` 迁自个人 fork `someone97421/CK-PI-Desktop` 的 `plugins/lan-remote-control/web/`，来源提交为 `092c3158425e664ac10d6a46286d8145a63af784`。保留完整的会话、附件、审批、模型、阶段模式与子代理交互；扩展单独维护副本。

侧边栏适配集中在 `config.ts`、`context.ts`、`index.ts` 和 `style.css`。`chat/transport.js` 统一读取服务地址；设备令牌按地址隔离；`chat/app.js` 仅向顶部连接栏开放登录状态、Browse RPC 和输入框上下文插入入口。`chat/message-stream.js` 保留来源共享层的增量合并语义。

来源仓库许可证原文保存在 `public/licenses/CK-PI-Desktop-LGPL-3.0.txt`，扩展构建时复制至 `dist/licenses/`。Browse 自身及其其他依赖继续保留原有许可证。

默认 Harness 为 `http://127.0.0.1:7878`，连接唯一的 `local.lan-remote-control` 插件，与手机端共用主机密码和设备管理。侧栏设置可修改地址，以及将图标点击行为切换为直接借出/收回标签页。私网地址可用于远控聊天；Browse Relay 仍沿用自身的本机监听边界，自动配对使用 CLI 返回的 endpoint，不将其改写为私网地址。

显式保存的服务地址继续保留；若曾保存旧服务端口，可在侧栏设置中改回 `7878`，并使用现有局域网远控密码登录。默认地址和无效配置的回退地址均为 `7878`。

验证命令：

```sh
bun run typecheck
bun run build
bun test ./test/sidepanel.test.ts
bun test ./test/isolated/sidepanel-background.ts
```
