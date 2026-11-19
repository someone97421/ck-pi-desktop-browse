# Chrome Web Store 商店文案

对应扩展版本 `0.0.21`。以下为待填写的商店材料。

## 基础字段

| 字段 | 建议填写 |
| --- | --- |
| 商品名称 | 这是一个助手 · 浏览器 |
| 默认商店语言 | 简体中文 |
| 建议类别 | 工作效率（以开发者控制台当时提供的类别为准） |
| 开发者显示名 | someone97421（发布前确认与开发者账户一致） |
| 扩展版本 | 0.0.21，以最终上传 ZIP 的 manifest 为准 |
| 网站地址 | `https://github.com/someone97421/ck-pi-desktop-browse` |
| 支持地址 | `https://github.com/someone97421/ck-pi-desktop-browse/issues` |
| 桌面程序下载 | `https://github.com/someone97421/CK-PI-Desktop/releases` |
| 隐私政策地址 | 发布 `store/privacy-policy.md` 后填写其公开 HTTPS 页面；发布前不要填不存在的地址 |
| 联系邮箱 | 在控制台填写开发者本人可收信的邮箱，本材料不代填私人信息 |

## 中文简短说明

下面这行可直接作为简短说明，也满足 manifest description 的 132 字符上限；本次未修改 manifest。

```text
连接“这是一个助手”桌面应用，在浏览器侧栏对话、引用网页，并让助手读取和操作页面。
```

## 中文详细说明

以下代码块内容可粘贴到商店详细说明。

```text
把正在浏览的网页接入你的助手工作流。

“这是一个助手 · 浏览器”是“这是一个助手”桌面应用的配套扩展。你可以在 Chrome 侧栏中对话，把标签页、选中文字和网页元素引用到输入框，并通过桌面助手读取和操作浏览器页面。

使用前需要安装并运行“这是一个助手”桌面应用。本扩展不能脱离桌面应用独立提供 AI 对话；模型服务和可能产生的 API 费用由你在桌面应用中配置。

主要功能

• 侧栏对话：在网页旁边使用桌面应用的聊天界面。
• 当前页自动接入：本机连接就绪后，每次侧栏页面初始化会创建新的临时草稿，自动接入当前可支持网页的调试，并将当前页引用放入输入框；不会自动发送聊天消息。
• 标签页引用：在输入框输入 @，从标签页列表选择页面。
• 选文引用：选中文字后，通过引用入口或右键菜单加入当前输入框。
• 网页元素引用：从侧栏输入工具栏拖动准星到网页元素，把元素信息作为引用加入输入框。
• 浏览器辅助操作：根据你在桌面应用中发起的任务，助手可读取页面、截图、点击、填写和管理标签页；需要人工处理时可交回给你。

开始使用

1. 从本项目 GitHub Releases 安装并启动“这是一个助手”桌面应用，保持浏览器连接插件启用。
2. 安装扩展后点击工具栏图标，打开侧栏，首次连接使用桌面远控的账号与密码登录。
3. 本机默认连接 http://127.0.0.1:7878。若更改过主程序端口，请在扩展连接设置中同步修改。
4. 连接就绪后，在新临时草稿中查看当前页引用，输入任务并主动发送。

权限与数据说明

扩展使用 Chrome 的调试权限提供网页读取、截图和交互。Chrome 可能显示正在调试浏览器的提示。侧栏连接后，标签页标题和地址会被提供给你配置的桌面主程序，用于标签页引用与浏览器任务；选文、元素、截图和其他页面数据会随对应引用或调试操作传送。任务需要时可以接入其他标签页，并非只处理首次自动引用的页面。

打开侧栏不是单纯展示界面：本机连接就绪后会自动接入当前页。网页内容可能包含你已登录网站中的个人信息；发送引用或让助手操作页面前，请确认页面适合交给当前任务和模型服务处理。

扩展默认与本机服务通信，不内置广告分析服务。数据可继续由桌面主程序按你的任务和模型配置发送到模型服务；如果配置了跨机器连接，相关数据也会经过你指定的网络主机。具体范围和保留方式见隐私政策及所选模型服务说明。

停止使用

可以在侧栏浏览器工具中停止当前页调试。要停止所有扩展活动，请在 Chrome 扩展管理页停用或卸载本扩展。仅关闭侧栏不保证已连接的调试通道全部断开。

支持与限制

• 需要 Chrome 125 或以上版本，以及兼容的“这是一个助手”桌面应用。
• chrome://、Chrome 商店等受浏览器保护的页面不能像普通网页一样操作。
• file:// 页面的访问还取决于 Chrome 中“允许访问文件网址”的设置。
• 浏览器调试自动连接面向同机使用。跨机器侧栏仍需配置主机地址及密码，不等于跨机调试自动可用。
• 这不是 Google 官方产品。

源码与支持：GitHub 仓库 someone97421/ck-pi-desktop-browse。
```

## 英文商店翻译备稿

仅用于需要新增英文商店翻译时；它不代表扩展 UI 已完成英文适配。

名称：`This Is an Agent · Browser`

简短说明：

```text
Connect the desktop app to chat in Chrome's side panel, reference web content, and let your assistant work with pages.
```

详细说明：

```text
Bring your current browser into your assistant workflow.

This extension is a companion to the “这是一个助手 / this-is-a-agent” desktop application. The desktop application must be installed and running. AI providers are configured in the desktop app; this extension does not provide a standalone AI service or an included API subscription.

Open the side panel and sign in with the desktop app’s remote access username and password. The app creates a new temporary draft. Once the local debugging connection is ready, the extension attaches to the current supported page. A page reference appears when the draft composer and tab list are ready. Opening the sidebar does not automatically send a chat message.

Reference tabs with @, add selected text, or drag the element picker from the composer toolbar onto a page element. For tasks you initiate, the assistant can read pages, take screenshots, click, fill fields, and manage tabs through Chrome's debugger interface.

When connected, tab titles and URLs are shared with your configured desktop application. Referenced content and data returned by browser actions may also be passed to the AI provider configured there. The extension is not limited to the initial page: assistant tasks can connect to other tabs. Closing the side panel does not necessarily disconnect every debugger session; disable or uninstall the extension to stop all extension activity.

The default desktop endpoint is http://127.0.0.1:7878. A separately configured network host changes where connection data is sent. See the privacy policy for data handling and transport limitations.

Requires Chrome 125 or later and a compatible desktop application. Browser-protected pages cannot be operated like ordinary websites. This product is not affiliated with Google.

Source and support: someone97421/ck-pi-desktop-browse on GitHub.
```
