# 隐私表单与权限理由

对应版本为 0.0.21。本文用于 Chrome Web Store 开发者控制台 Privacy practices。权限清单以 `public/manifest.json` 和 `store/permissions.json` 为依据。

## 单一用途说明

```text
作为“这是一个助手”桌面应用的浏览器连接器，将当前浏览器接入用户发起的助手任务：在侧栏对话，引用标签页、选文及网页元素，并通过 Chrome 调试接口读取和操作任务相关页面。标签分组、通知和连接恢复均服务于这一浏览器助手工作流。
```

## 逐项权限理由

每行“可填写理由”可粘贴到控制台对应字段。不要把网页调试权限解释为只读权限。

| 权限 | 可填写理由 | 代码依据 |
| --- | --- | --- |
| `debugger` | 通过 Chrome DevTools Protocol 将任务相关标签页接入用户配置的桌面助手，提供读取页面、截图、点击、输入和页面调试；同时接收页面状态事件。侧栏初始化会自动接入当前支持的页面，后续任务也可接入其他标签页。 | `src/background/debugger-hub.ts`、`src/background/agent-relay/commands.ts`、`src/background/agent-relay.ts` |
| `tabs` | 读取标签页标题、地址和标识，展示 @ 标签页引用列表、定位当前页，并按助手任务创建、切换和关闭标签页；已连接侧栏会向桌面主程序提供标签页元数据。 | `src/background/browser-references.ts`、`src/background/agent-relay/commands.ts` |
| `tabGroups` | 对助手使用的标签页进行分组、命名、展开和折叠，区分任务标签并在任务结束或标签关闭后清理分组状态。 | `src/background/agent-relay/groups.ts`、`src/background/agent-relay/grouping.ts` |
| `storage` | 在 Chrome 本地保存用户的主程序地址、浏览器标识、调试服务配对令牌、分组及引用设置；会话存储用于短期日志和运行状态。 | `src/background/agent-relay/wire.ts`、`src/sidepanel/config.ts`、`src/background/browser-references.ts` |
| `alarms` | 在 Manifest V3 后台服务间歇休眠的情况下定期恢复调试服务连接，并按用户配置清理助手创建的闲置标签页。 | `src/background/agent-relay.ts`、`src/background/tab-cleanup.ts` |
| `webNavigation` | 跟踪任务页面新打开的目标标签页及其来源，让新窗口／新标签继续归属同一浏览器任务。 | `src/background/agent-relay/popups.ts` |
| `scripting` | 在页面中注入扩展包内的固定引用拾取和任务状态脚本，支持用户选文、DOM 元素引用和人工接手提示；不是下载远程脚本后注入。 | `src/background/browser-references.ts`、`src/background/page-scripts.ts` |
| `notifications` | 通知用户浏览器任务需要人工接手、连接或引用操作需要处理；不用于广告。 | `src/background/handoff-notice.ts`、`src/background/toolbar-notice.ts`、`src/background/browser-references.ts` |
| `sidePanel` | 在浏览器侧栏显示与桌面主程序连接的聊天界面和浏览器引用工具。 | `src/background/index.ts`、`src/status/desktop.ts`、`src/sidepanel/index.ts` |
| `contextMenus` | 提供网页选文的“发送给助手”右键入口，将所选内容加入侧栏输入框。 | `src/background/browser-references.ts` |

### 主机权限 `<all_urls>` 理由

```text
用户可在任意普通网页上发起浏览器助手任务，因此需要覆盖用户选择的网站和子框架，以显示网页引用工具、读取用户选取的文字或元素，并操作任务相关页面。后台还需要连接用户配置的本机或网络桌面主程序。扩展不会把网站访问范围限制在开发者固定域名；浏览器内部页面和 Chrome Web Store 等受保护页面仍受 Chrome 限制。file:// 的访问另受用户设置控制。
```

`<all_urls>` content script 不是“每页全文自动上传”：包内拾取脚本会在允许的页面中加载；侧栏连接时会同步标签页元数据，完整内容的读取和传送取决于引用或调试操作。两者必须一起披露，不能用后一句否认前一种元数据处理。

## 数据类别填写建议

下表是对当前行为的披露建议，不等于对所有用户页面内容的穷尽。最终上传版与公开隐私政策必须一致。仅把数据发给用户自己的主程序也不代表“没有处理／传输数据”。

| 控制台类别 | 建议 | 依据及边界 |
| --- | --- | --- |
| Web history／网络历史记录 | 勾选 | 已打开标签页的 URL 和标题会同步给已连接侧栏／主程序；没有读取完整 Chrome History 数据库，但仍处理浏览活动信息。 |
| Website content／网站内容 | 勾选 | 页面文字、选文、DOM、属性、截图和调试结果。 |
| User activity／用户活动 | 勾选 | 引用选择、标签页操作、页面交互，以及用户启用示范记录等任务产生的活动数据。 |
| Authentication information／身份验证信息 | 建议勾选 | 调试服务配对码／令牌、主程序登录会话；页面调试及 Cookie 工具也可能处理网站会话信息。不能因没有独立 cookies 权限就断言不会接触。 |
| Personally identifiable information／个人身份信息 | 建议勾选 | 浏览器标识、用户配置的浏览器显示名，以及任务网页或用户输入中出现的姓名、邮箱等。浏览器 UUID 不是实名，但仍是关联标识。 |
| Personal communications／个人通信 | 发布前确认；若不限制相应任务，应勾选 | 扩展不专门批量读取邮箱，但用户可以引用邮箱、聊天页或让助手处理这些页面，内容可能传至主程序及模型。 |
| Financial and payment information／财务与付款信息 | 发布前确认；若不限制相应任务，应勾选 | 不是扩展的计费功能；任务页面可能包含账单或支付信息，调试通道没有在扩展端统一过滤这些内容。 |
| Health information／健康信息 | 发布前确认；若不限制相应任务，应勾选 | 用户可能在医疗页面执行任务；当前并无覆盖全部引用、截图和调试结果的健康信息过滤。 |
| Location／位置 | 发布前确认；若会处理位置内容，应勾选 | 扩展没有单独调用定位 API 的声明，但页面内容、地图或 URL 可能含具体位置。不要只根据 manifest 是否有定位权限填写。 |

针对后三类，不要为了减少勾选而作出代码没有实现的“不处理”承诺。若计划缩小发行版支持范围，需要实际实现并同步调整文案；本次没有做这些改动。

## 数据用途与三项认证

当前材料承诺的用途：实现用户发起的浏览器助手工作流、提供主程序连接、网页引用、任务操作及必要故障排查。不用于广告画像、数据售卖或信用评估。

控制台中“不向第三方出售／转让数据”“不用于与单一用途无关的目的”“不用于信用评分／贷款用途”等认证，必须在逐项读完当时原文并确认实际做法后填写。用户所选模型提供商可能接收任务数据，是应披露的处理链路；不能把这一点隐去后再认证。隐私政策中的 Limited Use 声明也不代表当前所有实现问题已经解决。

## 远程代码字段

建议按控制台字段定义如实申报外部界面及调试执行，准备说明如下；不要简单填“完全没有远程代码”。

```text
扩展后台、连接与来源校验、消息处理、引用脚本和浏览器 API 调用位于提交的扩展包中。侧栏通过跨源 iframe 显示用户配置的“这是一个助手”桌面主程序页面，默认地址为 http://127.0.0.1:7878。该页面通过结构化 postMessage 与扩展交互，不在扩展 Service Worker 中作为下载脚本执行。

主程序通过经配对的浏览器调试连接发送操作请求。页面脚本执行通过 Chrome Debugger API 的 CDP 接口进入被调试页面；扩展的 chrome.scripting 注入仅使用包内固定文件。CDP 不等同于只读，可能用于页面读取、截图、输入和交互。

完整功能、外部组件版本、安装方式和审核复现步骤见审核说明。我们依据 Manifest V3 对符合用途的 Debugger API 及隔离上下文的规定说明该架构，而不是主张任何远程命令或 iframe 均自动豁免审核。
```

## 当前必须单列的实现差距

1. **传输安全**：主程序支持 HTTP/HTTPS 地址，调试 Relay 当前使用 `ws://`；默认回环流量与跨机网络流量必须区分。当前不能宣称“所有传输都加密”。官方 Secure Handling 要求通过现代加密安全传送用户数据；跨机器明文路径需要在提审前作实现决策，不能仅在文字中免责。
2. **显著披露与同意**：商店描述和独立隐私政策不能自动代替产品内披露及必要的肯定同意。当前安装引导是否足够说明“侧栏启动自动调试、同步标签元数据、模型转发”，需对最终 UI 核实；本材料没有修改 UI 或新增同意机制。
3. **侧栏连接**：首次获得商店扩展 ID 后，核对实际扩展能否显示桌面主程序侧栏，并使用桌面远控账号密码登录。调试服务自动配对也须在兼容主程序中验证。
4. **审核可复现**：提交公开可下载的兼容主程序版本，必要时提供受限的审核专用配置／演示视频。不要提供私人 API 密钥、真实账号 Cookie 或个人模型凭据。

## 依据

源码定位见上表；模型转发由配套主程序负责。官方页面及检查状态见 `README.md` 的来源表。
