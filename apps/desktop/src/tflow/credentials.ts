/**
 * TFlow credential record: the panel session, the provisioned model key, and
 * the addresses they belong to, persisted as one versioned JSON document.
 *
 * The two secrets are sealed with the platform vault before they reach the
 * document, so a copied file yields ciphertext rather than a usable bearer
 * token. Everything stored in the clear is an address or an identifier the
 * process also writes into settings.
 *
 * @module
 */

import type { TFlowSession } from './types.ts'

/** Format version of the persisted record. */
export const TFLOW_CREDENTIAL_VERSION = 1

/** Platform secret vault, satisfied by Electron's `safeStorage`. */
export interface TFlowVault {
  /** Whether this platform can encrypt at all; a false result refuses every write. */
  available(): boolean
  /** @param value - plaintext secret. @returns sealed bytes. */
  encrypt(value: string): Buffer
  /** @param value - sealed bytes from {@link encrypt}. @returns the plaintext secret. */
  decrypt(value: Buffer): string
}

/** Filesystem operations the store needs; injected so the record logic is testable without Electron. */
export interface TFlowVaultFiles {
  /** @returns the stored document, or `undefined` when none has been written. */
  read(): Promise<string | undefined>
  /** @param text - complete document. */
  write(text: string): Promise<void>
  remove(): Promise<void>
}

/** Everything one signed-in TFlow session needs to reach the panel and the gateway. */
export interface TFlowCredentials {
  readonly session: TFlowSession
  /** Panel origin serving the account API. */
  readonly panelUrl: string
  /** Gateway root ending in `/v1`. */
  readonly gatewayUrl: string
  /** Provisioned model key the Host provider route resolves. */
  readonly modelKey: string
  /** Group the model key is bound to, when the panel reported one. */
  readonly groupId?: string
}

/** Outcome of validating and unsealing a stored document. */
export type TFlowCredentialLoad =
  | { readonly kind: 'absent' }
  | { readonly kind: 'stored'; readonly credentials: TFlowCredentials }
  /** The document cannot be trusted; the caller treats the user as signed out and asks for a new sign-in. */
  | { readonly kind: 'unusable'; readonly reason: string }

/** One decoded on-disk record. */
interface StoredRecord {
  readonly version: number
  readonly siteKind: string
  readonly panelUrl: string
  readonly gatewayUrl: string
  readonly groupId?: string
  readonly accessToken: Buffer
  readonly refreshToken?: Buffer
  readonly modelKey: Buffer
}

/** A JSON object, as every field of the record must be. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Require one non-empty string field. */
function requiredString(source: Record<string, unknown>, field: string): string {
  const value = source[field]
  if (typeof value !== 'string' || value === '') throw new Error(`field "${field}" must be a non-empty string`)
  return value
}

/** Read an optional non-empty string field. */
function optionalString(source: Record<string, unknown>, field: string): string | undefined {
  const value = source[field]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value === '') throw new Error(`field "${field}" must be a non-empty string when present`)
  return value
}

/** Decode one sealed field back into raw bytes. */
function sealedBytes(source: Record<string, unknown>, field: string): Buffer {
  const value = requiredString(source, field)
  const bytes = Buffer.from(value, 'base64')
  if (bytes.length === 0) throw new Error(`field "${field}" is not sealed content`)
  return bytes
}

/**
 * Validate one parsed document and unseal its secrets.
 * @param value - JSON-parsed document.
 * @param vault - platform vault.
 * @returns the credentials the process can use.
 * @throws Error naming the offending field when the document is not this version's contract.
 */
export function decodeTFlowCredentials(value: unknown, vault: TFlowVault): TFlowCredentials {
  if (!isRecord(value)) throw new Error('the record must be an object')
  if (value['version'] !== TFLOW_CREDENTIAL_VERSION) {
    throw new Error(`unsupported record version ${JSON.stringify(value['version'])}`)
  }
  if (value['siteKind'] !== 'tflow') throw new Error('the record belongs to another account site')
  const record: StoredRecord = {
    version: TFLOW_CREDENTIAL_VERSION,
    siteKind: 'tflow',
    panelUrl: requiredString(value, 'panelUrl'),
    gatewayUrl: requiredString(value, 'gatewayUrl'),
    accessToken: sealedBytes(value, 'accessToken'),
    modelKey: sealedBytes(value, 'modelKey'),
    ...(() => {
      const groupId = optionalString(value, 'groupId')
      const refreshToken = value['refreshToken'] === undefined ? undefined : sealedBytes(value, 'refreshToken')
      return {
        ...groupId === undefined ? {} : { groupId },
        ...refreshToken === undefined ? {} : { refreshToken },
      }
    })(),
  }
  const decrypted = (bytes: Buffer): string => {
    const plaintext = vault.decrypt(bytes)
    if (plaintext === '') throw new Error('a sealed secret decrypted to nothing')
    return plaintext
  }
  return {
    panelUrl: record.panelUrl,
    gatewayUrl: record.gatewayUrl,
    modelKey: decrypted(record.modelKey),
    ...record.groupId === undefined ? {} : { groupId: record.groupId },
    session: {
      accessToken: decrypted(record.accessToken),
      ...record.refreshToken === undefined ? {} : { refreshToken: decrypted(record.refreshToken) },
    },
  }
}

/**
 * Seal one credential set into the document this build writes.
 * @param credentials - credentials to persist.
 * @param vault - platform vault that must report itself available.
 * @returns the document text.
 * @throws Error when the platform cannot encrypt, because a record written in the clear would defeat the store.
 */
export function encodeTFlowCredentials(credentials: TFlowCredentials, vault: TFlowVault): string {
  if (!vault.available()) throw new Error('the platform secret vault is unavailable, so TFlow credentials cannot be stored')
  const seal = (value: string): string => vault.encrypt(value).toString('base64')
  const document = {
    version: TFLOW_CREDENTIAL_VERSION,
    siteKind: 'tflow',
    panelUrl: credentials.panelUrl,
    gatewayUrl: credentials.gatewayUrl,
    accessToken: seal(credentials.session.accessToken),
    modelKey: seal(credentials.modelKey),
    ...credentials.groupId === undefined ? {} : { groupId: credentials.groupId },
    ...credentials.session.refreshToken === undefined ? {} : { refreshToken: seal(credentials.session.refreshToken) },
  }
  return `${JSON.stringify(document, null, 2)}\n`
}

/** The credential store the shell uses for one installation. */
export interface TFlowCredentialStore {
  /** @returns the stored credentials, an absence, or a document this build cannot trust. */
  load(): Promise<TFlowCredentialLoad>
  /** @param credentials - complete record to replace any previous one with. */
  save(credentials: TFlowCredentials): Promise<void>
  /** Remove the record; a subsequent {@link load} reports absence. */
  clear(): Promise<void>
}

/**
 * Build the credential store over one platform vault and one document location.
 * @param vault - platform secret vault.
 * @param files - document operations for the record's location.
 * @returns the store.
 */
export function createTFlowCredentialStore(vault: TFlowVault, files: TFlowVaultFiles): TFlowCredentialStore {
  const load = async (): Promise<TFlowCredentialLoad> => {
    const text = await files.read()
    if (text === undefined) return { kind: 'absent' }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return { kind: 'unusable', reason: 'the stored record is not valid JSON' }
    }
    try {
      return { kind: 'stored', credentials: decodeTFlowCredentials(parsed, vault) }
    } catch (error) {
      return { kind: 'unusable', reason: error instanceof Error ? error.message : 'the stored record is unusable' }
    }
  }
  return {
    load,
    async save(credentials) {
      await files.write(encodeTFlowCredentials(credentials, vault))
    },
    clear: () => files.remove(),
  }
}
