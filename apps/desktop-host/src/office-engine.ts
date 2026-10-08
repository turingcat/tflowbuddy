/** Resolve packaged Office engine manifests from their complete, unpacked resource directories. */
import { createRequire, registerHooks, type ModuleHooks } from 'node:module'
import { realpathSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * Locate the archive containing a packaged runtime.
 * @param runtimeDir - Prepared or ASAR-contained runtime directory.
 * @returns Parent archive path, or undefined for a prepared directory.
 */
export function runtimeArchivePath(runtimeDir: string): string | undefined {
  const parent = dirname(runtimeDir)
  return basename(parent) === 'app.asar' ? parent : undefined
}

/**
 * Keep engine executable and resource paths usable by native child processes outside Electron.
 * Hooks apply only to this thread; worker threads must install their own resolver.
 * @param runtimeDir - Prepared or ASAR-contained dsh runtime directory.
 * @returns Installed resolver for the Host lifetime, or undefined for a non-ASAR runtime.
 */
export function installOfficeEngineResolution(runtimeDir: string): ModuleHooks | undefined {
  if (runtimeArchivePath(runtimeDir) === undefined) return undefined
  const root = realpathSync(runtimeDir)
  const archive = dirname(root)
  const source = pathToFileURL(join(root, 'node_modules', '@deepseek-ai', 'libreoffice-kit-')).href
  const destination = pathToFileURL(join(`${archive}.unpacked`, relative(archive, root), 'node_modules', '@deepseek-ai', 'libreoffice-kit-')).href
  const physicalUrl = (specifier: string, url: string): string => {
    if (!url.startsWith('file:')) return url
    const engineRequest = /^@deepseek-ai\/libreoffice-kit-(?:darwin|win32|linux)-/u.test(specifier)
    const engineTarget = /\/node_modules\/@deepseek-ai\/libreoffice-kit-(?:darwin|win32|linux)-[^/]+\//u
      .test(new URL(url).pathname)
    if (!engineRequest && !engineTarget) return url
    const canonical = pathToFileURL(realpathSync(fileURLToPath(url))).href
    if (!canonical.startsWith(source)) {
      if (canonical.startsWith(pathToFileURL(archive + '/').href)) {
        throw new Error(`desktop Office engine resolved outside the runtime package directory: ${url}`)
      }
      return url
    }
    const physical = realpathSync(fileURLToPath(destination + canonical.slice(source.length)))
    return pathToFileURL(physical).href
  }
  const hook = registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context)
      return { ...resolved, url: physicalUrl(specifier, resolved.url) }
    },
  })
  // Electron 40's Node bypasses synchronous hooks for require.resolve.
  const cjs = createRequire(import.meta.url)('node:module') as {
    _resolveFilename(request: string, parent: NodeJS.Module | null | undefined, isMain?: boolean, options?: object): string
  }
  const original = cjs._resolveFilename.bind(cjs)
  const previous: typeof cjs._resolveFilename = Reflect.get(cjs, '_resolveFilename')
  const resolveFilename: typeof previous = (request, parent, isMain, options) => {
    const resolved = original(request, parent, isMain, options)
    if (!resolved.includes('libreoffice-kit-')) return resolved
    return fileURLToPath(physicalUrl(request, pathToFileURL(resolved).href))
  }
  cjs._resolveFilename = resolveFilename
  return {
    deregister() {
      if (cjs._resolveFilename === resolveFilename) cjs._resolveFilename = previous
      hook.deregister()
    },
  }
}
