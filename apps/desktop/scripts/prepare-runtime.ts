/** Prepare the target Electron distribution, launcher scripts, and pinned pnpm CLI. */

import { packagingStep } from './packaging-step.mjs'
import { execFileSync } from 'node:child_process'
import { chmodSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { desktopTargetPlatform, resolveDesktopBuildTarget, resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { prepareElectronRuntime } from './prepare-electron-runtime.ts'
import { preparePrimaryRuntime } from './prepare-primary-runtime.ts'
import { prepareDesktopCli } from './prepare-cli.ts'
import { prepareCommandLink } from './prepare-command-link.ts'

const BUILD_PATHS = resolveDesktopTargetBuildPaths()
const RUNTIME_ROOT = BUILD_PATHS.runtime

/** Whether the selected target carries the Python/Office payload. */
export function shouldPreparePrimaryRuntime(target: { platform: string; arch: string }): boolean {
  return !(target.platform === 'win32' && target.arch === 'ia32')
}

function preparePnpm(): string {
  const require = createRequire(import.meta.url)
  const manifestPath = require.resolve('pnpm')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { version?: unknown }
  if (typeof manifest.version !== 'string') throw new Error('desktop runtime: pnpm manifest has no version')
  const packageDir = dirname(manifestPath)
  const destination = join(RUNTIME_ROOT, 'pnpm')
  rmSync(destination, { recursive: true, force: true })
  cpSync(packageDir, destination, { recursive: true })
  return manifest.version
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { 'defer-primary-runtime-smoke': { type: 'boolean', default: false } } })
  const target = resolveDesktopBuildTarget()
  const { platform, arch } = desktopTargetPlatform(target)
  const runtime = await packagingStep(process.env.DSH_DESKTOP_PACKAGING_RUN_DIR, 'prepare:electron',
    () => prepareElectronRuntime(target, BUILD_PATHS.electron, BUILD_PATHS.downloads))
  const nodeVersion = runtime.nodeVersion
  const macosMinimumVersion = platform === 'darwin' ? execFileSync('/usr/libexec/PlistBuddy',
    ['-c', 'Print LSMinimumSystemVersion', join(BUILD_PATHS.electron, 'Electron.app', 'Contents', 'Info.plist')], { encoding: 'utf8' }).trim() : undefined
  rmSync(RUNTIME_ROOT, { recursive: true, force: true })
  mkdirSync(RUNTIME_ROOT, { recursive: true })
  const pnpmVersion = preparePnpm()
  // Launcher scripts only: they exec the Electron binary named by DSH_DESKTOP_NODE_EXECUTABLE
  // with ELECTRON_RUN_AS_NODE=1, so the runtime never carries a second Node executable.
  cpSync(join(import.meta.dirname, 'node-bin'), join(RUNTIME_ROOT, 'bin'), { recursive: true })
  chmodSync(join(RUNTIME_ROOT, 'bin', 'node'), 0o755)
  writeFileSync(join(RUNTIME_ROOT, 'versions.json'), `${JSON.stringify({
    schemaVersion: 1,
    electron: runtime.electronVersion,
    platform,
    arch,
    node: nodeVersion,
    pnpm: pnpmVersion,
  }, undefined, 2)}\n`)
  await packagingStep(process.env.DSH_DESKTOP_PACKAGING_RUN_DIR, 'prepare:cli',
    async () => prepareDesktopCli(join(RUNTIME_ROOT, 'cli'), platform))
  if (macosMinimumVersion !== undefined && arch !== 'ia32') prepareCommandLink(join(RUNTIME_ROOT, 'cli'), arch, macosMinimumVersion)
  cpSync(join(import.meta.dirname, '..', 'lib', 'command-manager-entry.js'), join(RUNTIME_ROOT, 'cli', 'command-manager.js'))
  cpSync(join(import.meta.dirname, 'command-path.ps1'), join(RUNTIME_ROOT, 'cli', 'command-path.ps1'))
  if (shouldPreparePrimaryRuntime({ platform, arch })) {
    await packagingStep(process.env.DSH_DESKTOP_PACKAGING_RUN_DIR, 'prepare:primary-runtime',
      () => preparePrimaryRuntime({ deferSmoke: values['defer-primary-runtime-smoke'] }))
  }
}

await main()
