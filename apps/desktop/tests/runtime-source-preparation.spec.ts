/** Runtime-source preparation: digest-verified Electron archives and the one-Node launcher contract. */

import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  prepareElectronRuntime,
  runtimeArchiveCachePath,
  sha256File,
  downloadCommunityArchive,
  readElectronRuntimeFacts,
} from '../scripts/prepare-electron-runtime.ts'
import { commandManagerProcess } from '../src/command-manager-process.ts'

const roots: string[] = []

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-runtime-source-'))
  roots.push(root)
  return root
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
})

describe('runtime archive verification', () => {
  it('reports the sha256 digest of an archive file', async () => {
    const root = scratch()
    const archive = join(root, 'dist.zip')
    writeFileSync(archive, 'electron-bytes')
    await expect(sha256File(archive)).resolves
      .toBe(createHash('sha256').update('electron-bytes').digest('hex'))
  })

  it('names the cache entry by target and expected digest so a tampered asset never reuses it', () => {
    expect(runtimeArchiveCachePath('/cache', 'win-ia32', {
      archive: 'dist-x86.zip',
      sha256: '0a7560eae08360a6181510e0f20fd4c8f26a471c5118a427958a1d5974b767e5',
    })).toBe(join('/cache', 'electron-win-ia32-0a7560eae08360a6181510e0f20fd4c8f26a471c5118a427958a1d5974b767e5-dist-x86.zip'))
  })

  it('rejects a community download whose digest differs from the pinned value before extraction', async () => {
    const root = scratch()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('forged-bytes', { status: 200 })))
    await expect(prepareElectronRuntime('win-x64', join(root, 'electron'), join(root, 'cache')))
      .rejects.toThrow(/digest mismatch/u)
    // A rejected archive must never reach the target distribution directory.
    expect(() => readFileSync(join(root, 'electron', 'electron.exe'))).toThrow(/ENOENT/u)
  })

  it('rejects a cached archive whose bytes no longer match the pinned digest', async () => {
    const root = scratch()
    const cache = join(root, 'cache')
    mkdirSync(cache, { recursive: true })
    writeFileSync(runtimeArchiveCachePath(cache, 'win-x64', {
      archive: 'dist.zip',
      sha256: 'ed4ebb022624ae38f764fcfc1dc1ce30fe2145298975d4c90e8d95412deeadea',
    }), 'tampered')
    const fetchMock = vi.fn(async () => new Response('unused', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(prepareElectronRuntime('win-x64', join(root, 'electron'), cache)).rejects.toThrow(/digest mismatch/u)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails loudly when the community release asset is unavailable', async () => {
    const root = scratch()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })))
    await expect(prepareElectronRuntime('win-ia32', join(root, 'electron'), join(root, 'cache')))
      .rejects.toThrow(/404/u)
  })

  it('retains a downloaded archive only when its bytes match the release digest', async () => {
    const root = scratch()
    const bytes = Buffer.from('verified archive payload')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(bytes), { status: 200 })))
    const source = {
      kind: 'community' as const,
      platform: 'win32',
      arch: 'ia32',
      version: '40.2.0',
      url: 'https://example.invalid/dist-x86.zip',
      archive: 'dist-x86.zip',
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }
    const archive = await downloadCommunityArchive(source, 'win-ia32', join(root, 'cache'))
    expect(readFileSync(archive)).toEqual(bytes)
    await expect(sha256File(archive)).resolves.toBe(source.sha256)
  })
})

describe('prepared executable identity', () => {
  it('rejects an executable that is Node rather than the selected Electron release', () => {
    expect(() => readElectronRuntimeFacts(process.execPath, {
      platform: process.platform, arch: process.arch, version: '40.10.6',
    })).toThrow(/prepared Electron/u)
  })
})

describe('one-Node runtime preparation', () => {
  it('copies only Electron launcher scripts into runtime/bin, never a standalone Node executable', () => {
    const source = readFileSync(new URL('../scripts/prepare-runtime.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('node.exe')
    expect(source).not.toMatch(/cpSync\([^)]*node\.exe/u)
    const bin = new URL('../scripts/node-bin/', import.meta.url)
    const shell = readFileSync(new URL('node', bin), 'utf8')
    const cmd = readFileSync(new URL('node.cmd', bin), 'utf8')
    expect(shell).toContain('ELECTRON_RUN_AS_NODE=1')
    expect(shell).toContain('DSH_DESKTOP_NODE_EXECUTABLE')
    expect(cmd).toContain('ELECTRON_RUN_AS_NODE=1')
    expect(cmd).toContain('DSH_DESKTOP_NODE_EXECUTABLE')
  })

  it('runs the command manager through the packaged Electron executable in Node mode', () => {
    const resources = process.platform === 'win32' ? 'C:\\Apps\\resources' : '/Applications/App.app/Contents/Resources'
    const invocation = commandManagerProcess(resources, process.platform, '/usr/local/bin/node-electron')
    expect(invocation.executable).toBe('/usr/local/bin/node-electron')
    expect(invocation.environment.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(invocation.environment.DSH_DESKTOP_NODE_EXECUTABLE).toBe('/usr/local/bin/node-electron')
    expect(JSON.stringify(invocation)).not.toContain('dependencies/node')
  })

  it('threads Node mode through the clean elevation environment', () => {
    const invocation = commandManagerProcess('/resources', 'darwin', '/usr/local/bin/electron')
    expect(invocation.elevatedEnvironment).toMatchObject({
      ELECTRON_RUN_AS_NODE: '1',
      DSH_DESKTOP_NODE_EXECUTABLE: '/usr/local/bin/electron',
    })
  })
})
