/** Release filenames and COS publication order, using real files and SDK requests. */
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createDesktopCos } from '../../apps/desktop/scripts/desktop-cos.ts'
import { answer, cosError, startCosLoopback, type CosLoopback } from '../../apps/desktop/tests/cos-loopback.ts'
import { releaseInstallerNames, stageReleaseInstaller, uploadReleaseInstallers } from '../tflowbuddy-release.ts'

const releaseId = '0.1.1-202610112009'
const names = [
  'TFlowBuddy-Win32-v0.1.1-202610112009.exe',
  'TFlowBuddy-Win64-v0.1.1-202610112009.exe',
  'TFlowBuddy-MacOS-v0.1.1-202610112009.dmg',
]
const directories: string[] = []
const loopbacks: CosLoopback[] = []

afterEach(async () => {
  try {
    await Promise.all(loopbacks.splice(0).map(loopback => loopback.close()))
  } finally {
    await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
  }
})

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'tflowbuddy-release-'))
  directories.push(directory)
  return directory
}

describe('TFlowBuddy release installers', () => {
  it('stages each target with its public platform name and the shared release ID', async () => {
    const source = await fixture()
    const output = await fixture()
    expect(releaseInstallerNames(releaseId)).toEqual(names)
    for (const [target, suffix, name] of [
      ['win-ia32', 'win-ia32.exe', names[0]],
      ['win-x64', 'win-x64.exe', names[1]],
      ['mac-arm64', 'mac-arm64.dmg', names[2]],
    ] as const) {
      await writeFile(join(source, `tflowbuddy-0.1.1-${suffix}`), target)
      await stageReleaseInstaller(target, releaseId, source, output)
      expect(await readFile(join(output, name!), 'utf8')).toBe(target)
      await rm(join(source, `tflowbuddy-0.1.1-${suffix}`))
    }
    expect((await readdir(output)).sort()).toEqual([...names].sort())
  })

  it.each(['../0.1.1-202610112009', 'v0.1.1-202610112009', '0.1.1-2026101120', ''])('rejects invalid release IDs before staging: %s', (id) => {
    expect(() => releaseInstallerNames(id)).toThrow('release ID')
  })

  it('refuses missing, ambiguous, or empty installers', async () => {
    const source = await fixture()
    const output = await fixture()
    await expect(stageReleaseInstaller('win-x64', releaseId, source, output)).rejects.toThrow('exactly one')
    await writeFile(join(source, 'tflowbuddy-0.1.1-win-x64.exe'), '')
    await expect(stageReleaseInstaller('win-x64', releaseId, source, output)).rejects.toThrow('nonempty')
    await writeFile(join(source, 'tflowbuddy-old-win-x64.exe'), 'old')
    await expect(stageReleaseInstaller('win-x64', releaseId, source, output)).rejects.toThrow('exactly one')
    expect(await readdir(output)).toEqual([])
  })

  it('runs the staging CLI used by the workflow without exposing credential environment values', async () => {
    const source = await fixture()
    const output = await fixture()
    await writeFile(join(source, 'tflowbuddy-0.1.1-win-ia32.exe'), 'installer')
    const result = spawnSync(process.execPath, [join(import.meta.dirname, '../tflowbuddy-release.ts'), 'stage', 'win-ia32', source, output], {
      encoding: 'utf8',
      env: { RELEASE_ID: releaseId, COS_SECRET_ID: 'fixture-id', COS_SECRET_KEY: 'fixture-secret' },
      timeout: 10_000,
    })
    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status, result.stderr).toBe(0)
    expect(await readFile(join(output, names[0]!), 'utf8')).toBe('installer')
    expect(result.stdout.trim()).toBe(names[0])
    expect(result.stderr).not.toContain('fixture-secret')
  })

  it('rejects missing COS settings through the upload CLI before network writes', () => {
    const result = spawnSync(process.execPath, [join(import.meta.dirname, '../tflowbuddy-release.ts'), 'upload', 'installers'], {
      encoding: 'utf8',
      env: { RELEASE_ID: releaseId },
      timeout: 10_000,
    })
    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Missing release setting: COS_BUCKET')
  })

  it('sends all installers before replacing the uncached VERSION object', async () => {
    const directory = await fixture()
    for (const name of names) await writeFile(join(directory, name), `bytes:${name}`)
    const loopback = await startCosLoopback()
    loopbacks.push(loopback)
    const cos = createDesktopCos({ secretId: 'fixture-id', secretKey: 'fixture-secret' })
    loopback.redirect(cos)
    await uploadReleaseInstallers(directory, releaseId, { bucket: 'fixture-1250000000', region: 'ap-guangzhou' }, cos)
    expect(loopback.requests.map(request => request.path)).toEqual([...names.map(name => `/tflowbuddy/${name}`), '/tflowbuddy/VERSION'])
    for (const [index, name] of names.entries()) {
      expect(loopback.requests[index]!.body.toString()).toBe(`bytes:${name}`)
      expect(loopback.requests[index]!.headers['content-md5']).toBeDefined()
      expect(loopback.requests[index]!.headers['content-length']).toBe(String(Buffer.byteLength(`bytes:${name}`)))
    }
    const version = loopback.requests[3]!
    expect(version.body.toString()).toBe('0.1.1-202610112009\n')
    expect(version.headers['cache-control']).toBe('no-store, no-cache, max-age=0, must-revalidate')
    expect(version.headers['content-type']).toBe('text/plain; charset=utf-8')
    expect(loopback.requests.every(request => request.method === 'PUT')).toBe(true)
  })

  it('preflights the complete installer set before any remote writes', async () => {
    const directory = await fixture()
    await writeFile(join(directory, names[0]!), 'first')
    const loopback = await startCosLoopback()
    loopbacks.push(loopback)
    const cos = createDesktopCos({ secretId: 'fixture-id', secretKey: 'fixture-secret' })
    loopback.redirect(cos)
    await expect(uploadReleaseInstallers(directory, releaseId, { bucket: 'fixture-1250000000', region: 'ap-guangzhou' }, cos)).rejects.toThrow('installer set')
    expect(loopback.requests).toHaveLength(0)
  })

  it.each([1, 2, 3])('leaves VERSION unchanged when installer PUT %s fails, without retrying', async (failureAt) => {
    const directory = await fixture()
    for (const name of names) await writeFile(join(directory, name), 'installer')
    const loopback = await startCosLoopback((_request, response) => {
      answer(response, loopback.requests.length === failureAt ? 403 : 200, cosError('AccessDenied', 'fixture-secret'))
    })
    loopbacks.push(loopback)
    const cos = createDesktopCos({ secretId: 'fixture-id', secretKey: 'fixture-secret' })
    loopback.redirect(cos)
    await expect(uploadReleaseInstallers(directory, releaseId, { bucket: 'fixture-1250000000', region: 'ap-guangzhou' }, cos)).rejects.toThrow(`COS PUT failed: tflowbuddy/${names[failureAt - 1]}`)
    expect(loopback.requests).toHaveLength(failureAt)
    expect(loopback.requests.some(request => request.path.endsWith('/VERSION'))).toBe(false)
  })
})
