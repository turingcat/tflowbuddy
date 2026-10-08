/** Import upstream file differences without importing upstream commit ancestry. */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { checkProductVersions, normalizeProductVersions } from './product-version.ts'
import { isEntry } from './release/process.ts'

const repository = 'https://github.com/deepseek-ai/deepseek-harness.git'
function git(root: string, args: string[], input?: Buffer): Buffer {
  return execFileSync('git', args, { cwd: root, input, maxBuffer: 256 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] })
}
function text(root: string, ...args: string[]): string { return git(root, args).toString('utf8').trim() }

/**
 * Prepare an import on a new product branch; conflicts retain their index for review.
 * @param productRoot - Clean product main checkout.
 * @param upstreamRoot - Separate upstream Git checkout containing both revisions.
 * @param target - Upstream commit or ref; option-like refs are rejected.
 * @param branch - New product synchronization branch.
 * @returns Resolved revisions and whether changes were prepared; never commits or pushes.
 */
export async function prepareUpstreamImport(
  productRoot: string,
  upstreamRoot: string,
  target: string,
  branch: string,
): Promise<{ changed: boolean; base: string; target: string; branch: string }> {
  if (target.startsWith('-') || target.length === 0) throw new Error('Invalid upstream target')
  if (text(productRoot, 'status', '--porcelain') !== '') throw new Error('Product must be clean')
  if (text(productRoot, 'branch', '--show-current') !== 'main') throw new Error('Start on product main')
  for (const state of ['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD']) {
    if (existsSync(resolve(productRoot, text(productRoot, 'rev-parse', '--git-path', state)))) throw new Error(`Operation in progress: ${state}`)
  }
  const version = checkProductVersions(productRoot)
  const recordPath = join(productRoot, '.upstream/dsh.json')
  const record = JSON.parse(await readFile(recordPath, 'utf8')) as { repository?: unknown; revision?: unknown }
  if (record.repository !== repository || typeof record.revision !== 'string' || !/^[a-f0-9]{40}$/.test(record.revision)) throw new Error('Invalid upstream record')
  const base = text(upstreamRoot, 'rev-parse', '--verify', `${record.revision}^{commit}`)
  const resolved = text(upstreamRoot, 'rev-parse', '--verify', `${target}^{commit}`)
  if (spawnSync('git', ['merge-base', '--is-ancestor', base, resolved], { cwd: upstreamRoot }).status !== 0) throw new Error('Upstream target does not descend from recorded base')
  if (base === resolved) return { changed: false, base, target: resolved, branch }
  if (!branch.startsWith('sync/')) throw new Error('Use a sync/ branch')
  text(productRoot, 'check-ref-format', '--branch', branch)
  if (spawnSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: productRoot }).status === 0) throw new Error('Synchronization branch already exists')
  const patch = git(upstreamRoot, ['diff', '--binary', '--full-index', base, resolved])
  const raw = text(upstreamRoot, 'diff', '--raw', '--no-abbrev', base, resolved)
  for (const line of raw.split('\n').filter(Boolean)) {
    const fields = line.split(' ')
    const id = fields[2]
    if (fields[0] === ':160000' || fields[1] === '160000') throw new Error('Submodule changes require manual import')
    if (id !== undefined && !/^0+$/.test(id)) git(productRoot, ['hash-object', '-w', '--stdin'], git(upstreamRoot, ['cat-file', 'blob', id]))
  }
  text(productRoot, 'switch', '-c', branch)
  if (patch.length > 0) {
    const applied = spawnSync('git', ['apply', '--3way', '--index'], { cwd: productRoot, input: patch, maxBuffer: 256 * 1024 * 1024 })
    if (applied.status !== 0) throw new Error(`Import conflict or apply failure; resolve before advancing record:\n${applied.stderr.toString()}`)
  }
  const normalized = normalizeProductVersions(productRoot, version)
  checkProductVersions(productRoot)
  if (normalized.length > 0) git(productRoot, ['add', '--', ...normalized])
  writeFileSync(recordPath, `${JSON.stringify({ repository, revision: resolved }, null, 2)}\n`)
  text(productRoot, 'add', '--', '.upstream/dsh.json')
  return { changed: true, base, target: resolved, branch }
}

if (isEntry(import.meta.url)) {
  const { values } = parseArgs({ options: { 'upstream-dir': { type: 'string' }, target: { type: 'string' }, branch: { type: 'string' } } })
  if (!values['upstream-dir'] || !values.target || !values.branch) throw new Error('Usage: upstream-sync.ts --upstream-dir <directory> --target <revision> --branch sync/<name>')
  console.log(await prepareUpstreamImport(process.cwd(), values['upstream-dir'], values.target, values.branch))
}
