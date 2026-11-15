$ErrorActionPreference = 'Stop'
$installArgs = $args
if (-not $PSScriptRoot -or -not (Test-Path (Join-Path $PSScriptRoot 'cli/package.json'))) {
    throw '请在个人仓库源码目录运行 ./install.ps1；安装说明见 https://github.com/someone97421/ck-pi-desktop-browse'
}

Push-Location $PSScriptRoot
try {
    & bun install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw '根目录依赖安装失败' }
    Set-Location cli
    & bun install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw 'CLI 依赖安装失败' }
    & bun run build
    if ($LASTEXITCODE -ne 0) { throw '源码构建失败' }
    & node dist/cli.mjs install @installArgs
    if ($LASTEXITCODE -ne 0) { throw '本地配置失败' }
} finally {
    Pop-Location
}
