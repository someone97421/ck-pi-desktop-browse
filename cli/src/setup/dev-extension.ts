import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { cacheRoot, devExtensionFolder, type DevExtension } from "../paths.ts"

export type Installed = { readonly version?: string; readonly file: string; readonly sha256: string; readonly build?: string; readonly installedAt: string }

export const devExtensionRecord = (root = cacheRoot()) => path.join(root, "extension.json")

export function installedDevExtension(root = cacheRoot()): Installed | undefined {
  try {
    const record = JSON.parse(readFileSync(devExtensionRecord(root), "utf8")) as Installed
    return typeof record.sha256 === "string" && existsSync(path.join(devExtensionFolder(root), "manifest.json")) ? record : undefined
  } catch {
    return undefined
  }
}

export async function syncDevExtension(extension: DevExtension, options: { readonly root?: string; readonly fetch?: typeof fetch; readonly env?: NodeJS.ProcessEnv; readonly port?: number } = {}): Promise<"current" | "updated"> {
  if (installedDevExtension(options.root ?? cacheRoot())?.sha256 === extension.sha256) return "current"
  throw new Error("此个人 fork 已禁用开发扩展远程下载（disabled）；请按本地规则同步工作流构建并加载本地扩展。")
}
