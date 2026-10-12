/** Release filenames and COS publication order, using real files and SDK requests. */
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createDesktopCos } from '../../apps/desktop/scripts/desktop-cos.ts'
import { answer, cosError, startCosLoopback, type CosLoopback, type CosLoopbackRequest } from '../../apps/desktop/tests/cos-loopback.ts'
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

async function multipartFixture(partReply?: (request: CosLoopbackRequest, response: ServerResponse) => boolean,
  failure?: 'length' | 'etag' | 'version') {
  const objects = new Map<string, Buffer>()
  const parts = new Map<string, Map<number, Buffer>>()
  const loopback = await startCosLoopback((request, response) => {
    const url = new URL(request.path, 'http://fixture')
    const key = url.pathname
    if (request.method === 'GET' && url.searchParams.has('uploads')) {
      answer(response, 200, '<ListMultipartUploadsResult><IsTruncated>false</IsTruncated></ListMultipartUploadsResult>')
    } else if (request.method === 'POST' && url.searchParams.has('uploads')) {
      parts.set(key, new Map())
      answer(response, 200, '<InitiateMultipartUploadResult><UploadId>fixture-upload</UploadId></InitiateMultipartUploadResult>')
    } else if (request.method === 'PUT' && url.searchParams.has('partNumber')) {
      parts.get(key)!.set(Number(url.searchParams.get('partNumber')), request.body)
      if (partReply?.(request, response)) return
      answer(response, 200, '', { etag: `"${createHash('md5').update(request.body).digest('hex')}"` })
    } else if (request.method === 'POST' && url.searchParams.has('uploadId')) {
      objects.set(key, Buffer.concat([...parts.get(key)!].sort(([a], [b]) => a - b).map(([, body]) => body)))
      answer(response, 200, '<CompleteMultipartUploadResult><ETag>"fixture-etag"</ETag></CompleteMultipartUploadResult>')
    } else if (request.method === 'HEAD') {
      answer(response, 200, '', { 'content-length': String(objects.get(key)!.length + (failure === 'length' ? 1 : 0)),
        etag: failure === 'etag' ? '"wrong"' : '"fixture-etag"' })
    } else if (request.method === 'PUT') {
      if (failure === 'version' && key === '/tflowbuddy/VERSION') {
        answer(response, 403, cosError('AccessDenied', 'fixture-secret'), { 'x-cos-request-id': 'fixture-request' })
        return
      }
      objects.set(key, request.body)
      answer(response)
    } else {
      answer(response, 400, cosError('UnexpectedRequest'))
    }
  })
  loopbacks.push(loopback)
  const cos = createDesktopCos({ secretId: 'fixture-id', secretKey: 'fixture-secret' }, 15_000,
    { retryTimes: 5, parallelLimit: 4 })
  loopback.redirect(cos)
  return { cos, loopback, objects }
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
    const { cos, loopback, objects } = await multipartFixture()
    await uploadReleaseInstallers(directory, releaseId, { bucket: 'fixture-1250000000', region: 'ap-guangzhou' }, cos)
    expect(loopback.requests.filter(request => request.method === 'HEAD').map(request => request.path))
      .toEqual(names.map(name => `/tflowbuddy/${name}`))
    for (const [index, name] of names.entries()) {
      expect(objects.get(`/tflowbuddy/${name}`)!.toString()).toBe(`bytes:${name}`)
      const part = loopback.requests.filter(request => request.path.includes('partNumber='))[index]!
      expect(part.headers['content-md5']).toBe(createHash('md5').update(part.body).digest('base64'))
      expect(part.headers['content-length']).toBe(String(Buffer.byteLength(`bytes:${name}`)))
    }
    const version = loopback.requests.at(-1)!
    expect(version.body.toString()).toBe('0.1.1-202610112009\n')
    expect(version.headers['cache-control']).toBe('no-store, no-cache, max-age=0, must-revalidate')
    expect(version.headers['content-type']).toBe('text/plain; charset=utf-8')
    expect(loopback.requests.filter(request => request.method === 'POST'
      && new URL(request.path, 'http://fixture').searchParams.has('uploads'))).toHaveLength(3)
  })

  it.each([false, true])('retries only a failed part at most five times; exhausted=%s', async (exhausted) => {
    const directory = await fixture()
    for (const name of names) await writeFile(join(directory, name), Buffer.alloc(9 * 1024 * 1024, 7))
    let attempts = 0
    const { cos, loopback } = await multipartFixture((request, response) => {
      const url = new URL(request.path, 'http://fixture')
      if (url.pathname.endsWith(names[0]!) && url.searchParams.get('partNumber') === '1') {
        attempts++
        if (exhausted || attempts <= 5) {
          answer(response, 503, cosError('InternalError', 'fixture-secret'), { 'x-cos-request-id': 'fixture-request' })
          return true
        }
      }
      return false
    })
    const upload = uploadReleaseInstallers(directory, releaseId, { bucket: 'fixture-1250000000', region: 'ap-guangzhou' }, cos)
    if (exhausted) {
      await expect(upload).rejects.toThrow('InternalError')
      expect(loopback.requests.some(request => request.path.endsWith('/VERSION'))).toBe(false)
    } else {
      await upload
      expect(loopback.requests.at(-1)!.path).toBe('/tflowbuddy/VERSION')
    }
    expect(attempts).toBe(6)
    const otherPart = loopback.requests.filter(request => request.path.startsWith(`/tflowbuddy/${names[0]}?`)
      && new URL(request.path, 'http://fixture').searchParams.get('partNumber') === '2')
    expect(otherPart).toHaveLength(1)
    expect(otherPart[0]!.body).toHaveLength(1024 * 1024)
  })

  it('uploads four 8 MiB parts concurrently before allowing a fifth part', async () => {
    const directory = await fixture()
    for (const name of names) await writeFile(join(directory, name), Buffer.alloc(40 * 1024 * 1024, 9))
    const held: Array<{ request: CosLoopbackRequest; response: ServerResponse }> = []
    let released = false
    const { cos, loopback } = await multipartFixture((request, response) => {
      if (released || !request.path.startsWith(`/tflowbuddy/${names[0]}?`)) return false
      held.push({ request, response })
      if (held.length === 4) {
        released = true
        for (const part of held) {
          answer(part.response, 200, '', { etag: `"${createHash('md5').update(part.request.body).digest('hex')}"` })
        }
      }
      return true
    })
    // Held replies establish overlap without depending on request arrival order.
    await uploadReleaseInstallers(directory, releaseId, { bucket: 'fixture-1250000000', region: 'ap-guangzhou' }, cos)
    expect(held).toHaveLength(4)
    expect(held.every(part => part.request.body.length === 8 * 1024 * 1024)).toBe(true)
    expect(loopback.requests.filter(request => request.path.includes('partNumber='))).toHaveLength(15)
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

  it.each(['length', 'etag'] as const)('leaves VERSION unchanged when remote %s verification fails', async (failure) => {
    const directory = await fixture()
    for (const name of names) await writeFile(join(directory, name), 'installer')
    const { cos, loopback } = await multipartFixture(undefined, failure)
    await expect(uploadReleaseInstallers(directory, releaseId, { bucket: 'fixture-1250000000', region: 'ap-guangzhou' }, cos))
      .rejects.toThrow('ObjectVerificationFailed')
    expect(loopback.requests.some(request => request.path.endsWith('/VERSION'))).toBe(false)
  })

  it('reports a failed VERSION write without retrying or exposing SDK messages', async () => {
    const directory = await fixture()
    for (const name of names) await writeFile(join(directory, name), 'installer')
    const { cos, loopback } = await multipartFixture(undefined, 'version')
    const error = await uploadReleaseInstallers(directory, releaseId,
      { bucket: 'fixture-1250000000', region: 'ap-guangzhou' }, cos).catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(Error)
    const message = error instanceof Error ? error.message : ''
    expect(message).toContain('code=AccessDenied; http=403; requestId=fixture-request')
    expect(message).not.toContain('fixture-secret')
    expect(message).not.toContain('q-sign')
    expect(loopback.requests.filter(request => request.path.endsWith('/VERSION'))).toHaveLength(1)
  })

  it.each([1, 2, 3])('leaves VERSION unchanged when installer %s exhausts part retries', async (failureAt) => {
    const directory = await fixture()
    for (const name of names) await writeFile(join(directory, name), 'installer')
    let initialization = 0
    const { cos, loopback } = await multipartFixture((request, response) => {
      if (request.path.startsWith(`/tflowbuddy/${names[failureAt - 1]}?`)) {
        initialization++
        answer(response, 403, cosError('AccessDenied', 'fixture-secret'))
        return true
      }
      return false
    })
    await expect(uploadReleaseInstallers(directory, releaseId, { bucket: 'fixture-1250000000', region: 'ap-guangzhou' }, cos)).rejects.toThrow(`COS upload failed: tflowbuddy/${names[failureAt - 1]}`)
    expect(initialization).toBe(6)
    expect(loopback.requests.some(request => request.path.endsWith('/VERSION'))).toBe(false)
  })
})
