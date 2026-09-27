/** TFlowBuddy publishes only complete desktop installers. */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')

interface ReleaseWorkflow {
  on: { push: { tags: string[] }; workflow_dispatch: null }
  jobs: Record<string, {
    if?: string
    needs?: string
    strategy?: { matrix: { include: Array<{ target: string; platform: string; arch: string; extension: string }> } }
    steps: Array<{ name?: string; uses?: string; run?: string; with?: Record<string, string> }>
  }>
}

const workflow = load(readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8')) as ReleaseWorkflow

describe('TFlowBuddy desktop release', () => {
  it('builds only Windows x64 and macOS Apple Silicon installers', () => {
    expect(Object.keys(workflow.jobs)).toEqual(['desktop', 'publish'])
    expect(workflow.jobs.desktop!.strategy!.matrix.include).toMatchObject([
      { target: 'win-x64', platform: 'win32', arch: 'x64', extension: 'exe' },
      { target: 'mac-arm64', platform: 'darwin', arch: 'arm64', extension: 'dmg' },
    ])
  })

  it('uses the complete runtime preparation and smoke checks before uploading installers', () => {
    const steps = workflow.jobs.desktop!.steps
    const packageStep = steps.findIndex(step => step.name === 'Package desktop with bundled runtime')
    const uploadStep = steps.findIndex(step => step.uses === 'actions/upload-artifact@v4')
    expect(steps[packageStep]!.run).toBe('pnpm --dir apps/desktop run package ${{ matrix.target }} --unsigned')
    expect(uploadStep).toBeGreaterThan(packageStep)
    expect(steps[uploadStep]!.with?.path).toContain('/unsigned-artifacts/tflowbuddy-*.${{ matrix.extension }}')
    expect(steps[uploadStep]!.with?.['if-no-files-found']).toBe('error')
  })

  it('publishes only after both installers pass and only from product version tags', () => {
    expect(workflow.on.push.tags).toEqual(['v*'])
    const publish = workflow.jobs.publish!
    expect(publish.needs).toBe('desktop')
    expect(publish.if).toBe("startsWith(github.ref, 'refs/tags/v')")
    const command = publish.steps.find(step => step.name === 'Publish GitHub release')!.run!
    expect(command).toContain('${#installers[@]}" -ne 2')
    expect(command).toContain('--verify-tag')
    expect(command).not.toContain('--clobber')
  })

  it('has no standalone package or Python runtime release workflows', () => {
    for (const file of [
      'release-publish.yml', 'release-vendor.yml', 'release-vendor-publish.yml',
      'python-release.yml', 'node-addon-system-release.yml', 'build-exe-for-python-sdk.yml',
    ]) expect(existsSync(resolve(root, '.github/workflows', file))).toBe(false)
  })
})
