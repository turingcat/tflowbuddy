/** Official macOS and Windows x64 Electron release. */
export const ELECTRON_VERSION: '44.0.0'

/** Digest-locked Windows community release. */
export const WINDOWS_COMMUNITY_ELECTRON: {
  version: '40.2.0'
  repository: 'e3kskoy7wqk/Electron-for-windows-7'
  assets: {
    x64: {
      name: 'dist.zip'
      sha256: 'ed4ebb022624ae38f764fcfc1dc1ce30fe2145298975d4c90e8d95412deeadea'
    }
    ia32: {
      name: 'dist-x86.zip'
      sha256: '0a7560eae08360a6181510e0f20fd4c8f26a471c5118a427958a1d5974b767e5'
    }
  }
}

export type ElectronRuntimeSource =
  | { kind: 'official'; platform: string; arch: string; version: string }
  | { kind: 'community'; platform: string; arch: string; version: string; url: string; archive: string; sha256: string }

export function resolveElectronRuntimeSource(platform: string, arch: string): ElectronRuntimeSource
export function electronNativeBuildEnvironment(platform: string, arch: string): Record<string, string>
