/** Target Electron distribution preparation: official npm artifacts on macOS, digest-locked community archives on Windows. */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { downloadArtifact } from '@electron/get'
import extractZip from 'extract-zip'
import { resolveElectronRuntimeSource } from './electron-runtime.mjs'
import { desktopTargetPlatform } from './desktop-build-paths.mjs'
import type { DesktopBuildTarget } from './desktop-build-paths.mjs'

/** Runtime facts a packaging run records from the prepared target executable. */
export interface PreparedElectronRuntime {
  readonly executable: string
  readonly version: string
  readonly electronVersion: string
  readonly nodeVersion: string
}

/** Minimal fields of a pinned community release asset, as declared by the runtime source table. */
interface CommunityRuntimeSource {
  readonly kind: 'community'
  readonly platform: string
  readonly arch: string
  readonly version: string
  readonly url: string
  readonly archive: string
  readonly sha256: string
}

/**
 * Report the SHA-256 digest of one file, streaming so multi-hundred-megabyte archives stay cheap.
 * @param path - File to hash.
 * @returns Lowercase hex digest.
 */
export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

/**
 * Locate the cached copy of a community archive, keyed by target and expected digest so a
 * previously tampered or superseded asset can never be reused for another target.
 * @param cache - Shared immutable download cache directory.
 * @param target - Fixed Desktop build target the archive serves.
 * @param asset - Pinned asset name and digest from the runtime source table.
 * @returns Cache file path.
 */
export function runtimeArchiveCachePath(
  cache: string,
  target: string,
  asset: { readonly archive: string; readonly sha256: string },
): string {
  return join(cache, `electron-${target}-${asset.sha256}-${asset.archive}`)
}

/**
 * Download a pinned archive and recheck cached bytes before returning its path.
 * @param source - Release URL and required digest.
 * @param target - Target identifier used to isolate the cache.
 * @param cache - Download cache directory.
 * @returns Verified archive path; rejects HTTP and digest failures.
 */
export async function downloadCommunityArchive(
  source: CommunityRuntimeSource,
  target: string,
  cache: string,
): Promise<string> {
  mkdirSync(cache, { recursive: true })
  const cached = runtimeArchiveCachePath(cache, target, source)
  if (!existsSync(cached)) {
    const response = await fetch(source.url)
    if (!response.ok) {
      throw new Error(`desktop runtime: community Electron download failed with HTTP ${String(response.status)} for ${source.url}`)
    }
    const staging = mkdtempSync(join(cache, '.electron-download-'))
    const staged = join(staging, 'archive.zip')
    try {
      await writeFile(staged, new Uint8Array(await response.arrayBuffer()), { flag: 'wx', mode: 0o600 })
      const stagedDigest = await sha256File(staged)
      if (stagedDigest !== source.sha256) {
        throw new Error(`desktop runtime: community Electron digest mismatch for ${source.archive}: expected ${source.sha256}, got ${stagedDigest}`)
      }
      await rename(staged, cached)
    } finally {
      rmSync(staging, { recursive: true, force: true })
    }
  }
  // A cached archive is re-hashed on every preparation; the cache name keys the expected digest,
  // not a promise about its bytes.
  const digest = await sha256File(cached)
  if (digest !== source.sha256) {
    throw new Error(`desktop runtime: cached Electron archive digest mismatch for ${source.archive}: expected ${source.sha256}, got ${digest}`)
  }
  return cached
}

/**
 * Download, verify, extract, and query the complete Electron distribution for one build target.
 * @param target - Fixed Desktop build target.
 * @param electronDir - Target-owned directory the complete distribution extracts into.
 * @param cache - Shared immutable download cache.
 * @returns Prepared executable path plus the versions it reported under `ELECTRON_RUN_AS_NODE=1`.
 */
export async function prepareElectronRuntime(
  target: DesktopBuildTarget,
  electronDir: string,
  cache: string,
): Promise<PreparedElectronRuntime> {
  const { platform, arch } = desktopTargetPlatform(target)
  const source = resolveElectronRuntimeSource(platform, arch)
  let archive: string
  if (source.kind === 'official') {
    archive = await downloadArtifact({ version: source.version, platform, arch, artifactName: 'electron', cacheRoot: cache })
  } else {
    archive = await downloadCommunityArchive(source, target, cache)
  }
  rmSync(electronDir, { recursive: true, force: true })
  mkdirSync(electronDir, { recursive: true })
  await extractZip(archive, { dir: electronDir })
  const executable = join(electronDir, platform === 'win32' ? 'electron.exe' : 'Electron.app/Contents/MacOS/Electron')
  const facts = readElectronRuntimeFacts(executable, { platform, arch, version: source.version })
  return { executable, version: source.version, ...facts }
}

/**
 * Query and verify the prepared executable in Electron Node mode.
 * @param executable - Prepared target executable.
 * @param expected - Required release, platform and architecture.
 * @returns Reported versions and target identity; rejects mismatched executables.
 */
export function readElectronRuntimeFacts(
  executable: string,
  expected: { platform: string; arch: string; version: string },
): { electronVersion: string; nodeVersion: string; platform: string; arch: string } {
  const query = (expression: string): string => execFileSync(executable, ['-p', expression], {
    encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  }).trim()
  const facts = { electronVersion: query('process.versions.electron'), nodeVersion: query('process.versions.node'), platform: query('process.platform'), arch: query('process.arch') }
  if (facts.platform !== expected.platform || facts.arch !== expected.arch || facts.electronVersion !== expected.version) {
    throw new Error(`desktop runtime: prepared Electron does not match ${expected.platform}/${expected.arch} version ${expected.version}`)
  }
  return facts
}
