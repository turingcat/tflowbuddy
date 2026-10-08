import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ELECTRON_VERSION,
  WINDOWS_COMMUNITY_ELECTRON,
  resolveElectronRuntimeSource,
  electronNativeBuildEnvironment,
} from '../scripts/electron-runtime.mjs'

describe('electron runtime source', () => {
  it.each([['win32', 'ia32', '40.2.0'], ['win32', 'x64', '40.2.0'], ['darwin', 'arm64', '40.10.6']])(
    'uses Electron headers for native dependencies on %s/%s', (platform, arch, version) => {
      expect(electronNativeBuildEnvironment(platform, arch)).toEqual({
        npm_config_runtime: 'electron',
        npm_config_target: version,
        npm_config_disturl: 'https://www.electronjs.org/headers',
        npm_config_arch: arch,
      })
    },
  )
  it('selects the official Electron 40.10.6 artifact for macOS arm64', () => {
    expect(resolveElectronRuntimeSource('darwin', 'arm64')).toMatchObject({
      kind: 'official',
      version: '40.10.6',
    })
  })

  it('selects the official Electron 40.10.6 artifact for macOS x64', () => {
    expect(resolveElectronRuntimeSource('darwin', 'x64')).toMatchObject({
      kind: 'official',
      version: '40.10.6',
    })
  })

  it('selects digest-locked community archives for Windows x64', () => {
    expect(resolveElectronRuntimeSource('win32', 'x64')).toMatchObject({
      kind: 'community',
      version: '40.2.0',
      archive: 'dist.zip',
      sha256: 'ed4ebb022624ae38f764fcfc1dc1ce30fe2145298975d4c90e8d95412deeadea',
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

  it('builds the community release URL from the pinned repository and tag', () => {
    const x64 = resolveElectronRuntimeSource('win32', 'x64')
    const ia32 = resolveElectronRuntimeSource('win32', 'ia32')
    if (x64.kind !== 'community' || ia32.kind !== 'community') throw new Error('Windows requires community sources')
    expect(x64.url).toBe(
      'https://github.com/e3kskoy7wqk/Electron-for-windows-7/releases/download/v40.2.0/dist.zip',
    )
    expect(ia32.url).toBe(
      'https://github.com/e3kskoy7wqk/Electron-for-windows-7/releases/download/v40.2.0/dist-x86.zip',
    )
  })

  it('exposes the pinned Electron version and community Windows release', () => {
    expect(ELECTRON_VERSION).toBe('40.10.6')
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

  it('pins the desktop dev dependency to Electron 40.10.6', () => {
    expect(
      (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { devDependencies: { electron: string } }).devDependencies
        .electron,
    ).toBe('40.10.6')
  })

  it('does not suppress the Electron postinstall needed by the development launcher', () => {
    // The desktop dev launcher (`scripts/dev.ts`) does `require('electron')`,
    // which only resolves to an executable path when the npm postinstall has
    // downloaded the binary (path.txt + dist/). A workspace `allowBuilds`
    // suppression of `electron` silently breaks that launch path, so the
    // absence of any `electron: false` entry is a behavioral requirement.
    const workspace = readFileSync(
      join(import.meta.dirname, '../../../pnpm-workspace.yaml'),
      'utf8',
    )
    expect(workspace).not.toMatch(/^ {2}electron: false$/m)
  })
})
