---
kind: upgrade-guide
description: 桌面打包将 Electron 44 替换为按平台选择的 Electron 40 发行版。
---

# 桌面 Electron 40 运行时

[English](guide.md) | 中文

## 变更

桌面打包不再使用 Electron 44 npm 发行版，macOS 使用官方 Electron `40.10.6`，Windows 使用社区 Electron-for-windows-7 `40.2.0`。Windows 压缩包来自 [Electron-for-windows-7](https://github.com/e3kskoy7wqk/Electron-for-windows-7/releases/tag/v40.2.0)，并非官方 Electron 发布。x64 `dist.zip` 的必需 SHA-256 摘要为 `ed4ebb022624ae38f764fcfc1dc1ce30fe2145298975d4c90e8d95412deeadea`，ia32 `dist-x86.zip` 为 `0a7560eae08360a6181510e0f20fd4c8f26a471c5118a427958a1d5974b767e5`。每次准备都会重新校验缓存文件。

RunAsNode 保持启用：dsh、包脚本和命令管理进程均通过应用自身的可执行文件运行，不附带另一份 Node 二进制。Windows 7 已停止支持；选择这个社区壳既不承诺安全支持，也不能证明全部内置依赖可在该系统运行。Windows 7 `win-ia32` 版本不携带 Python、LibreOffice 引擎、Office skills，也不提供内联 Office-to-PDF 处理；其余 JavaScript 和原生依赖仍需目标主机验证。

## 迁移

1. 执行 `pnpm install --frozen-lockfile` 安装固定版本的 Electron 依赖；开发启动仍需要它的 npm 安装后脚本。
2. 在目标构建主机执行 `pnpm --dir apps/desktop run prepare:runtime` 重建目标运行时。Windows 准备过程下载固定的社区压缩包。摘要错误会停止准备，不得绕过校验。
3. 分发重建的安装包前，执行桌面运行时定向测试和目标主机载荷 smoke 检查。Windows 7 还需在实机验收 Python、原生模块、启动和本地工具。参见[桌面运行时文档](../../../../apps/desktop/README.zh.md)。
4. 回滚打包时，一并恢复之前的 Electron 44 依赖、锁文件和 Windows 官方产物准备路径，然后重建完整运行时，不要只替换安装包中的可执行文件。
