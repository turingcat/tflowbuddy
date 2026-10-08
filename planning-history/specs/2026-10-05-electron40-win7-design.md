# Electron 40 Windows 7 Desktop Runtime Design

## Goal

Move TFlowBuddy Desktop to a split Electron 40 runtime policy: Windows packages use the pinned community Electron-for-windows-7 v40.2.0 binaries, macOS packages use the official Electron 40.x binary, and the bundled dsh process runs through the packaged Electron executable in Node mode. Add a first-class Windows ia32 packaging target for Windows 7 32-bit while keeping one Node runtime per package.

## Scope and compatibility policy

- Windows targets are `win-x64` and `win-ia32`.
- Windows uses community Electron-for-windows-7 `v40.2.0`.
- `dist.zip` is the x64 artifact with SHA-256 `ed4ebb022624ae38f764fcfc1dc1ce30fe2145298975d4c90e8d95412deeadea`.
- `dist-x86.zip` is the ia32 artifact with SHA-256 `0a7560eae08360a6181510e0f20fd4c8f26a471c5118a427958a1d5974b767e5`.
- macOS uses the official npm Electron `40.x` package selected by the workspace manifest. macOS targets remain `mac-arm64` and `mac-x64`.
- Windows 7 is a compatibility target, not a security-support promise. Release notes must state that Windows 7 is unsupported by Microsoft and should only be used in controlled environments.

## Runtime and packaging architecture

`prepare-runtime.ts` resolves the target platform and architecture, then chooses a runtime source. For Windows it downloads the exact community release asset from GitHub, validates its expected digest, and extracts the complete distribution into `buildPaths.electron`. For macOS it downloads the official Electron npm artifact through `@electron/get` at the pinned Electron package version. The existing electron-builder `electronDist` setting remains the only source of the application shell, so the package is built from a complete, internally consistent Electron distribution rather than replacing an executable after packaging.

The dsh primary runtime and CLI launcher use the packaged Electron executable as their process executable with `ELECTRON_RUN_AS_NODE=1`. The old copied Node launcher is removed from the runtime payload and no package step may download or copy a second Node binary. Runtime metadata records Electron version, Node version, target platform, and target architecture, and smoke tests execute the prepared executable in Node mode to verify the values.

## Target model

`DesktopPackageTargetName` gains `win-ia32`. Target metadata carries `arch: 'ia32'`, builder selector `--ia32`, and Windows host constraints. A Windows x64 host may prepare both Windows architectures because the preparation uses downloaded Electron distributions and architecture-independent application files; an ia32 host may prepare only `win-ia32`. Existing macOS host restrictions remain unchanged. Update feed and artifact records use the target name, so x64 and ia32 artifacts never collide.

## Dependency and native-module constraints

The `electron` dev dependency supplies Electron API types and the macOS official artifact version. Windows community binaries are not represented as an npm dependency because they are published as release archives. Native packages that are architecture-specific (`node-pty`, `sharp`, libreoffice-kit and similar) must be rebuilt or selected for ia32 by the existing package preparation path. If a dependency cannot produce an ia32 artifact, the packaging preflight fails with the dependency name; it must not silently fall back to x64.

## Security and failure handling

- Community download URLs, version, asset names, and digests are constants in one target-runtime module and are covered by tests.
- A missing asset, HTTP error, archive extraction error, or digest mismatch aborts preparation before electron-builder runs.
- Digest verification hashes the downloaded archive before extraction; a cached archive is re-hashed on every preparation.
- The GitHub repository and commit/tag are documented in the upgrade guide and third-party supply-chain notes.
- RunAsNode remains enabled through Electron Fuses. This is required for the shared dsh runtime and is documented as a local executable capability.

## Testing and verification

- Unit tests cover target parsing, target path isolation, runtime-source selection, digest failures, and the `win-ia32` builder selector.
- Runtime smoke tests verify `process.versions.electron`, `process.versions.node`, `process.platform`, and `process.arch` under `ELECTRON_RUN_AS_NODE=1` for prepared distributions.
- Packaging configuration tests assert `electronDist` points to the target directory and that no standalone Node binary is copied.
- Focused Desktop tests, typecheck, build, and packaging-config checks run before completion. A real Windows 7 x86 installation remains a release acceptance test because it cannot be simulated by the macOS CI host.

## Upgrade and rollback

The upgrade guide records the two runtime sources, exact digests, Node 24.11.1 supplied by the community Windows build, the one-Node invariant, Windows 7 limitations, and rollback to the previous Electron 44 release. Changing the community runtime version requires updating the version, asset names, digests, smoke expectations, and this guide together.
