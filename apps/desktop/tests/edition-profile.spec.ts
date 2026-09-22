import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EDITION_DISABLED_ROWS, editionProfilePatch, seedEditionProfilePatch } from '../src/edition-profile.ts'

let profile: string

beforeEach(async () => {
  profile = await mkdtemp(join(tmpdir(), 'dsh-edition-profile-'))
})

afterEach(async () => {
  await rm(profile, { recursive: true, force: true })
})

describe('editionProfilePatch', () => {
  it('disables every row the edition cannot serve, by the id the base bundle declares', () => {
    const patch = editionProfilePatch()
    for (const row of EDITION_DISABLED_ROWS) {
      expect(patch).toContain(`- id: ${row.id}\n  disabled: true`)
      expect(patch).toContain(row.reason)
    }
  })

  it('names each disabled row once', () => {
    const ids = EDITION_DISABLED_ROWS.map(row => row.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('carries no default model selection, which needs a catalog only a sign-in can supply', () => {
    expect(editionProfilePatch()).not.toContain('agent-default-model')
  })
})

describe('seedEditionProfilePatch', () => {
  it('writes the overlay when the profile has none', async () => {
    expect(seedEditionProfilePatch(profile)).toBe(true)
    await expect(readFile(join(profile, 'cordis.patch.yml'), 'utf8')).resolves.toBe(editionProfilePatch())
    // Windows has no POSIX mode to inspect; the create API expresses the grant there.
    if (process.platform !== 'win32') {
      expect((await stat(join(profile, 'cordis.patch.yml'))).mode & 0o777).toBe(0o600)
    }
  })

  it('keeps an overlay the user already owns', async () => {
    const path = join(profile, 'cordis.patch.yml')
    await writeFile(path, '- id: llm-deepseek\n  disabled: false\n')
    expect(seedEditionProfilePatch(profile)).toBe(false)
    await expect(readFile(path, 'utf8')).resolves.toBe('- id: llm-deepseek\n  disabled: false\n')
  })

  it('does not create the profile directory itself', () => {
    const missing = join(profile, 'absent')
    expect(() => seedEditionProfilePatch(missing)).toThrow()
    expect(existsSync(join(missing, 'cordis.patch.yml'))).toBe(false)
  })
})
