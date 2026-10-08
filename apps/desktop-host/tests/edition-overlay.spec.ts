import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { expect, it } from 'vitest'

const OVERLAY = fileURLToPath(new URL('../edition.cordis.patch.yml', import.meta.url))
const BUNDLE_PATCHES = ['base', 'web-app']
  .map(bundle => readFileSync(fileURLToPath(new URL(`../../../packages/bundle/${bundle}/cordis.patch.yml`, import.meta.url)), 'utf8'))

it('disables the DeepSeek account launcher, account service, and model adapter', () => {
  // The DeepSeek launcher renders at a lower priority than the TFlow one and would show "not signed in".
  expect(loadOverlayPatches('dsh', OVERLAY)).toEqual([
    { id: 'ui-settings-account', disabled: true },
    { id: 'deepseek-account', disabled: true },
    { id: 'llm-deepseek', disabled: true },
    { id: 'office-to-pdf', disabled: { __jsExpr: "process.platform === 'win32' && process.arch === 'ia32'" } },
  ])
})

it('targets rows the shipped bundles declare, so a renamed row cannot stay enabled unnoticed', () => {
  for (const patch of loadOverlayPatches('dsh', OVERLAY)) {
    expect(BUNDLE_PATCHES.some(text => new RegExp(`^\\s*- id: ${String(patch.id)}$`, 'mu').test(text)), String(patch.id)).toBe(true)
  }
})

it('ships beside the built entry the Host resolves it from', () => {
  const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as { files: string[] }
  expect(manifest.files).toContain('edition.cordis.patch.yml')
})
