/**
 * Electron bindings for the TFlow credential record: the platform vault and the
 * document location.
 *
 * This is the only module in the TFlow flow that touches an Electron API, and
 * it is kept thin for that reason — the record's format and validation live in
 * `credentials.ts`, which runs without Electron.
 *
 * @module
 */

import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { safeStorage } from 'electron'
import type { TFlowVault, TFlowVaultFiles } from './credentials.ts'

/** Owner-only bits for the record: it holds a bearer token and a model key. */
const RECORD_MODE = 0o600
/** Owner-only bits for the directory holding it. */
const DIRECTORY_MODE = 0o700

/**
 * The platform secret vault.
 *
 * `safeStorage` reports itself unavailable before the application is ready and
 * on a platform with no usable backend; either way the record is refused rather
 * than written in the clear. The desktop product ships for macOS and Windows,
 * where the platform provides DPAPI or the login keychain.
 * @returns the vault over Electron's `safeStorage`.
 */
export function createElectronVault(): TFlowVault {
  return {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: value => safeStorage.encryptString(value),
    decrypt: value => safeStorage.decryptString(value),
  }
}

/**
 * Document operations for one credential record path.
 * @param filename - absolute path of the record.
 * @returns file operations for the credential store.
 */
export function createCredentialFiles(filename: string): TFlowVaultFiles {
  return {
    async read() {
      try {
        return await readFile(filename, 'utf8')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
      }
    },
    async write(text) {
      await mkdir(dirname(filename), { recursive: true, mode: DIRECTORY_MODE })
      // A rename over the target keeps a crash from leaving a half-written
      // record, and the mode is set on the new file before it replaces the old.
      const staging = `${filename}.new`
      await writeFile(staging, text, { mode: RECORD_MODE })
      await chmod(staging, RECORD_MODE)
      await rename(staging, filename)
    },
    async remove() {
      await rm(filename, { force: true })
    },
  }
}
