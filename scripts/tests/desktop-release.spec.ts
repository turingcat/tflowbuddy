/** TFlowBuddy publishes only complete desktop installers. */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { load } from 'js-yaml'
import { afterEach, describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')

interface ReleaseWorkflow {
  on: { push: { tags: string[] }; workflow_dispatch: null }
  jobs: Record<string, {
    if?: string
    needs?: string | string[]
    environment?: string
    env?: Record<string, string>
    defaults?: { run: { shell: string } }
    strategy?: { matrix: { include: Array<{ target: string; platform: string; arch: string; extension: string; shell: string }> } }
    steps: Array<{ name?: string; uses?: string; run?: string; with?: Record<string, string> }>
  }>
}

const workflow = load(readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8')) as ReleaseWorkflow
const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function resolveMetadata(tag: string) {
  const directory = mkdtempSync(resolve(tmpdir(), 'tflowbuddy-release-metadata-'))
  directories.push(directory)
  mkdirSync(resolve(directory, 'apps/desktop'), { recursive: true })
  for (const path of ['package.json', 'apps/desktop/package.json']) {
    writeFileSync(resolve(directory, path), JSON.stringify({ version: '0.1.1' }))
  }
  const output = resolve(directory, 'output')
  writeFileSync(output, '')
  const run = workflow.jobs.metadata!.steps.find(step => step.name === 'Resolve release ID')!.run!
  const script = run.trim().split('\n').slice(1, -1).join('\n')
  const result = spawnSync(process.execPath, ['--input-type=module'], {
    cwd: directory,
    encoding: 'utf8',
    input: `Date.now = () => Date.parse('2026-10-11T12:09:00Z');\n${script}`,
    env: { GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: tag, GITHUB_OUTPUT: output },
    timeout: 10_000,
  })
  expect(result.error).toBeUndefined()
  expect(result.signal).toBeNull()
  return { result, output: readFileSync(output, 'utf8') }
}

function verifyRecoverySource(overrides: {
  runId?: string
  releaseId?: string
  path?: string
  event?: string
  branch?: string
  status?: string
  failedTarget?: string
} = {}) {
  const directory = mkdtempSync(resolve(tmpdir(), 'tflowbuddy-recovery-source-'))
  directories.push(directory)
  writeFileSync(resolve(directory, 'package.json'), JSON.stringify({ version: '0.1.1' }))
  const recovery = load(readFileSync(resolve(root, '.github/workflows/upload-release.yml'), 'utf8')) as {
    jobs: ReleaseWorkflow['jobs']
  }
  const run = recovery.jobs.upload!.steps.find(step => step.name === 'Verify source release run')!.run!
  const source = { path: overrides.path ?? '.github/workflows/release.yml', event: overrides.event ?? 'push',
    head_branch: overrides.branch ?? 'v0.1.1', status: overrides.status ?? 'completed', head_sha: 'fixture' }
  const jobs = ['win-ia32', 'win-x64', 'mac-arm64'].map(target => ({ name: `Desktop / ${target}`,
    conclusion: target === overrides.failedTarget ? 'failure' : 'success' }))
  // Replace only the external GitHub read; execute the workflow's actual validation.
  const script = run.trim().split('\n').slice(1, -1).join('\n').replace(
    "import { execFileSync } from 'node:child_process';",
    `const execFileSync = (_command, args) => JSON.stringify(args[1].includes('/jobs?') ? ${JSON.stringify({ jobs })} : ${JSON.stringify(source)});`,
  )
  const result = spawnSync(process.execPath, ['--input-type=module'], { cwd: directory, encoding: 'utf8', input: script,
    env: { SOURCE_RUN_ID: overrides.runId ?? '123', RELEASE_ID: overrides.releaseId ?? '0.1.1-202610112009', GH_REPO: 'fixture/repo' },
    timeout: 10_000 })
  expect(result.error).toBeUndefined()
  expect(result.signal).toBeNull()
  return result
}

describe('TFlowBuddy desktop release', () => {
  it('accepts a completed tagged source run whose three installer builds succeeded', () => {
    const result = verifyRecoverySource()
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('Verified installer artifacts from release run 123')
  })

  it.each([
    { runId: '../123' }, { releaseId: '0.1.2-202610112009' }, { releaseId: '0.1.1-20261011' },
    { path: '.github/workflows/untrusted.yml' }, { event: 'workflow_dispatch' }, { branch: 'main' },
    { status: 'in_progress' }, { failedTarget: 'win-ia32' },
  ])('refuses an incompatible recovery source before downloading artifacts: %j', (overrides) => {
    const result = verifyRecoverySource(overrides)
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
  })

  it('recovers COS publication from retained artifacts without rebuilding or uploading GitHub assets', () => {
    const recovery = load(readFileSync(resolve(root, '.github/workflows/upload-release.yml'), 'utf8')) as {
      permissions: { actions: string; contents: string }
      concurrency: { group: string; 'cancel-in-progress': boolean }
      jobs: ReleaseWorkflow['jobs']
    }
    expect(recovery.permissions).toEqual({ contents: 'read', actions: 'read' })
    expect(recovery.concurrency).toEqual({ group: 'desktop-release', 'cancel-in-progress': false })
    expect(Object.keys(recovery.jobs)).toEqual(['upload'])
    const job = recovery.jobs.upload!
    expect(job.environment).toBe('release')
    const download = job.steps.find(step => step.uses === 'actions/download-artifact@v4')!
    expect(download.with?.['run-id']).toBe('${{ inputs.source_run_id }}')
    expect(download.with?.['github-token']).toBe('${{ github.token }}')
    expect(job.steps.at(-1)?.run).toBe('pnpm exec tsx scripts/tflowbuddy-release.ts upload installers')
    expect(job.steps.some(step => step.run?.includes('gh release upload') || step.run?.includes('run package'))).toBe(false)
  })

  it('resolves the product tag and one Beijing-time suffix before matrix builds', () => {
    const { result, output } = resolveMetadata('v0.1.1')
    expect(result.status, result.stderr).toBe(0)
    expect(output).toBe('release_id=0.1.1-202610112009\n')
  })

  it('refuses a tag that differs from the product version without emitting a release ID', () => {
    const { result, output } = resolveMetadata('v0.1.0')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Release tag must be v0.1.1')
    expect(output).toBe('')
  })

  it('builds Windows x64, Windows ia32, and macOS Apple Silicon installers', () => {
    expect(Object.keys(workflow.jobs)).toEqual(['metadata', 'desktop', 'publish'])
    expect(workflow.jobs.desktop!.strategy!.matrix.include).toMatchObject([
      { target: 'win-x64', platform: 'win32', arch: 'x64', extension: 'exe' },
      { target: 'win-ia32', platform: 'win32', arch: 'ia32', extension: 'exe' },
      { target: 'mac-arm64', platform: 'darwin', arch: 'arm64', extension: 'dmg' },
    ])
  })

  it('uses the complete runtime preparation and smoke checks before uploading installers', () => {
    const steps = workflow.jobs.desktop!.steps
    const packageStep = steps.findIndex(step => step.name === 'Package desktop with bundled runtime')
    const uploadStep = steps.findIndex(step => step.uses === 'actions/upload-artifact@v4')
    expect(steps[packageStep]!.run).toBe('pnpm --dir apps/desktop run package ${{ matrix.target }} --unsigned')
    expect(uploadStep).toBeGreaterThan(packageStep)
    expect(steps[uploadStep]!.with?.path).toBe('apps/desktop/.desktop-build/release-installers/${{ matrix.target }}/*')
    expect(steps[uploadStep]!.with?.['if-no-files-found']).toBe('error')
  })

  it('allows the pinned Electron installer to prepare the development runtime', () => {
    const workspace = load(readFileSync(resolve(root, 'pnpm-workspace.yaml'), 'utf8')) as {
      allowBuilds: Record<string, boolean>
    }
    expect(workspace.allowBuilds.electron).toBe(true)
  })

  it('runs Windows packaging in native PowerShell and checks runtime sources before packaging', () => {
    const job = workflow.jobs.desktop!
    const rows = job.strategy!.matrix.include
    expect(rows.find(row => row.target === 'win-x64')?.shell).toBe('pwsh')
    expect(rows.find(row => row.target === 'mac-arm64')?.shell).toBe('bash')
    expect(job.defaults?.run.shell).toBe('${{ matrix.shell }}')
    const steps = job.steps
    const verify = steps.find(step => step.name === 'Verify release version and build host')!.run!
    expect(verify).toContain('resolveElectronRuntimeSource')
    expect(verify).not.toContain("<<'JS'")
    const tests = steps.findIndex(step => step.name === 'Test desktop runtime packaging')
    expect(tests).toBeGreaterThan(steps.findIndex(step => step.name === 'Install dependencies'))
    expect(tests).toBeLessThan(steps.findIndex(step => step.name === 'Package desktop with bundled runtime'))
  })

  it('publishes only after all installers pass and only from product version tags', () => {
    expect(workflow.on.push.tags).toEqual(['v*'])
    const publish = workflow.jobs.publish!
    expect(publish.needs).toEqual(['metadata', 'desktop'])
    expect(publish.if).toBe("startsWith(github.ref, 'refs/tags/v')")
    const command = publish.steps.find(step => step.name === 'Publish GitHub release')!.run!
    expect(command).toContain('${#installers[@]}" -ne 3')
    expect(command).toContain('--verify-tag')
    expect(command).not.toContain('--clobber')
  })

  it('uses a shared release ID and the configured release Environment for COS publication', () => {
    expect(workflow.jobs.desktop!.needs).toBe('metadata')
    expect(workflow.jobs.desktop!.env?.RELEASE_ID).toBe('${{ needs.metadata.outputs.release_id }}')
    const publish = workflow.jobs.publish!
    expect(publish.environment).toBe('release')
    expect(publish.env?.RELEASE_ID).toBe('${{ needs.metadata.outputs.release_id }}')
    const steps = publish.steps
    expect(steps.findIndex(step => step.name === 'Upload installers and VERSION to Tencent COS'))
      .toBeGreaterThan(steps.findIndex(step => step.name === 'Publish GitHub release'))
    expect(steps.find(step => step.name === 'Upload installers and VERSION to Tencent COS')?.run)
      .toBe('pnpm exec tsx scripts/tflowbuddy-release.ts upload installers')
  })

  it('has no standalone package or Python runtime release workflows', () => {
    for (const file of [
      'release-publish.yml', 'release-vendor.yml', 'release-vendor-publish.yml',
      'python-release.yml', 'node-addon-system-release.yml', 'build-exe-for-python-sdk.yml',
    ]) expect(existsSync(resolve(root, '.github/workflows', file))).toBe(false)
  })
})
