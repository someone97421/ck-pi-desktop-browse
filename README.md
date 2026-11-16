# 这是一个助手 · 浏览器扩展（CK Browse）

这是 [「这是一个助手」桌面应用](https://github.com/someone97421/CK-PI-Desktop) 的配套 Chromium 扩展，也是 Browse 的个人 fork。它把桌面应用的聊天界面放进浏览器侧栏，让助手操作浏览器，并把标签页、选中文字和网页元素直接引用到聊天输入框。

- [桌面主程序](https://github.com/someone97421/CK-PI-Desktop)
- [扩展下载](https://github.com/someone97421/ck-pi-desktop-browse/releases)
- [本扩展源码](https://github.com/someone97421/ck-pi-desktop-browse)

## 可以做什么

| 功能 | 使用方式 |
| --- | --- |
| 浏览器侧栏聊天 | 点击扩展图标打开侧栏，连接桌面应用的局域网远程控制插件，使用原有项目、会话、模型及工具界面 |
| 标签页引用 | 在聊天输入框输入 `@` 选择浏览器标签页，将页面信息作为引用加入消息 |
| 选文引用 | 选中网页文字，通过页面上的引用入口加入当前侧栏会话 |
| DOM 元素引用 | 从聊天输入工具栏拖动准星到网页元素上，松开后把元素引用加入输入框；拖动时显示目标轮廓 |
| 文件预览与下载 | 点击聊天中的文件链接，在菜单顶部选择「预览」或「下载」；完整文件由桌面主机读取 |
| 助手操作浏览器 | 配对本地 Relay 后，通过 MCP 读取页面、截图、点击、填写、管理标签页等 |

DOM 准星入口只显示在 Chrome 扩展侧栏中；扩展设置可以关闭元素拖取。网页元素在拖动期间高亮，确认引用后显示加入输入框的反馈。

## 安装扩展

1. 从本仓库 [Releases](https://github.com/someone97421/ck-pi-desktop-browse/releases) 下载 `browse-extension-版本号.zip` 并解压到固定目录。
2. 在 Chrome 打开 `chrome://extensions`，启用「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择包含 `manifest.json` 的解压目录。
4. 点击扩展图标打开侧栏。升级时将新版解压到原目录，再在扩展管理页点击重新加载。

GitHub 发布包用于手动加载，保留固定扩展身份；本仓库不自动安装商店版本，也不向 Chrome 商店发布。浏览器内部页面等受限页面不能注入网页引用工具。

## 连接桌面应用

1. 安装并启动 [「这是一个助手」](https://github.com/someone97421/CK-PI-Desktop)，启用局域网远程控制插件，设置登录密码。
2. 在扩展设置中填写主程序服务地址。同机默认是 `http://127.0.0.1:7878`，跨机器使用桌面主机的局域网地址。
3. 在侧栏登录，打开需要的会话。标签页、选文和 DOM 引用会加入当前可编辑的聊天输入框。
4. 需要助手主动操作浏览器时，继续完成下方 CLI / Relay 的安装与一次性配对，并在桌面应用中启用对应 MCP 服务。

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

## CLI / Relay 安装与配对

当前 CLI 使用 Rust 实现，旧 TypeScript CLI 保留供源码使用与行为参考。

```bash
cd rust
cargo build --release --locked -p browse
cd ..
./rust/target/release/browse install
```

Windows 可执行文件名为 `browse.exe`。按安装提示完成 MCP 客户端配置和浏览器配对，扩展继续使用本仓库的安装包或本地 `dist/`。

旧 TypeScript 安装入口为根目录的 `bun run setup`，会构建扩展与旧 CLI 并配置所选客户端；也可在 `cli/` 中执行 `bun install --frozen-lockfile`、`bun run build`。`install` 和 `install.ps1` 只处理已克隆的个人源码，不下载上游发行包。

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
| `rust/crates/browse/` | Rust CLI、MCP 代理与本机安装 |
| `rust/crates/browse-{core,relay,page,capture,script}/` | 公共契约、Relay、页面工具、采集与脚本执行 |
| `cli/` | 旧 TypeScript CLI |
| `scripts/` | 编译、统一版本、打包与产物检查 |
| `test/`、`cli/test/`、`stress/` | 测试与本地压测工具 |
| `.github/workflows/` | 基础 CI 与手动扩展发布流程 |
| `docs/` | 同步记录与历史参考资料 |

## 数据与维护

配对信息、浏览器令牌和会话状态沿用既有 XDG 路径与格式，不随扩展安装包发布。个人版关闭上游自动更新、公共 npm 包更新和远程扩展下载；需要升级时使用本仓库源码或 GitHub 发布包。

开发约定见 [AGENTS.md](AGENTS.md)，同步基线与暂缓项见 [上游同步记录](docs/上游同步记录.md)，原项目资料见 [历史参考字典](docs/archive/upstream/说明.md)。本仓库只向个人远端推送，不参与上游协作；保留 [MIT 许可证](LICENSE) 与第三方版权声明。
