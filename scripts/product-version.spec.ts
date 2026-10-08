/** Product release numbering remains independent of imported upstream releases. */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { checkProductVersions, normalizeProductVersions } from './product-version.ts'
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'product-version-'))
  roots.push(root)
  for (const [path, version] of Object.entries({ 'package.json': '0.1.1', 'apps/desktop/package.json': '0.1.1', 'packages/example/private/package.json': '0.2.1-alpha.1', 'vendor/example/package.json': '2.10.6' })) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), `${JSON.stringify({ version, dependencies: { third: '8.0.0' } }, null, 2)}\n`)
  }
  return root
}
it('normalizes imported private and new packages without changing dependencies or vendors', () => {
  const root = fixture()
  expect(() => checkProductVersions(root)).toThrow('packages/example/private/package.json')
  expect(normalizeProductVersions(root, '0.1.1')).toEqual(['packages/example/private/package.json'])
  expect(checkProductVersions(root, 'v0.1.1')).toBe('0.1.1')
  expect(() => checkProductVersions(root, 'v0.1.2')).toThrow()
  expect((JSON.parse(readFileSync(join(root, 'vendor/example/package.json'), 'utf8')) as { version: string }).version).toBe('2.10.6')
  expect((JSON.parse(readFileSync(join(root, 'packages/example/private/package.json'), 'utf8')) as { dependencies: { third: string } }).dependencies.third).toBe('8.0.0')
  expect(normalizeProductVersions(root, '0.1.1')).toEqual([])
})
it('rejects invalid versions before writing any files', () => {
  const root = fixture()
  const before = readFileSync(join(root, 'package.json'), 'utf8')
  expect(() => normalizeProductVersions(root, 'garbage')).toThrow()
  expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(before)
})
it('changes only the top-level version when nested metadata comes first', () => {
  const root = fixture()
  writeFileSync(join(root, 'package.json'), '{"config":{"version":"third-party"},"version":"8.0.0"}\n')
  normalizeProductVersions(root, '0.1.1')
  expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))).toEqual({ config: { version: 'third-party' }, version: '0.1.1' })
})
