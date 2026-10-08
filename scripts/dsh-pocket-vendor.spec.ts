import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const packageDirectory = join(root, 'vendor', 'dsh-pocket')

it('pins the reviewed dsh-pocket release with its original licenses', async () => {
  const manifest = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8')) as {
    name: string
    version: string
    license: string
    files: string[]
    peerDependencies: Record<string, string>
    devDependencies: Record<string, string>
  }
  expect(manifest).toMatchObject({ name: 'dsh-pocket', version: '2.10.6', license: 'GPL-2.0' })
  expect(manifest.files).toEqual(['bin', 'lib', 'client', 'cordis.patch.yml', 'README.md', 'LICENSE'])
  expect(manifest.peerDependencies).toEqual({ '@deepseek-ai/cordis': '^4.0.1' })
  expect(manifest.devDependencies).toEqual({
    '@deepseek-ai/cordis': 'workspace:~',
    esbuild: '^0.25.9',
    ws: '^8.18.0',
  })

  const license = await readFile(join(packageDirectory, 'LICENSE'), 'utf8')
  expect(license).toMatch(/^\s*GNU GENERAL PUBLIC LICENSE\r?\n\s*Version 2, June 1991\r?\n/u)

  const mobileLicense = await readFile(join(packageDirectory, 'client', 'mobile', 'LICENSE.dsh-web-mobile'), 'utf8')
  expect(mobileLicense).toMatch(/MIT License .*dsh-web-mobile\/blob\/main\/LICENSE/u)

  const vendorManifest = await readFile(join(root, 'vendor', 'README.md'), 'utf8')
  expect(vendorManifest).toContain(
    '| `dsh-pocket/` | `dsh-pocket` | `dsh-pocket` | 2.10.6 | https://github.com/shaobeichen/dsh-pocket | `c21a3457a820cb727d0480d8cbf7fa12372fe264` |',
  )
})
