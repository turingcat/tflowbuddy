/**
 * Edition overlay for the Desktop profile.
 *
 * The shared base bundle registers the DeepSeek account service and the direct
 * DeepSeek model adapter. A TFlowBuddy reader has no DeepSeek account, so those
 * rows would present sign-in and model entries that fail on first use. The
 * overlay disables them by the ids the base patch declares
 * (`packages/bundle/base/cordis.patch.yml`), which is the profile's own
 * `cordis.patch.yml` and takes precedence over every bundle layer.
 *
 * The default model selection is left alone: `agent-default-model` requires a
 * provider and a model, and the TFlow route's catalog is only known after a
 * sign-in, so the selection is not this file's to guess.
 *
 * @module
 */

import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Profile patch filename the shared boot layer reads from the profile root. */
const PROFILE_PATCH_FILENAME = 'cordis.patch.yml'

/**
 * Rows the TFlowBuddy edition disables, each with why it must not load.
 * Kept as data so the profile patch and its test describe the same set.
 */
export const EDITION_DISABLED_ROWS: readonly { readonly id: string, readonly reason: string }[] = [
  { id: 'deepseek-account', reason: 'TFlow accounts sign in through the TFlow panel, not the DeepSeek Platform' },
  { id: 'llm-deepseek', reason: 'the direct DeepSeek adapter serves a provider and models this account cannot reach' },
]

/**
 * Render the edition overlay.
 * @returns the profile patch document.
 */
export function editionProfilePatch(): string {
  const rows = EDITION_DISABLED_ROWS
    .map(row => `# ${row.reason}\n- id: ${row.id}\n  disabled: true`)
    .join('\n\n')
  return `# Written by the TFlowBuddy edition. Edits here are kept.\n\n${rows}\n`
}

/**
 * Seed the edition overlay into a profile that does not have one yet.
 *
 * An existing patch is never touched: it belongs to the user, and the profile
 * transactions and recovery both treat it as theirs. A patch the user has
 * edited therefore loses these defaults, which is the correct outcome for a
 * file only they are meant to change.
 * @param profileDirectory - Desktop profile directory.
 * @returns whether this call created the overlay.
 */
export function seedEditionProfilePatch(profileDirectory: string): boolean {
  const path = join(profileDirectory, PROFILE_PATCH_FILENAME)
  if (existsSync(path)) return false
  writeFileSync(path, editionProfilePatch(), { mode: 0o600 })
  return true
}
