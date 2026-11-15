# CK Browse

个人自用的 Browse 魔改版，用 Chromium 扩展与本地 CLI/Relay 连接 MCP 客户端，保留后续深度定制与增量同步上游的能力。

个人仓库：`https://github.com/someone97421/ck-pi-desktop-browse`。只向个人远端推送，不参与上游协作，不使用上游自动发布或更新渠道。开发规则见 [AGENTS.md](AGENTS.md)，同步基线及暂缓项见 [上游同步记录](docs/上游同步记录.md)，原有资料见 [历史参考字典](docs/archive/upstream/说明.md)。MIT 许可证与第三方版权声明继续保留。

## 本地安装与开发

需要 Git、Bun（版本以根目录 `package.json` 的 `packageManager` 为准）、Node.js 22.19+；构建 Rust CLI 另需支持 Rust 2024 edition 的工具链。以下命令仅供手动执行。

- 安装依赖：`bun install --frozen-lockfile`；旧 TypeScript CLI：`cd cli && bun install --frozen-lockfile`。
- 扩展开发：`bun run dev`；在浏览器扩展管理页启用开发者模式，加载仓库 `dist/`，更新后手动重新加载。
- 扩展构建：`bun run build`；本地 zip 打包：`bun run package`。
- Rust CLI 构建：`cd rust && cargo build --release --locked -p browse`，产物为 `rust/target/release/browse`（Windows 为 `browse.exe`）。
- Rust CLI 配置：在仓库根目录运行 `./rust/target/release/browse install`，按提示完成 MCP 配置与配对；扩展使用上一步的本地 `dist/`，不要用商店版本覆盖本地魔改。
- 旧 TypeScript CLI 安装与配对：`bun run setup`（安装依赖、构建扩展及旧 CLI，并配置所选客户端）；显示本地扩展目录：`node cli/dist/cli.mjs extension`。
- 类型检查：`bun run typecheck`；旧 CLI：`cd cli && bun run typecheck`。
- 测试入口：`bun run test`；Rust：`cd rust && cargo test --workspace --locked`。默认不运行测试、构建或服务，按任务授权执行。

`install` 和 `install.ps1` 仅处理已经克隆的个人源码目录，不下载上游发行包。自动更新与发布渠道已关闭；同步源码时向智能体下达“同步上游并保留本地定制”，遵循 `AGENTS.md` 的流程。

## 核心目录

| 路径 | 用途 |
| --- | --- |
| `src/background/`、`src/agent-relay/` | 扩展后台、浏览器控制与 Relay 协议 |
| `src/status/`、`src/content/` | 设置/引导界面与页面状态提示 |
| `public/` | 扩展 manifest、图标与静态资源 |
| `rust/crates/browse/` | 当前 Rust CLI、MCP 代理与本机安装 |
| `rust/crates/browse-{core,relay,page,capture,script}/` | 公共契约、Relay、页面工具、采集与 QuickJS |
| `cli/` | 旧 TypeScript CLI 与行为参考实现，仍可从源码使用 |
| `scripts/` | 本地编译、版本、打包与产物检查工具 |
| `test/`、`cli/test/`、`stress/` | 既有测试、测试夹具与本地压测工具 |
| `.github/workflows/ci.yml` | 基础类型检查与构建验证，不发布、签名或部署 |
| `docs/` | 同步记录、初始化说明及历史归档 |

## 数据与外联

配对信息、浏览器令牌、会话/标签页状态继续使用既有 XDG 路径与格式。本次初始化不迁移或删除用户数据。应用没有发现遥测 SDK 或统计上报入口；本地日志、用户主动浏览网页、依赖下载、浏览器商店及第三方 MCP 客户端资料不属于遥测，保留其正常用途。

个人版不会从上游发布服务或 `@opencode/browse` 公共包检查、下载或安装更新。包名及协议标识保留兼容性，源码与生成包均设置为私有。历史归档和离线协议测试夹具中仍可能保留上游地址，它们仅是参考数据。
