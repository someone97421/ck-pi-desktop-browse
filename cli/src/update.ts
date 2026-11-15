import { autoUpdateModes, setStoredMode, type AutoUpdateMode } from "./update/auto-update.ts"

export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

export type UpdateCheck = {
  readonly repo: string
  readonly checkedAt: number
  readonly head: string
  readonly upstream: string
  readonly latest?: string
  readonly behind?: number
  readonly available: boolean
  readonly failed?: boolean
}

export type UpdateNotice = {
  readonly summary: string
  readonly command: string
  readonly check: UpdateCheck
}

export type Git = (args: readonly string[], timeoutMs?: number) => Promise<string | undefined>

export const gitIn = (_repo: string): Git => async () => undefined

export async function checkForUpdate(_repo: string, _git?: Git, _now = Date.now()): Promise<UpdateCheck | undefined> {
  return undefined
}

export async function cachedUpdateCheck(_options: {
  readonly repo: string
  readonly dataDir: string
  readonly git?: Git
  readonly now?: number
}): Promise<UpdateCheck | undefined> {
  return undefined
}

export const updateCheckEnabled = () => false

export function describeUpdate(check: UpdateCheck): string {
  if (check.behind) return `${check.behind} new commit${check.behind === 1 ? "" : "s"} on ${check.upstream}`
  return `${check.upstream} is at ${(check.latest ?? "").slice(0, 7)} (you have ${check.head.slice(0, 7)})`
}

export type UpdateJson = {
  readonly available: true
  readonly summary: string
  readonly command: string
  readonly notice: string
  readonly current: string
  readonly latest: string | null
  readonly behind: number | null
  readonly upstream: string
}

export function updateJson(update: UpdateNotice | undefined): UpdateJson | null {
  if (!update) return null
  const { check } = update
  return {
    available: true,
    summary: update.summary,
    command: update.command,
    notice: formatUpdateNotice(update),
    current: check.head,
    latest: check.latest ?? null,
    behind: check.behind ?? null,
    upstream: check.upstream,
  }
}

export function formatUpdateNotice(notice: Pick<UpdateNotice, "summary" | "command">): string {
  return `Update available: ${notice.summary}. Run \`${notice.command}\`, then restart opencode.`
}

export async function updateNotice(_options: { readonly repo?: string; readonly dataDir?: string; readonly git?: Git } = {}): Promise<UpdateNotice | undefined> {
  return undefined
}

export function npmUpdateNotice(): UpdateNotice | undefined | false {
  return undefined
}

export function createUpdateWatcher(_options: {
  readonly check?: () => Promise<UpdateNotice | undefined>
  readonly onChange?: (notice: UpdateNotice | undefined) => void
  readonly intervalMs?: number
  readonly now?: () => number
} = {}) {
  return {
    get current(): UpdateNotice | undefined {
      return undefined
    },
    async refresh(): Promise<void> {},
  }
}

type Run = { status: number | null; stdout: string; stderr: string; error?: Error }

export type UpdateDeps = {
  readonly repo: string | undefined
  readonly log: (line: string) => void
  readonly git?: (args: readonly string[], timeoutMs?: number) => Run
  readonly hasBun?: () => boolean
  readonly setup?: (step: { readonly repo: string; readonly root: boolean; readonly cli: boolean; readonly args: readonly string[] }) => string | undefined
}

export const LOCAL_UPDATE_ADVICE = "此个人 fork 已禁用上游更新（disabled）。请按本地规则同步工作流维护个人仓库，再按本地规则构建和安装。"

export function runUpdate(args: readonly string[], deps: UpdateDeps): number {
  const modeAt = args.indexOf("--mode")
  if (modeAt !== -1) {
    const mode = args[modeAt + 1]
    if (!mode || !(autoUpdateModes as readonly string[]).includes(mode)) {
      deps.log("--mode 仅支持 on、notify 或 off。")
      return 1
    }
    setStoredMode(mode as AutoUpdateMode)
    deps.log(`已保存 autoUpdate=${mode}；有效模式仍为 off（disabled）。`)
  }
  deps.log(args.includes("--check") ? "上游更新检查已禁用（disabled），无可用更新。" : LOCAL_UPDATE_ADVICE)
  return 0
}

export async function runUpdateCommand(args: readonly string[]) {
  process.exitCode = runUpdate(args, { repo: undefined, log: (line) => process.stdout.write(line + "\n") })
}
