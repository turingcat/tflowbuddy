---
kind: upgrade-guide
description: Desktop packaging replaces Electron 44 with platform-specific Electron 40 distributions.
---

# Desktop Electron 40 Runtime

English | [中文](guide.zh.md)

## Change

Desktop packaging uses official Electron `40.10.6` on macOS and community Electron-for-windows-7 `40.2.0` on Windows instead of the Electron 44 npm distribution. Windows archives come from [Electron-for-windows-7](https://github.com/e3kskoy7wqk/Electron-for-windows-7/releases/tag/v40.2.0), not official Electron releases. Required SHA-256 digests are `ed4ebb022624ae38f764fcfc1dc1ce30fe2145298975d4c90e8d95412deeadea` for x64 `dist.zip` and `0a7560eae08360a6181510e0f20fd4c8f26a471c5118a427958a1d5974b767e5` for ia32 `dist-x86.zip`. Cached archives are verified on every preparation.

RunAsNode remains enabled: dsh, package scripts and command-management workers run through the application executable, not another Node binary. Windows 7 is an end-of-life OS; selecting this community shell is neither a security-support promise nor proof that all bundled dependencies run there. The `win-ia32` Windows 7 edition omits Python, the LibreOffice engine, Office skills, and inline Office-to-PDF processing. Its remaining JavaScript and native dependencies still require target-host validation.

## Migration

1. Run `pnpm install --frozen-lockfile` to install the pinned Electron dependency; development launch still needs its npm postinstall.
2. Rebuild the target runtime using `pnpm --dir apps/desktop run prepare:runtime` on the target build host. Windows preparation downloads the pinned community archive. Digest errors stop preparation; do not bypass verification.
3. Run the focused Desktop runtime tests and target-host payload smoke checks before distributing a rebuilt installer. Windows 7 needs separate real-machine acceptance tests for Python, native modules, startup and local tools. See [Desktop runtime documentation](../../../../apps/desktop/README.md).
4. To roll back packaging, restore the previous Electron 44 dependency and lockfile and the official Windows artifact preparation path together, then rebuild the complete runtime. Do not replace only the packaged executable.
