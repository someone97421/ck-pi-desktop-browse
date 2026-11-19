# Chrome Web Store 审核说明

本文件供发布者填入审核备注及测试说明，适用于扩展 0.0.21。提交审核前需补齐下列材料。

## 提交前待补信息

| 项目 | 需要填入的实际材料 |
| --- | --- |
| 上传包及商店身份 | 最终商店 ZIP 的版本、SHA-256、Chrome Web Store 分配的扩展 ID，以及实际侧栏连接验证结果 |
| 兼容桌面程序 | 无需登录即可下载的精确版本及公开安装包链接，待补 |
| 审核平台 | 提供审核员可使用且已验证的桌面程序安装包 |
| 完整模型流程 | 若需账号／模型配置，提供审核专用、可撤销且不含个人数据的使用方式，通过商店私密审核字段交付；不要写入仓库 |
| 演示视频 | 公开或仅凭链接可看的功能视频地址，可作为补充，不能代替安装和验证步骤 |
| 支持联系 | 开发者控制台联系邮箱；网页支持地址可使用本仓库 Issues |

## 可填写的中文审核备注

```text
这是“这是一个助手 / this-is-a-agent”桌面应用的配套扩展，不能脱离桌面应用独立运行。请先安装下方提供的精确版本桌面程序，再安装本次提交的扩展。

主要用途是把用户当前浏览器接入助手工作流：侧栏对话、标签页／选文／DOM 引用，以及按任务执行页面读取、截图、点击和填写。打开侧栏并连接本机主程序后，会自动创建新的临时草稿、接入当前可支持页面的调试并加入页面引用，不会自动发送模型消息。

默认主程序地址为 http://127.0.0.1:7878。首次在侧栏连接时，使用桌面远控设置中的账号和密码登录。本机浏览器调试服务由主程序与扩展在后台自动配对。

需要 debugger 权限，因为页面操作通过 Chrome Debugger API / CDP 进行。后台、来源校验、消息路由、固定内容脚本和浏览器 API 接线随扩展包提交；主程序聊天页面在跨源 iframe 中显示，经明确的结构化消息与扩展交互。调试通道具有页面读取和交互能力，不仅是只读检查。具体架构与权限用途见本次隐私字段说明。

扩展处理已打开标签页的标题和地址，并在引用或调试操作中传送相应页面内容。桌面应用可以继续把任务数据发送给用户选择的模型提供商。没有把本产品表述为“全部数据永远不离开本机”。

不使用模型也可验证当前页 chip、@ 标签页列表、选文及元素引用。完整 AI 流程使用下方专门提供的审核配置。演示视频仅用于辅助理解。

兼容桌面程序版本与下载：待补。
完整模型审核配置的取得方式：待补。
演示视频：待补。
```

## 英文审核备注备稿

```text
This is a companion extension for the “这是一个助手 / this-is-a-agent” desktop application. Please install the exact desktop build provided with this submission before reviewing the extension. It is not a standalone AI service.

After the user opens the side panel and the local connection is ready, the app creates a new temporary draft, the extension attaches debugging to the current supported page, and a page reference is added to the composer. No chat message is sent automatically. Connected side panels also provide open-tab titles and URLs to the desktop application for tab references.

Browser actions use the Chrome Debugger API / CDP. The extension package contains the background code, origin validation, message handling, bundled content scripts, and Chrome API integration. The companion desktop UI is displayed in a cross-origin iframe and communicates through structured messages. We disclose this architecture under the Manifest V3 rules for documented Debugger API use and isolated contexts; the claimed functionality remains reviewable and is described in the privacy fields.

The desktop endpoint defaults to http://127.0.0.1:7878. Sign in using the username and password configured in the desktop app’s remote access settings. The desktop app and extension pair the local browser debugging service in the background.

Page references, selected text, and element picking can be tested without sending a model request. The complete AI workflow requires the dedicated review configuration supplied privately with this submission. Task data may be sent by the desktop app to the chosen AI provider; we do not claim that all data always remains local.

Exact desktop build and download: TO BE PROVIDED.
Dedicated review configuration: TO BE PROVIDED PRIVATELY.
Optional demonstration video: TO BE PROVIDED.
```

## 不消耗模型额度的验证路径

| 步骤 | 操作 | 预期结果 |
| --- | --- | --- |
| 1 | 启动兼容桌面程序，保持内置浏览器连接启用 | 默认本机主程序服务可用 |
| 2 | 在 Chrome 打开 `https://example.com`，点击扩展图标，使用桌面远控的账号与密码登录 | 侧栏连接主程序，当前普通网页开始接入调试 |
| 3 | 等待聊天输入框与标签页列表就绪 | 显示新临时草稿，输入框出现当前页 chip，无模型消息发送 |
| 4 | 在输入框输入 `@` | 能查看当前浏览器标签页候选，并把选中的页面加入输入框 |
| 5 | 在网页选择一段文字，使用“发送给助手”右键菜单 | 选文引用出现在侧栏当前输入框 |
| 6 | 从侧栏工具栏拖动 DOM 准星到页面元素，再松开 | 拖动期间显示元素轮廓，随后输入框出现元素引用 |
| 7 | 取消拾取、切换页面，或使用停止调试入口 | 对应拾取／页面状态能结束或更新 |
| 8 | 在 Chrome 扩展管理页停用扩展 | 扩展不再继续执行后台连接和页面操作 |

注意：仅关闭侧栏不能作为“所有调试已经停止”的验证依据。`chrome://`、扩展管理页和 Chrome 商店页面不能代替普通网页作为内容操作样例。

## 完整模型流程

使用审核专用配置，在公开示例网页中发送：“读取这个页面的标题和主要内容，只回复摘要，不点击链接、不提交表单。”预期模型收到页面上下文并返回摘要；再用无真实账户、支付或个人数据的测试页演示一次明确的点击／填写任务。

发布者须在提交前实际核实这一路径及可用额度，并通过商店私密审核字段提供所需信息。本次材料准备没有运行这条模型流程，也没有创建审核账号或配置凭据。

## 审核异常排查

| 现象 | 应核对 |
| --- | --- |
| 侧栏打不开或无法连接 | 桌面程序版本、浏览器连接开关、主程序端口及该系统的本机访问限制 |
| 侧栏登录失败 | 核对扩展连接设置中的主机地址，并使用该主机的桌面远控账号和密码 |
| 登录后调试不可用 | 核对主程序浏览器连接功能、本机调试服务及侧栏连接状态 |
| 没有当前页 chip | 是否在普通 http/https 页面、是否已有其他调试器冲突、输入框是否就绪 |
| 模型操作不可用 | 审核专用模型配置、配额和主程序工具是否可用；不能仅凭连接成功判断模型流程通过 |

本文件是复现说明，未替审核人员创建账号、登录、提交或支付。
