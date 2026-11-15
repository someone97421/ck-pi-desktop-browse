// 构建本地 CLI 和仓库扩展，并附带第三方许可证。
import { $ } from "bun"
import { cp, readdir, readFile, rm } from "node:fs/promises"
import path from "node:path"
import { bundleCli } from "./bundle.ts"

const here = import.meta.dir
const checkout = path.resolve(here, "..")
const pkg = await Bun.file(path.join(here, "package.json")).json()

// 可选的浏览器商店标识；源码构建默认加载本地扩展。
const storeId = process.env.OPENCODE_BROWSER_STORE_ID?.trim()
if (storeId && !/^[a-p]{32}$/.test(storeId)) throw new Error(`OPENCODE_BROWSER_STORE_ID is not a Chrome Web Store item ID: ${JSON.stringify(storeId)}`)
const store = storeId ? { id: storeId } : {}

const build = new Date().toISOString()
await $`bun run build`.cwd(checkout).env({ ...process.env, OPENCODE_BROWSER_BUILD: build }).quiet()
await rm(path.join(here, "dist"), { recursive: true, force: true })
// Earlier builds copied the extension into the package.
await rm(path.join(here, "extension"), { recursive: true, force: true })

await bundleCli({ outdir: path.join(here, "dist"), version: pkg.version, buildId: build, store })

// install compares this with the build a connected unpacked extension reports, to skip a reload that changes nothing.
await Bun.write(path.join(checkout, "dist", "build.json"), JSON.stringify({ build }) + "\n")
// MIT asks for the license with every copy; npm ships LICENSE from the package folder.
await cp(path.join(checkout, "LICENSE"), path.join(here, "LICENSE"))
// The same for every package bundled into dist/, found by the source paths the bundler leaves in its comments.
await Bun.write(path.join(here, "dist", "THIRD_PARTY_NOTICES.txt"), await thirdPartyNotices(path.join(here, "dist")))
const notes = [store.id && `store ${store.id}`].filter(Boolean)
console.log(`built dist/cli.mjs and ../dist (${[pkg.version, ...notes].join(", ")})`)

async function thirdPartyNotices(dist: string) {
  const packages = new Set<string>()
  for (const name of await readdir(dist)) {
    if (!name.endsWith(".mjs")) continue
    for (const [, dir] of (await readFile(path.join(dist, name), "utf8")).matchAll(/^\/\/ ((?:[^\n]*\/)?node_modules\/(?:@[^/\n]+\/)?[^/\n]+)\//gm))
      packages.add(path.resolve(here, dir!))
  }
  const sections: string[] = []
  for (const dir of [...packages].sort()) {
    const { name, version } = await Bun.file(path.join(dir, "package.json")).json()
    const license = (await readdir(dir)).find((file) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(file))
    if (!license) throw new Error(`${name} is bundled into dist/ but has no license file to ship with it`)
    sections.push(`${name}@${version}\n\n${(await readFile(path.join(dir, license), "utf8")).trim()}`)
  }
  return `Third-party software bundled into this package:\n\n${sections.join(`\n\n${"-".repeat(80)}\n\n`)}\n`
}
