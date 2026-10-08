/** Prepare pinned, relocatable script interpreters without installing into the build host. */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { cp } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import extractZip from 'extract-zip'
import { x as extractTar } from 'tar'
import { parsePrimaryRuntime, workspaceDependencyPaths, type PrimaryRuntimeManifest } from '../../packages/skill/tool-workspace-dependencies/src/index.ts'
import lock from './lock.json' with { type: 'json' }

/**
 * Download or reuse an archive only when its bytes match the release lock.
 * @param url - Locked archive URL.
 * @param sha256 - Expected SHA-256 digest.
 * @param cache - Download cache directory.
 * @returns Verified local archive path.
 */
export async function downloadPrimaryRuntimeAsset(url: string, sha256: string, cache: string): Promise<string> {
  const destination = join(cache, sha256)
  let bytes: Buffer
  try { bytes = readFileSync(destination) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const response = await fetch(url)
    if (!response.ok) throw new Error(`primary runtime download: ${String(response.status)} ${url}`)
    bytes = Buffer.from(await response.arrayBuffer())
  }
  if (createHash('sha256').update(bytes).digest('hex') !== sha256) throw new Error(`primary runtime download: checksum mismatch for ${url}`)
  writeFileSync(destination, bytes)
  return destination
}

/**
 * Resolve one runtime archive URL against an optional mirror prefix.
 * @param upstream - Canonical release URL.
 * @param mirror - Mirror prefix from the packaging environment, or undefined.
 * @param suffix - Path appended to the mirror prefix.
 * @returns The URL to download.
 */
function runtimeAssetUrl(upstream: string, mirror: string | undefined, suffix: string): string {
  return mirror === undefined ? upstream : `${mirror.replace(/\/+$/u, '')}/${suffix}`
}

async function pythonArchive(target: keyof typeof lock.targets, cache: string): Promise<string> {
  const artifact = lock.targets[target]
  const filename = `cpython-${lock.pythonVersion}+${lock.pythonRelease}-${artifact.pythonTarget}-install_only_stripped.tar.gz`
  const upstream = `https://github.com/astral-sh/python-build-standalone/releases/download/${lock.pythonRelease}/${encodeURIComponent(filename)}`
  // A mirror stores release assets flat under the release tag, both spellings of
  // the `+` in the filename resolving to the same archive.
  return downloadPrimaryRuntimeAsset(
    runtimeAssetUrl(upstream, process.env.DSH_DESKTOP_PYTHON_MIRROR?.trim() || undefined,
      `${lock.pythonRelease}/${encodeURIComponent(filename)}`),
    artifact.pythonSha256, cache)
}

/**
 * Identify the inputs that assemble one target's payload, excluding unrelated target locks.
 * @param target - Runtime target whose archives are installed.
 * @param runtimeLock - Locked interpreter and wheel inputs.
 * @param compact - Whether the payload omits the entries {@link compactInterpreter} removes.
 * @returns SHA-256 payload identity for installation reuse.
 */
export function primaryRuntimePayloadDigest(
  target: keyof typeof lock.targets, runtimeLock: typeof lock, compact: boolean,
): string {
  const { pythonVersion, pythonRelease, wheels, pythonPackages } = runtimeLock
  // Identity preserves key order within the selected target, wheel records and distribution map, plus wheel-entry order.
  // Bump format when extraction or assembly changes payload bytes without changing locked inputs.
  return createHash('sha256').update(JSON.stringify({
    format: 5, target, pythonVersion, pythonRelease, artifact: runtimeLock.targets[target], wheels, pythonPackages, compact,
  })).digest('hex')
}

/** One directory's entries a compact payload removes; every rule must match, so an upstream layout change fails the build. */
interface CompactRule {
  readonly directory: string
  readonly entries: RegExp
}

/**
 * Remove pip, ensurepip, the IDLE and Tk GUI stack, and duplicate interpreter names from an extracted interpreter.
 * The single remaining Unix executable is `bin/python3`, the entry {@link workspaceDependencyPaths} returns; the
 * other names are byte-identical copies once the payload is materialized without links.
 * @param python - Extracted `python/` directory.
 * @param target - Target whose archive layout was extracted.
 * @throws When a rule matches nothing, which means the locked archive layout changed.
 */
export function compactInterpreter(python: string, target: PrimaryRuntimeTarget): void {
  const stdlib = target === 'win-x64' ? 'Lib' : join('lib', `python${lock.pythonVersion.split('.').slice(0, 2).join('.')}`)
  const gui = /^(?:ensurepip|idlelib|tkinter|turtledemo|turtle\.py)$/u
  const rules: CompactRule[] = [
    { directory: stdlib, entries: gui },
    { directory: join(stdlib, 'site-packages'), entries: /^pip(?:-[\d.]+\.dist-info)?$/u },
  ]
  if (target === 'win-x64') {
    rules.push({ directory: 'DLLs', entries: /^(?:_tkinter\.pyd|(?:tcl|tk)\d+t\.dll)$/u }, { directory: '.', entries: /^tcl$/u })
  } else {
    const executable = `python${lock.pythonVersion.split('.').slice(0, 2).join('.')}`
    // `bin/python3` is a link to the versioned executable in the archive; the executable takes its name.
    rmSync(join(python, 'bin', 'python3'))
    renameSync(join(python, 'bin', executable), join(python, 'bin', 'python3'))
    rules.push(
      { directory: 'bin', entries: /^(?!python3$)/u },
      { directory: 'lib', entries: /^(?:(?:itcl|tcl|tk|thread)[\d.]+|lib(?:tcl|tk)[\w.]*)$/u },
      { directory: join(stdlib, 'lib-dynload'), entries: /^_tkinter\./u },
    )
  }
  for (const rule of rules) {
    const directory = join(python, rule.directory)
    const matched = readdirSync(directory).filter(name => rule.entries.test(name))
    if (matched.length === 0) throw new Error(`primary runtime: compact rule ${String(rule.entries)} matched nothing in ${directory}`)
    for (const name of matched) rmSync(join(directory, name), { recursive: true, force: true })
  }
}

/**
 * Unpack a locked library wheel, retaining auxiliary scripts in its distribution data directory.
 * @param archive - Hash-verified wheel archive.
 * @param destination - Absolute site-packages directory.
 * @returns Resolves after extraction without command wrappers; rejects other wheel installation schemes.
 */
export async function unpackPrimaryRuntimeWheel(archive: string, destination: string): Promise<void> {
  await extractZip(archive, {
    dir: destination,
    onEntry: (entry) => {
      const [directory, scheme] = entry.fileName.split('/')
      if (directory?.endsWith('.data') && scheme !== '' && scheme !== 'scripts') {
        throw new Error(`primary runtime: wheel requires unsupported installation paths: ${entry.fileName}`)
      }
    },
  })
}

/**
 * Copy the skill package's complete asset tree to ordinary filesystem resources.
 * @param source - The package's assets directory.
 * @param destination - External Office skill resource directory.
 * @returns Resolves after replacing the external assets with the complete package tree.
 */
export async function prepareOfficeSkillAssets(source: string, destination: string): Promise<void> {
  rmSync(destination, { recursive: true, force: true })
  await cp(source, destination, { recursive: true, dereference: true })
}

/** A locked interpreter and wheel target. */
export type PrimaryRuntimeTarget = keyof typeof lock.targets

/** Build-only inputs shared by Desktop and SDK carriers; both carry Python only, and Desktop supplies Node.js and pnpm from Electron. */
export interface PreparePrimaryRuntimeOptions {
  /** Target whose archives and wheels are downloaded. */
  readonly target: PrimaryRuntimeTarget
  /** Resource directory receiving primary-runtime/ and office-skills/. */
  readonly output: string
  /** SHA-256-addressed archive cache. */
  readonly cache: string
  /** Carrier release recorded in the legacy desktopVersion manifest field. */
  readonly version: string
  /**
   * Remove pip, ensurepip, the IDLE and Tk GUI stack, and duplicate interpreter names (see {@link compactInterpreter}).
   * The single-file SDK keeps the complete interpreter.
   */
  readonly compact?: boolean
}

/**
 * Materialize locked interpreters, libraries and Office resources without executing target code.
 * @param options - Explicit target and carrier-owned output locations.
 * @returns Resolves after the complete payload and skills have been copied to the output directory.
 */
export async function preparePrimaryRuntime(options: PreparePrimaryRuntimeOptions): Promise<void> {
  const { target } = options
  const paths = { runtime: resolve(options.output), downloads: resolve(options.cache) }
  const artifact = lock.targets[target]
  mkdirSync(paths.runtime, { recursive: true })
  mkdirSync(paths.downloads, { recursive: true })
  const staging = mkdtempSync(join(tmpdir(), 'dsh-primary-'))
  try {
    const output = join(staging, 'payload')
    const dependencies = join(output, 'dependencies')
    mkdirSync(dependencies, { recursive: true })
    await extractTar({ file: await pythonArchive(target, paths.downloads), cwd: dependencies })
    const compact = options.compact === true
    if (compact) compactInterpreter(join(dependencies, 'python'), target)
    const manifest: PrimaryRuntimeManifest = {
      desktopVersion: options.version,
      platform: target === 'win-x64' ? 'win32' : target.startsWith('linux-') ? 'linux' : 'darwin',
      arch: target.endsWith('-arm64') ? 'arm64' : 'x64',
      payloadDigest: primaryRuntimePayloadDigest(target, lock, compact),
      python: lock.pythonVersion,
      pythonPackages: lock.pythonPackages,
    }
    const entries = workspaceDependencyPaths(output, manifest)
    for (const wheel of [...artifact.wheels, ...lock.wheels]) {
      await unpackPrimaryRuntimeWheel(await downloadPrimaryRuntimeAsset(wheel.url, wheel.sha256, paths.downloads), entries.pythonPackages)
    }
    writeFileSync(join(output, 'runtime.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
    const destination = join(paths.runtime, 'primary-runtime')
    rmSync(destination, { recursive: true, force: true })
    await cp(output, destination, { recursive: true, dereference: true })
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
  const require = createRequire(import.meta.url)
  await prepareOfficeSkillAssets(join(dirname(require.resolve('@deepseek-ai/dsh-skill-office/package.json')), 'assets'),
    join(paths.runtime, 'office-skills'))
}

/**
 * Execute the native payload's interpreter and Python libraries.
 * @param root - Final payload directory, including any platform signatures.
 * @param options - Whether the payload was prepared compact, and the scrubbed subprocess environment
 * (defaults to excluding credential-shaped names). A compact payload has no pip, so `pip check` cannot run;
 * the exact distribution set and version checks in `smoke.py` still apply.
 */
export function smokePrimaryRuntime(root: string, options: { readonly compact: boolean; readonly environment?: NodeJS.ProcessEnv }): void {
  const environment = options.environment ?? Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !/(?:KEY|SECRET|TOKEN|PASSWORD)/iu.test(name)),
  )
  const manifest = parsePrimaryRuntime(JSON.parse(readFileSync(join(root, 'runtime.json'), 'utf8')))
  if (manifest.platform !== process.platform || manifest.arch !== process.arch) return
  if (Object.keys(manifest.pythonPackages).length === 0) throw new Error('primary runtime: missing Python distribution versions; prepare the payload before running its smoke checks.')
  const entries = workspaceDependencyPaths(root, manifest)
  const execution = { stdio: 'inherit', timeout: 120_000, env: environment } as const
  execFileSync(entries.python, ['-I', '-B', '-c', 'import decimal, xml.parsers.expat, lzma, uuid, numpy, pandas; assert numpy.arange(4).sum() == 6; assert pandas.DataFrame({"n": [1, 2]}).n.sum() == 3'], execution)
  execFileSync(entries.python, ['-I', '-B', join(import.meta.dirname, 'smoke.py'), JSON.stringify(manifest.pythonPackages),
    manifest.python, join(dirname(root), 'office-skills', 'scripts', 'check_office.py'), options.compact ? 'compact' : 'complete'], execution)
  if (!options.compact) execFileSync(entries.python, ['-I', '-B', '-m', 'pip', 'check'], execution)
}

if (import.meta.main) {
  const { values } = parseArgs({ options: {
    target: { type: 'string' }, output: { type: 'string' }, cache: { type: 'string' },
  } })
  if (!values.target || !Object.hasOwn(lock.targets, values.target) || !values.output) {
    throw new Error(`Usage: pnpm run prepare:primary-runtime --target <${Object.keys(lock.targets).join('|')}> --output <directory> [--cache <directory>]`)
  }
  const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }
  const output = resolve(values.output)
  await preparePrimaryRuntime({
    target: values.target as PrimaryRuntimeTarget, output,
    cache: values.cache ?? join(tmpdir(), 'dsh-primary-runtime-downloads'), version,
  })
  smokePrimaryRuntime(join(output, 'primary-runtime'), { compact: false })
}
