/** Desktop payloads carry Python only; Electron supplies Node.js and pnpm through the Host. */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { preparePrimaryRuntime, smokePrimaryRuntime } from '../scripts/prepare-primary-runtime.ts'

it('skips the primary runtime for the Windows ia32 edition', async () => {
  vi.stubEnv('DSH_DESKTOP_TARGET_PLATFORM', 'win32')
  vi.stubEnv('DSH_DESKTOP_TARGET_ARCH', 'ia32')
  try {
    await expect(preparePrimaryRuntime()).resolves.toBeUndefined()
  } finally { vi.unstubAllEnvs() }
})

it('rejects a native Desktop payload that still ships Node.js before executing interpreters', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-with-node-'))
  try {
    await writeFile(join(root, 'runtime.json'), JSON.stringify({
      desktopVersion: '1.0.0', platform: process.platform, arch: process.arch,
      python: '3.12.14', node: '24.21.0', pnpm: '11.7.0', pythonPackages: { numpy: '2.3.5', pandas: '3.0.1' },
    }))
    // The path query refuses a payload Node.js beside the Host's Electron launcher, so the build must not produce one.
    expect(() => { smokePrimaryRuntime(root) }).toThrow('Desktop payload must not ship Node.js or pnpm')
  } finally { await rm(root, { recursive: true, force: true }) }
})
