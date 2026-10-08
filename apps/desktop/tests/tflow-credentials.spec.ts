import { describe, expect, it, vi } from 'vitest'
import {
  TFLOW_CREDENTIAL_VERSION,
  createTFlowCredentialStore,
  createTFlowGroupPreferenceStore,
  decodeTFlowCredentials,
  encodeTFlowCredentials,
  type TFlowCredentials,
  type TFlowVault,
  type TFlowVaultFiles,
} from '../src/tflow/credentials.ts'

/** Reversible stand-in for the platform vault, tagging ciphertext so a leak is observable. */
function fakeVault(available = true): TFlowVault {
  return {
    available: () => available,
    encrypt: value => Buffer.from(`sealed:${value}`, 'utf8'),
    decrypt: (value) => {
      const text = value.toString('utf8')
      if (!text.startsWith('sealed:')) throw new Error('not sealed by this vault')
      return text.slice('sealed:'.length)
    },
  }
}

/** In-memory document location. */
function memoryFiles(initial?: string): TFlowVaultFiles & { text: string | undefined; writes: string[] } {
  const files = {
    text: initial,
    writes: [] as string[],
    read: () => Promise.resolve(files.text),
    write: (text: string) => { files.writes.push(text); files.text = text; return Promise.resolve() },
    remove: () => { files.text = undefined; return Promise.resolve() },
  }
  return files
}

const CREDENTIALS: TFlowCredentials = {
  session: { accessToken: 'access-token', refreshToken: 'refresh-token' },
  panelUrl: 'https://tflow.online',
  gatewayUrl: 'https://tflow.online/v1',
  modelKey: 'sk-model-key',
  groupId: '7',
}

describe('encodeTFlowCredentials', () => {
  it('seals both secrets and stores addresses in the clear', () => {
    const text = encodeTFlowCredentials(CREDENTIALS, fakeVault())
    const parsed: unknown = JSON.parse(text)
    expect(parsed).toMatchObject({
      version: TFLOW_CREDENTIAL_VERSION,
      siteKind: 'tflow',
      panelUrl: 'https://tflow.online',
      gatewayUrl: 'https://tflow.online/v1',
      groupId: '7',
    })
    expect(text).not.toContain('access-token')
    expect(text).not.toContain('refresh-token')
    expect(text).not.toContain('sk-model-key')
    expect(text.endsWith('\n')).toBe(true)
  })

  it('omits the optional fields a panel without them leaves unset', () => {
    const { groupId: _groupId, ...withoutGroup } = CREDENTIALS
    const parsed: Record<string, unknown> = JSON.parse(encodeTFlowCredentials({
      ...withoutGroup,
      session: { accessToken: 'access-token' },
    }, fakeVault()))
    expect('refreshToken' in parsed).toBe(false)
    expect('groupId' in parsed).toBe(false)
  })

  it('refuses to persist when the platform cannot encrypt', () => {
    expect(() => encodeTFlowCredentials(CREDENTIALS, fakeVault(false)))
      .toThrow(/vault is unavailable/u)
  })
})

describe('decodeTFlowCredentials', () => {
  it('round-trips a sealed record', () => {
    const text = encodeTFlowCredentials(CREDENTIALS, fakeVault())
    expect(decodeTFlowCredentials(JSON.parse(text), fakeVault())).toEqual(CREDENTIALS)
  })

  it('round-trips a record without the optional fields', () => {
    const minimal: TFlowCredentials = {
      session: { accessToken: 'access-token' },
      panelUrl: 'https://tflow.online',
      gatewayUrl: 'https://tflow.online/v1',
      modelKey: 'sk-model-key',
    }
    const text = encodeTFlowCredentials(minimal, fakeVault())
    expect(decodeTFlowCredentials(JSON.parse(text), fakeVault())).toEqual(minimal)
  })

  it('rejects a document that is not an object', () => {
    expect(() => decodeTFlowCredentials('nope', fakeVault())).toThrow(/must be an object/u)
    expect(() => decodeTFlowCredentials(null, fakeVault())).toThrow(/must be an object/u)
  })

  it.each([
    ['an unknown version', JSON.stringify({ version: 2, siteKind: 'tflow' }), /unsupported record version/u],
    ['another account site', JSON.stringify({ version: 1, siteKind: 'oa' }), /another account site/u],
    ['a missing panel address', JSON.stringify({ version: 1, siteKind: 'tflow', gatewayUrl: 'g' }), /panelUrl/u],
    ['a missing gateway address', JSON.stringify({ version: 1, siteKind: 'tflow', panelUrl: 'p' }), /gatewayUrl/u],
  ])('rejects %s', (_label, text, expected) => {
    expect(() => decodeTFlowCredentials(JSON.parse(text), fakeVault())).toThrow(expected)
  })

  it('rejects a record whose secrets are absent', () => {
    const parsed: Record<string, unknown> = JSON.parse(encodeTFlowCredentials(CREDENTIALS, fakeVault()))
    delete parsed['accessToken']
    expect(() => decodeTFlowCredentials(parsed, fakeVault())).toThrow(/accessToken/u)
  })

  it('rejects an empty sealed field', () => {
    const parsed: Record<string, unknown> = JSON.parse(encodeTFlowCredentials(CREDENTIALS, fakeVault()))
    parsed['modelKey'] = ''
    expect(() => decodeTFlowCredentials(parsed, fakeVault())).toThrow(/modelKey/u)
  })

  it('rejects a sealed field that decodes to no bytes', () => {
    const parsed: Record<string, unknown> = JSON.parse(encodeTFlowCredentials(CREDENTIALS, fakeVault()))
    parsed['modelKey'] = '===='
    expect(() => decodeTFlowCredentials(parsed, fakeVault())).toThrow(/not sealed content/u)
  })

  it('rejects an optional field present but empty', () => {
    const parsed: Record<string, unknown> = JSON.parse(encodeTFlowCredentials(CREDENTIALS, fakeVault()))
    parsed['groupId'] = ''
    expect(() => decodeTFlowCredentials(parsed, fakeVault())).toThrow(/groupId/u)
  })

  it('rejects a secret the vault cannot unseal', () => {
    const parsed: Record<string, unknown> = JSON.parse(encodeTFlowCredentials(CREDENTIALS, fakeVault()))
    parsed['accessToken'] = Buffer.from('plaintext', 'utf8').toString('base64')
    expect(() => decodeTFlowCredentials(parsed, fakeVault())).toThrow(/not sealed by this vault/u)
  })

  it('rejects a secret that unseals to nothing', () => {
    const vault: TFlowVault = { ...fakeVault(), decrypt: () => '' }
    const text = encodeTFlowCredentials(CREDENTIALS, fakeVault())
    expect(() => decodeTFlowCredentials(JSON.parse(text), vault)).toThrow(/decrypted to nothing/u)
  })
})

describe('createTFlowCredentialStore', () => {
  it('reports an absence before anything is stored', async () => {
    await expect(createTFlowCredentialStore(fakeVault(), memoryFiles()).load()).resolves.toEqual({ kind: 'absent' })
  })

  it('round-trips a written record and clears it again', async () => {
    const files = memoryFiles()
    const store = createTFlowCredentialStore(fakeVault(), files)
    await store.save(CREDENTIALS)
    await expect(store.load()).resolves.toEqual({ kind: 'stored', credentials: CREDENTIALS })
    await store.clear()
    await expect(store.load()).resolves.toEqual({ kind: 'absent' })
  })

  it('reports an unreadable document as unusable rather than as an absence', async () => {
    const store = createTFlowCredentialStore(fakeVault(), memoryFiles('{not json'))
    await expect(store.load()).resolves.toMatchObject({ kind: 'unusable', reason: expect.stringMatching(/not valid JSON/u) })
  })

  it('reports a well-formed document this build cannot trust as unusable', async () => {
    const store = createTFlowCredentialStore(fakeVault(), memoryFiles(JSON.stringify({ version: 9, siteKind: 'tflow' })))
    await expect(store.load()).resolves.toMatchObject({ kind: 'unusable', reason: expect.stringMatching(/unsupported record version/u) })
  })

  it('names the failure when a document decodes to a non-Error', async () => {
    const vault = fakeVault()
    vi.spyOn(vault, 'decrypt').mockImplementation(() => { throw 'boom' })
    const store = createTFlowCredentialStore(vault, memoryFiles(encodeTFlowCredentials(CREDENTIALS, fakeVault())))
    await expect(store.load()).resolves.toEqual({ kind: 'unusable', reason: 'the stored record is unusable' })
  })

  it('refuses a save the platform cannot seal', async () => {
    const files = memoryFiles()
    const store = createTFlowCredentialStore(fakeVault(false), files)
    await expect(store.save(CREDENTIALS)).rejects.toThrow(/vault is unavailable/u)
    expect(files.writes).toEqual([])
  })
})
describe('createTFlowGroupPreferenceStore', () => {
  it('round-trips a remembered group independently of credentials', async () => {
    const files = memoryFiles()
    const store = createTFlowGroupPreferenceStore(files)
    await store.save('7')
    await expect(store.load()).resolves.toBe('7')
  })
})
