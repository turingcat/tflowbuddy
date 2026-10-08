/** Root workspace selection exercised through tsdown's directory discovery. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'tsdown'
import { expect, it, onTestFinished } from 'vitest'
import { tsdownWorkspace } from './tsdown-workspace.ts'

it('excludes the prebuilt dsh-pocket from both tsdown workspace faces', () => {
  for (const client of [false, true]) {
    const workspace = tsdownWorkspace(client)
    expect(workspace.exclude).toContain('vendor/dsh-pocket')
    expect(workspace.include).toContain('vendor/*')
    expect(workspace.include).toContain('packages/*/*')
  }
})

it.each([false, true])('builds ordinary workspaces without compiling prebuilt dsh-pocket (client: %s)', async (client) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-tsdown-workspace-'))
  onTestFinished(() => rmSync(root, { recursive: true, force: true }))
  const directories = ['vendor/cordis', 'vendor/dsh-pocket', 'vendor/dsh-pocket-extra', 'packages/core/runtime', 'apps/cli', 'apps/desktop-host']
  for (const dir of directories) {
    mkdirSync(join(root, dir), { recursive: true })
    writeFileSync(join(root, dir, 'package.json'), JSON.stringify({ name: dir.replaceAll('/', '-'), type: 'module' }))
    // Packages declare their own config, as the real workspace does: tsdown
    // resolves a config-less inline entry against the root rather than each
    // member, so a plain entry without a member config cannot resolve.
    if (dir === 'vendor/dsh-pocket') continue
    writeFileSync(join(root, dir, 'entry.js'), 'export const value = 42\n')
    writeFileSync(join(root, dir, 'tsdown.config.ts'),
      'export default { entry: ["entry.js"], outDir: "lib", dts: false }\n')
  }
  // Member configs carry each entry; the fixture tree has no root
  // tsdown.config.ts, so only the root's own load is off.
  const bundles = await build({
    cwd: root, config: false, workspace: tsdownWorkspace(client),
    outDir: 'lib', dts: false, report: false, logLevel: 'silent',
  })
  expect(bundles.map(bundle => bundle.config.pkg?.name).sort()).toEqual([
    'apps-cli', ...client ? [] : ['apps-desktop-host'], 'packages-core-runtime', 'vendor-cordis', 'vendor-dsh-pocket-extra',
  ].sort())
  expect(readFileSync(join(root, 'vendor/cordis/lib/entry.mjs'), 'utf8')).toContain('42')
})
