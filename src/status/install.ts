const SOURCE = "git clone https://github.com/someone97421/ck-pi-desktop-browse.git && cd ck-pi-desktop-browse"
const windows = typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent)

export type InstallMethod = {
  id: string
  label: string
  command: string
  title: string
}

const source: InstallMethod = {
  id: "source",
  label: "源码",
  command: `${SOURCE} && ${windows ? "./install.ps1" : "bash ./install"}`,
  title: windows ? "在 PowerShell 7 中运行" : "在终端运行",
}

export const installMethods = [source]
export const remoteInstallMethods = [{ ...source, command: `${SOURCE} && bash ./install --remote`, title: "在远程计算机的终端运行" }]
export const installMethod = installMethods[0]!
export const remoteInstallMethod = remoteInstallMethods[0]!
export const installCommand = installMethod.command
