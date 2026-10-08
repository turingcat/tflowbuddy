/** The independent product uses available hosted runners and its own main branch. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { load } from 'js-yaml'
const root = resolve(import.meta.dirname, '../..')
it('uses available hosted runners without upstream enterprise labels', () => {
  const workflow = load(readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8')) as { jobs: Record<string, { 'runs-on': string }> }
  for (const job of Object.values(workflow.jobs)) expect(['ubuntu-24.04', 'ubuntu-latest', 'windows-2025', 'macos-15']).toContain(job['runs-on'])
})
it('uses main for supported push workflows', () => {
  for (const file of ['sandbox.yml', 'node-addon-system.yml']) {
    const workflow = load(readFileSync(resolve(root, '.github/workflows', file), 'utf8')) as { on: { push: { branches: string[] } } }
    expect(workflow.on.push.branches).toEqual(['main'])
  }
})
