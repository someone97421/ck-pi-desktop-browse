// 构建 release/browse-extension-<version>.zip，版本统一取自 cli/package.json。
// --unpacked 与 dev 版本保留固定 ID 和构建标记；其他稳定版沿用商店包规则。
// 一次性配对文件始终排除在发布包外。
import { $ } from "bun"
import { cp, mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { applyManifestVersion } from "./version.ts"
import { parseArgs } from "node:util"

const root = path.resolve(import.meta.dir, "..")
const staging = path.join(root, "release", "staging")
const version: string = (await Bun.file(path.join(root, "cli", "package.json")).json()).version
const dev = version.includes("-dev.")
const { values } = parseArgs({ options: { unpacked: { type: "boolean", default: false } } })
const unpacked = dev || values.unpacked
const build = new Date().toISOString()
await $`bun run build`.cwd(root).env({ ...process.env, OPENCODE_BROWSER_BUILD: build })
await rm(staging, { recursive: true, force: true })
await mkdir(staging, { recursive: true })
await cp(path.join(root, "dist"), staging, { recursive: true })
const manifest = await Bun.file(path.join(staging, "manifest.json")).json()
if (!unpacked) delete manifest.key
applyManifestVersion(manifest, version)
await Bun.write(path.join(staging, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n")
await rm(path.join(staging, "build.json"), { force: true })
if (unpacked) await Bun.write(path.join(staging, "build.json"), JSON.stringify({ build }) + "\n")
const zip = path.join(root, "release", `browse-extension-${version}.zip`)
await rm(zip, { force: true })
// install writes this checkout's pairing code into public/ (and so dist/); it is private to this machine.
await rm(path.join(staging, "relay-pairing.json"), { force: true })
await $`zip -qrX ${zip} . -x "*.map" -x ".DS_Store" -x "relay-pairing.json"`.cwd(staging)
await rm(staging, { recursive: true, force: true })
console.log(zip)
