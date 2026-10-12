/** Stage and publish the three first-party Desktop release installers. */
import { createHash } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import { copyFile, lstat, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { createDesktopCos } from '../apps/desktop/scripts/desktop-cos.ts'
import { isEntry } from './release/process.ts'

/** COS destination configured by the release Environment. */
export interface ReleaseDestination {
  readonly bucket: string
  readonly region: string
}

/**
 * Resolve installer names for one shared product version and Beijing timestamp.
 * @param releaseId - Product version followed by YYYYMMDDhhmm, without a leading v.
 * @returns Windows ia32, Windows x64, and macOS ARM64 filenames.
 */
export function releaseInstallerNames(releaseId: string): string[] {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?-\d{12}$/.test(releaseId)) {
    throw new Error('Expected release ID <product-version>-YYYYMMDDhhmm, without a leading v')
  }
  return [`TFlowBuddy-Win32-v${releaseId}.exe`, `TFlowBuddy-Win64-v${releaseId}.exe`, `TFlowBuddy-MacOS-v${releaseId}.dmg`]
}

/**
 * Copy one completed installer without changing the local packaging outputs.
 * @param target - Workflow build target.
 * @param releaseId - Shared release ID.
 * @param source - Completed unsigned-artifact directory.
 * @param output - Directory collected by upload-artifact.
 * @returns Copied public filename.
 */
export async function stageReleaseInstaller(target: string, releaseId: string, source: string, output: string): Promise<string> {
  const names = releaseInstallerNames(releaseId)
  const index = ['win-ia32', 'win-x64', 'mac-arm64'].indexOf(target)
  const name = names[index]
  if (name === undefined) throw new Error(`Unsupported release target: ${target}`)
  const extension = target === 'mac-arm64' ? 'dmg' : 'exe'
  const candidates = (await readdir(source)).filter(file => file.startsWith('tflowbuddy-') && file.endsWith(`.${extension}`))
  const [candidate] = candidates
  if (candidates.length !== 1 || candidate === undefined) throw new Error(`Expected exactly one ${extension} installer in ${source}`)
  const path = join(source, candidate)
  const file = await lstat(path)
  if (!file.isFile() || file.size === 0) throw new Error(`Expected a nonempty regular installer: ${path}`)
  await mkdir(output, { recursive: true })
  await copyFile(path, join(output, name), constants.COPYFILE_EXCL)
  return name
}

async function installerMetadata(path: string) {
  const file = await lstat(path)
  if (!file.isFile() || file.size === 0) throw new Error(`Expected a nonempty regular installer: ${path}`)
  const md5 = createHash('md5')
  for await (const bytes of createReadStream(path) as AsyncIterable<Buffer>) md5.update(bytes)
  return { size: file.size, md5: md5.digest('base64') }
}

/**
 * Upload the complete installer set, then replace the uncached VERSION object.
 * @param directory - Downloaded workflow artifact directory.
 * @param releaseId - Shared release ID.
 * @param destination - COS bucket and region.
 * @param cos - Caller-owned COS transport; streamed requests are not retried.
 * @returns Completion after all four PUTs succeed; failure stops later PUTs.
 */
export async function uploadReleaseInstallers(
  directory: string,
  releaseId: string,
  destination: ReleaseDestination,
  cos: ReturnType<typeof createDesktopCos>,
): Promise<void> {
  const names = releaseInstallerNames(releaseId)
  const files = (await readdir(directory)).sort()
  if (files.join('\n') !== [...names].sort().join('\n')) throw new Error('Expected the complete three-platform installer set, with no extra files')
  const artifacts = await Promise.all(names.map(async name => ({
    name, path: join(directory, name), ...await installerMetadata(join(directory, name)),
  })))
  const version = Buffer.from(`${releaseId}\n`)
  for (const artifact of [...artifacts, { name: 'VERSION', path: undefined, size: version.length, md5: createHash('md5').update(version).digest('base64') }]) {
    const key = `tflowbuddy/${artifact.name}`
    const body = artifact.path === undefined ? Readable.from([version]) : createReadStream(artifact.path)
    try {
      await cos.putObject({
        Bucket: destination.bucket,
        Region: destination.region,
        Key: key,
        Body: body,
        ContentLength: artifact.size,
        ContentType: artifact.path === undefined ? 'text/plain; charset=utf-8' : 'application/octet-stream',
        Headers: { 'Content-MD5': artifact.md5 },
        CacheControl: artifact.path === undefined ? 'no-store, no-cache, max-age=0, must-revalidate' : 'public, max-age=31536000, immutable',
      })
    } catch (_error) {
      // SDK errors may contain signed URLs and credentials; expose only the failed key.
      throw new Error(`COS PUT failed: ${key}; inspect remote state before rerunning`)
    } finally {
      body.destroy()
    }
    console.log(`Uploaded ${key}`)
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing release setting: ${name}`)
  return value
}

if (isEntry(import.meta.url)) {
  const [command, target, source, output] = process.argv.slice(2)
  const releaseId = requiredEnvironment('RELEASE_ID')
  if (command === 'stage' && target && source && output) {
    console.log(await stageReleaseInstaller(target, releaseId, source, output))
  } else if (command === 'upload' && target && source === undefined) {
    await uploadReleaseInstallers(target, releaseId, { bucket: requiredEnvironment('COS_BUCKET'), region: requiredEnvironment('COS_REGION') },
      createDesktopCos({ secretId: requiredEnvironment('COS_SECRET_ID'), secretKey: requiredEnvironment('COS_SECRET_KEY') }))
  } else {
    throw new Error('Usage: tflowbuddy-release.ts stage <target> <source> <output> | upload <directory>')
  }
}
