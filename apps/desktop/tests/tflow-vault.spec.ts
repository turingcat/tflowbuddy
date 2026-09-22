import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Calls recorded against the stubbed platform vault. */
const sealed = vi.hoisted(() => ({ available: true, encrypted: [] as string[], decrypted: [] as Buffer[] }))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => sealed.available,
    encryptString: (value: string) => { sealed.encrypted.push(value); return Buffer.from(`sealed:${value}`, 'utf8') },
    decryptString: (value: Buffer) => {
      sealed.decrypted.push(value)
      const text = value.toString('utf8')
      if (!text.startsWith('sealed:')) throw new Error('not sealed by this platform')
      return text.slice('sealed:'.length)
    },
  },
}))

const { createCredentialFiles, createElectronVault } = await import('../src/tflow/vault.ts')

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'dsh-tflow-vault-'))
  sealed.available = true
  sealed.encrypted = []
  sealed.decrypted = []
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('createElectronVault', () => {
  it('reports the platform availability and delegates sealing to the platform', () => {
    const vault = createElectronVault()
    expect(vault.available()).toBe(true)
    expect(vault.encrypt('secret').toString('utf8')).toBe('sealed:secret')
    expect(vault.decrypt(Buffer.from('sealed:secret', 'utf8'))).toBe('secret')
    expect(sealed.encrypted).toEqual(['secret'])
  })

  it('reports an unavailable platform instead of pretending to seal', () => {
    sealed.available = false
    expect(createElectronVault().available()).toBe(false)
  })

  it('surfaces a secret the platform cannot unseal', () => {
    expect(() => createElectronVault().decrypt(Buffer.from('plaintext', 'utf8'))).toThrow(/not sealed by this platform/u)
  })
})

describe('createCredentialFiles', () => {
  it('reports an absence before anything is written', async () => {
    await expect(createCredentialFiles(join(directory, 'tflow-credentials.json')).read()).resolves.toBeUndefined()
  })

  it('writes the record owner-only and reads it back', async () => {
    const filename = join(directory, 'nested', 'tflow-credentials.json')
    const files = createCredentialFiles(filename)
    await files.write('{"version":1}\n')
    await expect(files.read()).resolves.toBe('{"version":1}\n')
    // Windows has no POSIX mode to inspect; the create API expresses the grant there.
    if (process.platform !== 'win32') {
      expect((await stat(filename)).mode & 0o777).toBe(0o600)
    }
  })

  it('replaces an existing record without leaving the staging file behind', async () => {
    const filename = join(directory, 'tflow-credentials.json')
    const files = createCredentialFiles(filename)
    await files.write('first\n')
    await files.write('second\n')
    await expect(files.read()).resolves.toBe('second\n')
    expect(existsSync(`${filename}.new`)).toBe(false)
    await expect(readFile(filename, 'utf8')).resolves.toBe('second\n')
  })

  it('removes the record and tolerates a repeated removal', async () => {
    const filename = join(directory, 'tflow-credentials.json')
    const files = createCredentialFiles(filename)
    await files.write('record\n')
    await files.remove()
    await expect(files.read()).resolves.toBeUndefined()
    await expect(files.remove()).resolves.toBeUndefined()
  })

  it('surfaces an unreadable path rather than reporting an absence', async () => {
    // A directory where a file is expected fails with something other than
    // ENOENT, which must not read as "no credential stored".
    const filename = join(directory, 'blocked.json')
    await mkdir(filename, { recursive: true })
    await expect(createCredentialFiles(filename).read()).rejects.toThrow()
  })
})
