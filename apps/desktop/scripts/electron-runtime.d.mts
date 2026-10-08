/** Official macOS Electron release. */
export const ELECTRON_VERSION: '40.10.6'

/** Digest-locked Windows community release. */
export const WINDOWS_COMMUNITY_ELECTRON: {
  version: string
  repository: string
  assets: Record<'x64' | 'ia32', { name: string; sha256: string }>
}

/** Download source selected for a supported Desktop target. */
export type ElectronRuntimeSource =
  | { kind: 'official'; platform: string; arch: string; version: string }
  | { kind: 'community'; platform: string; arch: string; version: string; url: string; archive: string; sha256: string }

/**
 * Resolve the distribution for one target, rejecting unsupported pairs.
 * @param platform - Target platform.
 * @param arch - Target architecture.
 * @returns Pinned distribution source.
 */
export function resolveElectronRuntimeSource(platform: string, arch: string): ElectronRuntimeSource

/**
 * Select native build headers for the target Electron distribution.
 * @param platform - Target platform.
 * @param arch - Target architecture.
 * @returns node-gyp environment using Electron rather than standalone Node headers.
 */
export function electronNativeBuildEnvironment(platform: string, arch: string): Record<string, string>
