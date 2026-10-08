/** Imports preserve product ancestry while applying upstream file changes. */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, readlinkSync, rmSync, writeFileSync, symlinkSync, chmodSync, statSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { prepareUpstreamImport } from './upstream-sync.ts'
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function git(root: string, ...args: string[]): string { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() }
function fixture(): { product: string; upstream: string; base: string } {
  const root = mkdtempSync(join(tmpdir(), 'upstream-sync-')); roots.push(root)
  const product = join(root, 'product'); const upstream = join(root, 'upstream')
  for (const directory of [product, upstream]) {
    mkdirSync(directory); git(directory, 'init', '-b', 'main'); git(directory, 'config', 'user.name', 'Fixture'); git(directory, 'config', 'user.email', 'fixture@example.invalid')
    writeFileSync(join(directory, 'package.json'), '{"version":"0.1.1"}\n')
    writeFileSync(join(directory, 'shared.txt'), 'one\ntwo\nthree\n')
    git(directory, 'add', '.'); git(directory, 'commit', '-m', directory === product ? 'Product snapshot' : 'Upstream base')
  }
  const base = git(upstream, 'rev-parse', 'HEAD')
  mkdirSync(join(product, '.upstream')); writeFileSync(join(product, '.upstream/dsh.json'), JSON.stringify({ repository: 'https://github.com/deepseek-ai/deepseek-harness.git', revision: base })+'\n')
  git(product, 'add', '.'); git(product, 'commit', '-m', 'Record base')
  return { product, upstream, base }
}
it('imports binary changes and dependencies without upstream ancestry and keeps the product version', async () => {
  const { product, upstream } = fixture()
  writeFileSync(join(product, 'custom.txt'), 'product'); git(product, 'add', '.'); git(product, 'commit', '-m', 'Custom')
  writeFileSync(join(upstream, 'shared.txt'), 'one\ntwo\nthree\nfour\n')
  writeFileSync(join(upstream, 'image.bin'), Buffer.from([0, 255, 1]))
  writeFileSync(join(upstream, 'package.json'), '{"version":"9.0.0","dependencies":{"third":"3.0.0"}}\n')
  git(upstream, 'add', '.'); git(upstream, 'commit', '-m', 'Update')
  const target = git(upstream, 'rev-parse', 'HEAD')
  expect(await prepareUpstreamImport(product, upstream, target, 'sync/dsh-test')).toMatchObject({ changed: true, target })
  expect(readFileSync(join(product, 'custom.txt'), 'utf8')).toBe('product')
  expect(readFileSync(join(product, 'image.bin'))).toEqual(Buffer.from([0, 255, 1]))
  expect(JSON.parse(readFileSync(join(product, 'package.json'), 'utf8'))).toEqual({ version: '0.1.1', dependencies: { third: '3.0.0' } })
  git(product, 'add', '.'); git(product, 'commit', '-m', 'Import'); git(product, 'switch', '-C', 'main')
  expect(git(product, 'rev-list', 'main').split('\n')).not.toContain(target)
  expect(await prepareUpstreamImport(product, upstream, target, 'sync/repeated')).toMatchObject({ changed: false })
  expect(git(product, 'branch', '--show-current')).toBe('main')
})
it('leaves the base record unchanged on conflict', async () => {
  const { product, upstream, base } = fixture()
  writeFileSync(join(product, 'shared.txt'), 'product\ntwo\nthree\n'); git(product, 'add', '.'); git(product, 'commit', '-m', 'Custom')
  writeFileSync(join(upstream, 'shared.txt'), 'upstream\ntwo\nthree\n'); git(upstream, 'add', '.'); git(upstream, 'commit', '-m', 'Update')
  await expect(prepareUpstreamImport(product, upstream, 'HEAD', 'sync/conflict')).rejects.toThrow('conflict')
  expect((JSON.parse(readFileSync(join(product, '.upstream/dsh.json'), 'utf8')) as { revision: string }).revision).toBe(base)
})
it('rejects dirty products and invalid targets without changing the recorded base', async () => {
  const { product, upstream, base } = fixture()
  writeFileSync(join(product, 'dirty.txt'), 'dirty')
  await expect(prepareUpstreamImport(product, upstream, 'HEAD', 'sync/dirty')).rejects.toThrow('clean')
  expect((JSON.parse(readFileSync(join(product, '.upstream/dsh.json'), 'utf8')) as { revision: string }).revision).toBe(base)
})

it('imports deletion, executable bits, symlinks and new first-party manifests', async () => {
  const { product, upstream } = fixture()
  writeFileSync(join(upstream, 'run.sh'), '#!/bin/sh\necho hello\n')
  chmodSync(join(upstream, 'run.sh'), 0o755)
  symlinkSync('run.sh', join(upstream, 'link'))
  unlinkSync(join(upstream, 'shared.txt'))
  mkdirSync(join(upstream, 'packages/new/private'), { recursive: true })
  writeFileSync(join(upstream, 'packages/new/private/package.json'), '{"version":"8.0.0","private":true}\n')
  git(upstream, 'add', '.'); git(upstream, 'commit', '-m', 'File changes')
  await prepareUpstreamImport(product, upstream, 'HEAD', 'sync/files')
  expect(readlinkSync(join(product, 'link'))).toBe('run.sh')
  expect(statSync(join(product, 'run.sh')).mode & 0o111).not.toBe(0)
  expect((JSON.parse(readFileSync(join(product, 'packages/new/private/package.json'), 'utf8')) as { version: string }).version).toBe('0.1.1')
  expect(git(product, 'diff', '--cached', '--name-status')).toContain('D\tshared.txt')
})
it('rejects divergent targets, invalid refs and existing branches', async () => {
  const { product, upstream } = fixture()
  git(upstream, 'switch', '--orphan', 'divergent')
  git(upstream, 'commit', '--allow-empty', '-m', 'Separate root')
  await expect(prepareUpstreamImport(product, upstream, 'HEAD', 'sync/divergent')).rejects.toThrow('descend')
  await expect(prepareUpstreamImport(product, upstream, '-bad', 'sync/bad')).rejects.toThrow('Invalid')
  git(upstream, 'switch', 'main'); git(upstream, 'commit', '--allow-empty', '-m', 'New target')
  git(product, 'branch', 'sync/existing')
  await expect(prepareUpstreamImport(product, upstream, 'HEAD', 'sync/existing')).rejects.toThrow('exists')
})
