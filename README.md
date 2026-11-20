# 这是一个助手 · 浏览器扩展（CK Browse）

> **[从 Chrome Web Store 安装扩展](https://chromewebstore.google.com/detail/mcjemookipgeonbaicbjomlfhkmbnfef)（推荐）**

这是 [「这是一个助手」桌面应用](https://github.com/someone97421/CK-PI-Desktop) 的配套 Chromium 扩展，也是 Browse 的个人 fork。它把桌面应用的聊天界面放进浏览器侧栏，让助手操作浏览器，并把标签页、选中文字和网页元素直接引用到聊天输入框。

- [Chrome Web Store 发布页](https://chromewebstore.google.com/detail/mcjemookipgeonbaicbjomlfhkmbnfef)
- [桌面主程序](https://github.com/someone97421/CK-PI-Desktop)
- [GitHub 手动安装包](https://github.com/someone97421/ck-pi-desktop-browse/releases)
- [本扩展源码](https://github.com/someone97421/ck-pi-desktop-browse)

## 可以做什么

| 功能 | 使用方式 |
| --- | --- |
| 浏览器侧栏聊天 | 点击扩展图标打开侧栏，连接桌面应用的局域网远程控制插件，使用原有项目、会话、模型及工具界面 |
| 标签页引用 | 在聊天输入框输入 `@` 选择浏览器标签页，将页面信息作为引用加入消息 |
| 选文引用 | 选中网页文字，通过页面上的引用入口加入当前侧栏会话 |
| DOM 元素引用 | 从聊天输入工具栏拖动准星到网页元素上，松开后把元素引用加入输入框；拖动时显示目标轮廓 |
| 文件预览与下载 | 点击聊天中的文件链接，在菜单顶部选择「预览」或「下载」；完整文件由桌面主机读取 |
| 助手操作浏览器 | 侧栏自动连接并配对本地 Relay，通过主程序内置 MCP 读取页面、截图、点击、填写、管理标签页等 |

DOM 准星入口只显示在 Chrome 扩展侧栏中；扩展设置可以关闭元素拖取。网页元素在拖动期间高亮，确认引用后显示加入输入框的反馈。

## 安装扩展

推荐直接从 **[Chrome Web Store](https://chromewebstore.google.com/detail/mcjemookipgeonbaicbjomlfhkmbnfef)** 安装扩展，再安装并启动 [「这是一个助手」桌面应用](https://github.com/someone97421/CK-PI-Desktop)。点击浏览器工具栏中的扩展图标即可打开侧栏。

### 从 GitHub 手动安装

1. 从本仓库的 [Releases](https://github.com/someone97421/ck-pi-desktop-browse/releases) 下载最新的 `browse-extension-版本号.zip`。手动安装包保留固定扩展 ID，不提供 CRX。
2. 将 ZIP 解压到一个固定目录。不要直接选择 ZIP 文件，也不要在安装后移动或删除该目录。
3. 在 Chrome 或其他 Chromium 浏览器打开 `chrome://extensions`，启用「开发者模式」，点击「加载已解压的扩展程序」，选择包含 `manifest.json` 的解压目录。
4. 安装后的引导显示主程序服务可用性和浏览器调试状态，可打开侧栏、重新检测或进入设置。点击扩展图标也可打开侧栏。升级时下载新版 ZIP，解压并替换原目录内容，再在扩展管理页点击「重新加载」。

GitHub 发布包保留固定扩展身份，因此升级时应替换原目录并重新加载；不需要安装 CLI、构建 CLI、填写 MCP 配置或输入配对码。浏览器内部页面等受限页面不能注入网页引用工具。

## 连接桌面应用

1. 安装并启动包含内置 Browse 的新版 [「这是一个助手」](https://github.com/someone97421/CK-PI-Desktop)。本机浏览器连接默认启用；已有明确停用插件的用户需重新启用。
2. 点击扩展图标打开侧栏。同机默认连接 `http://127.0.0.1:7878`。第一次连接时，在侧栏输入桌面端远控设置中的用户名和密码。默认用户名为 `admin`，可在桌面端修改。登录后，Browse 会自动配对，无需手动配置 CLI 或 MCP。
3. 侧栏首次登录后，主程序创建独立的临时草稿。输入框就绪后，扩展接入当前普通网页并插入页面引用，首次发送时才保存正式会话。也可在当前侧栏会话中加入标签页、选文和 DOM 引用。

如果修改过主程序端口，在扩展设置中同步服务地址。跨机器连接须先在桌面端配置远控账号并开启局域网访问，再将扩展服务地址改为桌面主机的局域网地址。直接打开远控网页（包括 localhost）也使用同一组用户名和密码。侧栏的登录状态单独保存。

浏览器调试的自动准备与连接仅用于本机主程序。跨机侧栏保留主程序对话和已有调试连接，不会将其他电脑签发的配对信息用于本机，也不会自动覆盖已有调试地址。

侧栏显示主程序提供的原始 Renderer，布局适配和文件菜单由局域网远程控制插件负责。文件「打开」「在文件管理器中显示」等系统操作在桌面主机执行。SSH 远程工作区目前不支持完整文件预览和下载，会显示明确错误。

## 从源码构建

需要 Git、Bun（版本见 `package.json` 的 `packageManager`）和 Node.js 22.19+。构建 Rust CLI 另需支持 Rust 2024 edition 的工具链。

```bash
git clone https://github.com/someone97421/ck-pi-desktop-browse.git
cd ck-pi-desktop-browse
bun install --frozen-lockfile
bun run build
```

构建完成后，在扩展管理页加载仓库的 `dist/` 目录。

| 命令 | 用途 |
| --- | --- |
| `bun run dev` | 监听源码并重建，浏览器端需重新加载扩展 |
| `bun run typecheck` | 扩展类型检查 |
| `bun run package --unpacked` | 生成保留固定 ID 的 GitHub 手动安装包 |
| `bun run package` | 沿用原有打包规则，稳定版移除商店不接受的 `key` 字段 |
| `bun scripts/release-check.ts --versions-only` | 核对根包、CLI、manifest 和 Rust 工作区版本 |

扩展包写入 `release/browse-extension-版本号.zip`。本地一次性配对文件 `relay-pairing.json` 不会打进发布包。

## 主程序内置组件开发

桌面主程序已内置 Browse CLI、Relay 与 MCP，普通使用无需单独安装或配置。开发主程序内置组件时，可从源码构建 Rust CLI：

```bash
cd rust
cargo build --release --locked -p browse
```

Windows 可执行文件名为 `browse.exe`。旧 TypeScript CLI（`cli/`）及相关协议保留作为底层实现和行为参考。

## 发布

在本仓库 GitHub Actions 中手动运行「发布浏览器扩展」，选择包含目标源码的 `dev` 分支。流程核对版本、检查类型、构建固定 ID 的扩展 ZIP、校验包内容并生成 SHA-256，然后创建本 fork 的 GitHub Release。已有同名版本不会被覆盖；发布前应先通过 `bun scripts/version.ts set 新版本号` 更新统一版本并提交。

此流程只发布浏览器扩展，不发布桌面主程序、npm 包或 Chrome 商店条目。

## 目录结构

| 路径 | 用途 |
| --- | --- |
| `src/background/`、`src/agent-relay/` | 扩展后台、浏览器控制、引用与 Relay 协议 |
| `src/sidepanel/` | 桌面 Renderer 的侧栏容器与消息桥接 |
| `src/status/`、`src/content/` | 设置、引导、网页状态提示与元素提取 |
| `public/` | manifest、图标与静态资源 |
| `rust/crates/browse/` | 主程序内置 Rust CLI 与 MCP 代理 |
| `rust/crates/browse-{core,relay,page,capture,script}/` | 公共契约、Relay、页面工具、采集与脚本执行 |
| `cli/` | 旧 TypeScript CLI |
| `scripts/` | 编译、统一版本、打包与产物检查 |
| `test/`、`cli/test/`、`stress/` | 测试与本地压测工具 |
| `.github/workflows/` | 基础 CI 与手动扩展发布流程 |
| `docs/` | 同步记录与历史参考资料 |

## 数据与维护

配对信息、浏览器令牌和会话状态沿用既有 XDG 路径与格式，不随扩展安装包发布。个人版关闭上游自动更新、公共 npm 包更新和远程扩展下载；需要升级时使用本仓库源码或 GitHub 发布包。

开发约定见 [AGENTS.md](AGENTS.md)，同步基线与暂缓项见 [上游同步记录](docs/上游同步记录.md)，原项目资料见 [历史参考字典](docs/archive/upstream/说明.md)。本仓库只向个人远端推送，不参与上游协作；保留 [MIT 许可证](LICENSE) 与第三方版权声明。
