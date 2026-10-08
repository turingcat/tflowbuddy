/**
 * Electron 40 runtime source table for the desktop packaging pipeline.
 *
 * macOS uses the official npm-distributed Electron artifacts; Windows 7
 * support requires the community Electron-for-windows-7 rebuild, pinned by
 * release tag and per-architecture SHA-256 digests. The table is the single
 * source of truth: consumers derive URLs from `repository` + `version` +
 * asset `name` instead of hardcoding strings.
 */

/** Official Electron release consumed on macOS via the `electron` npm package. */
export const ELECTRON_VERSION = '40.10.6'

/**
 * Community Electron-for-windows-7 release consumed on Windows.
 *
 * `sha256` values are the published digests of the release assets; the
 * downloader MUST verify them before unpacking.
 */
export const WINDOWS_COMMUNITY_ELECTRON = {
  version: '40.2.0',
  repository: 'e3kskoy7wqk/Electron-for-windows-7',
  assets: {
    x64: {
      name: 'dist.zip',
      sha256: 'ed4ebb022624ae38f764fcfc1dc1ce30fe2145298975d4c90e8d95412deeadea',
    },
    ia32: {
      name: 'dist-x86.zip',
      sha256: '0a7560eae08360a6181510e0f20fd4c8f26a471c5118a427958a1d5974b767e5',
    },
  },
}

/**
 * Resolve the runtime source for a desktop packaging target.
 *
 * @param {string} platform Node.js platform tag (`darwin` or `win32`).
 * @param {string} arch Node.js architecture tag (`arm64`, `x64`, or `ia32`).
 * @returns {{ kind: 'official', platform: string, arch: string, version: string }
 *   | { kind: 'community', platform: string, arch: string, version: string, url: string, archive: string, sha256: string }}
 *   Runtime source descriptor. `official` entries are installed from npm at
 *   `ELECTRON_VERSION`; `community` entries carry a pinned download URL and
 *   expected digest.
 */
export function resolveElectronRuntimeSource(platform, arch) {
  if (platform === 'darwin' && (arch === 'arm64' || arch === 'x64')) {
    return { kind: 'official', platform, arch, version: ELECTRON_VERSION }
  }
  if (platform === 'win32' && (arch === 'x64' || arch === 'ia32')) {
    const asset = WINDOWS_COMMUNITY_ELECTRON.assets[arch]
    return {
      kind: 'community',
      platform,
      arch,
      version: WINDOWS_COMMUNITY_ELECTRON.version,
      url: `https://github.com/${WINDOWS_COMMUNITY_ELECTRON.repository}/releases/download/v${WINDOWS_COMMUNITY_ELECTRON.version}/${asset.name}`,
      archive: asset.name,
      sha256: asset.sha256,
    }
  }
  throw new Error(`unsupported electron runtime target: ${platform}/${arch}`)
}

/**
 * Select Electron headers and import libraries for native package build scripts.
 * @param {string} platform Target platform.
 * @param {string} arch Target architecture.
 * @returns {Record<string, string>} node-gyp environment for the pinned runtime.
 */
export function electronNativeBuildEnvironment(platform, arch) {
  const source = resolveElectronRuntimeSource(platform, arch)
  return {
    npm_config_runtime: 'electron',
    npm_config_target: source.version,
    npm_config_disturl: 'https://www.electronjs.org/headers',
    npm_config_arch: arch,
  }
}
