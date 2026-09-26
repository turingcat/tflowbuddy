/**
 * TFlowBuddy profile overlay helpers.
 *
 * The shipped desktop Host applies the overlay directly. This module keeps
 * profile seeding available to callers that create a local profile directory.
 * @module
 */

import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Profile patch filename shared boot layer reads from profile root. */
const PROFILE_PATCH_FILENAME = 'cordis.patch.yml'

/** Rows disabled by the TFlowBuddy edition. */
export const EDITION_DISABLED_ROWS = [
  { id: 'deepseek-account', reason: 'TFlow accounts use the TFlow panel' },
  { id: 'llm-deepseek', reason: 'the direct DeepSeek adapter is not used by TFlow accounts' },
] as const

/** Render the profile overlay consumed by the desktop Host. */
export function editionProfilePatch(): string {
  const rows = EDITION_DISABLED_ROWS
    .map(row => `# ${row.reason}\n- id: ${row.id}\n  disabled: true`)
    .join('\n\n')
  return `# Written by TFlowBuddy edition. Edits here are kept.\n\n${rows}\n`
}

/** Seed the overlay unless the profile already has a user patch. */
export function seedEditionProfilePatch(profileDirectory: string): boolean {
  const path = join(profileDirectory, PROFILE_PATCH_FILENAME)
  if (existsSync(path)) return false
  writeFileSync(path, editionProfilePatch(), { mode: 0o600 })
  return true
}
