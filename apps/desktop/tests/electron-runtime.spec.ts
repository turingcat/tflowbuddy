import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ELECTRON_VERSION,
  WINDOWS_COMMUNITY_ELECTRON,
  resolveElectronRuntimeSource,
  electronNativeBuildEnvironment,
} from '../scripts/electron-runtime.mjs'

describe('electron runtime source', () => {
  it.each([['win32', 'ia32', '40.2.0'], ['win32', 'x64', '44.0.0'], ['darwin', 'arm64', '44.0.0']])(
    'uses Electron headers for native dependencies on %s/%s', (platform, arch, version) => {
      expect(electronNativeBuildEnvironment(platform, arch)).toEqual({
        npm_config_runtime: 'electron',
        npm_config_target: version,
        npm_config_disturl: 'https://www.electronjs.org/headers',
        npm_config_arch: arch,
      })
    },
  )
  it('selects the official Electron 44.0.0 artifact for macOS arm64', () => {
    expect(resolveElectronRuntimeSource('darwin', 'arm64')).toMatchObject({
      kind: 'official',
      version: '44.0.0',
    })
  })

  it('selects the official Electron 44.0.0 artifact for macOS x64', () => {
    expect(resolveElectronRuntimeSource('darwin', 'x64')).toMatchObject({
      kind: 'official',
      version: '44.0.0',
    })
  })

  it('selects official Electron 44.0.0 artifact for Windows x64', () => {
    expect(resolveElectronRuntimeSource('win32', 'x64')).toMatchObject({
      kind: 'official',
      version: '44.0.0',
    })
  })

  it('selects digest-locked community archives for Windows ia32', () => {
    expect(resolveElectronRuntimeSource('win32', 'ia32')).toMatchObject({
      kind: 'community',
      version: '40.2.0',
      archive: 'dist-x86.zip',
      sha256: '0a7560eae08360a6181510e0f20fd4c8f26a471c5118a427958a1d5974b767e5',
    })
  })

  it('builds the community release URL for Windows ia32 from the pinned repository and tag', () => {
    const ia32 = resolveElectronRuntimeSource('win32', 'ia32')
    if (ia32.kind !== 'community') throw new Error('Windows ia32 requires community sources')
    expect(ia32.url).toBe(
      'https://github.com/e3kskoy7wqk/Electron-for-windows-7/releases/download/v40.2.0/dist-x86.zip',
    )
  })

  it('exposes the pinned Electron version and community Windows release', () => {
    expect(ELECTRON_VERSION).toBe('44.0.0')
    expect(WINDOWS_COMMUNITY_ELECTRON).toEqual({
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
    })
  })

  it('rejects unsupported platform/architecture pairs', () => {
    expect(() => resolveElectronRuntimeSource('linux', 'x64')).toThrow(/unsupported/i)
    expect(() => resolveElectronRuntimeSource('darwin', 'ia32')).toThrow(/unsupported/i)
    expect(() => resolveElectronRuntimeSource('win32', 'arm64')).toThrow(/unsupported/i)
  })

  it('pins the desktop dev dependency to Electron ^44.0.0', () => {
    expect(
      (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { devDependencies: { electron: string } }).devDependencies
        .electron,
    ).toBe('^44.0.0')
  })

  it('does not suppress the Electron postinstall needed by the development launcher', () => {
    // The desktop dev launcher (`scripts/dev.ts`) does `require('electron')`,
    // which only resolves to an executable path when the npm postinstall has
    // downloaded the binary (path.txt + dist/). A workspace `allowBuilds`
    // suppression of `electron` silently breaks that launch path, so the
    // repository-root pnpm configuration must NOT set allowBuilds.electron
    // to false.
    const workspaceConfig = readFileSync(
      new URL('../../../pnpm-workspace.yaml', import.meta.url),
      'utf8',
    )
    expect(workspaceConfig).not.toMatch(/^(\s*)electron:\s*false/m)
  })
})
