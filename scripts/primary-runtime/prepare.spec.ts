import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { zipSync } from 'fflate'
import { expect, it } from 'vitest'
import { compactInterpreter, downloadPrimaryRuntimeAsset, prepareOfficeSkillAssets, primaryRuntimePayloadDigest, smokePrimaryRuntime, unpackPrimaryRuntimeWheel } from './prepare.ts'
import lock from './lock.json' with { type: 'json' }

it('covers every SDK wheel target with the shared interpreter lock', () => {
  const platforms = JSON.parse(readFileSync(new URL('../../python/sdk-runtime/platforms.json', import.meta.url), 'utf8')) as Record<string, unknown>
  expect(Object.keys(lock.targets).sort()).toEqual(Object.keys(platforms).map(target => target.replace('macos-', 'mac-')).sort())
})

const libraryWheel = Buffer.from('UEsDBAoAAAAAAASeLl0sYMPjDAAAAAwAAAAJAAAAc2FtcGxlLnB5c2FtcGxlID0gNDIKUEsBAh4DCgAAAAAABJ4uXSxgw+MMAAAADAAAAAkAAAAAAAAAAQAAAKSBAAAAAHNhbXBsZS5weVBLBQYAAAAAAQABADcAAAAzAAAAAAA=', 'base64')
const relocatedWheel = Buffer.from('UEsDBAoAAAAAAASeLl3x0Nj9FAAAABQAAAAeAAAAc2FtcGxlLTEuMC5kYXRhL3NjcmlwdHMvc2FtcGxlcmVxdWlyZXMgcmVsb2NhdGlvbgpQSwECHgMKAAAAAAAEni5d8dDY/RQAAAAUAAAAHgAAAAAAAAABAAAApIEAAAAAc2FtcGxlLTEuMC5kYXRhL3NjcmlwdHMvc2FtcGxlUEsFBgAAAAABAAEATAAAAFAAAAAAAA==', 'base64')
const externalLibraryWheel = Buffer.from('UEsDBBQAAAAAAAAAIVyBOE8OHAAAABwAAAAhAAAAc2FtcGxlLTEuMC5kYXRhL3B1cmVsaWIvc2FtcGxlLnB5cmVxdWlyZXMgbGlicmFyeSByZWxvY2F0aW9uClBLAQIUAxQAAAAAAAAAIVyBOE8OHAAAABwAAAAhAAAAAAAAAAAAAACAAQAAAABzYW1wbGUtMS4wLmRhdGEvcHVyZWxpYi9zYW1wbGUucHlQSwUGAAAAAAEAAQBPAAAAWwAAAAAA', 'base64')

it.each(Object.entries(lock.targets))('records every locked wheel distribution and version for %s', (_target, artifact) => {
  const normalize = (name: string): string => name.toLowerCase().replace(/[-_.]+/gu, '-')
  const distributions = [...artifact.wheels, ...lock.wheels].map(({ url }) => {
    const [name, version] = basename(new URL(url).pathname).split('-')
    return [normalize(name!), version] as const
  })
  const declared = Object.entries(lock.pythonPackages).map(([name, version]) => [normalize(name), version] as const)
  expect(new Set(distributions.map(([name]) => name)).size).toBe(distributions.length)
  expect(new Set(declared.map(([name]) => name)).size).toBe(declared.length)
  expect(Object.fromEntries(distributions)).toEqual(Object.fromEntries(declared))
})

it('keeps a target payload identity independent of other target archives', () => {
  const changed = structuredClone(lock)
  changed.targets['win-x64'].wheels[0]!.sha256 = 'a'.repeat(64)
  expect(primaryRuntimePayloadDigest('mac-arm64', changed, true)).toBe(primaryRuntimePayloadDigest('mac-arm64', lock, true))
  expect(primaryRuntimePayloadDigest('win-x64', changed, true)).not.toBe(primaryRuntimePayloadDigest('win-x64', lock, true))
})

it('invalidates payload identity for shared wheels and package versions', () => {
  const wheel = structuredClone(lock), distribution = structuredClone(lock)
  wheel.wheels[0]!.sha256 = 'a'.repeat(64)
  distribution.pythonPackages['python-docx'] = '1.2.1'
  const original = primaryRuntimePayloadDigest('mac-arm64', lock, true)
  expect(primaryRuntimePayloadDigest('mac-arm64', wheel, true)).not.toBe(original)
  expect(primaryRuntimePayloadDigest('mac-arm64', distribution, true)).not.toBe(original)
})

it('reports missing distribution metadata before trying to execute a stale native payload', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-stale-runtime-'))
  try {
    await writeFile(join(root, 'runtime.json'), JSON.stringify({ desktopVersion: '1.0.0', platform: process.platform, arch: process.arch,
      components: { python: '3.12.14', numpy: '2.3.5', pandas: '3.0.1' } }))
    expect(() => { smokePrimaryRuntime(root, { compact: false }) }).toThrow('missing Python distribution versions; prepare the payload')
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('extracts a hash-verified cached library without a Python installer or network request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-wheel-'))
  try {
    const hash = createHash('sha256').update(libraryWheel).digest('hex')
    const archive = join(root, hash)
    await writeFile(archive, libraryWheel)
    expect(await downloadPrimaryRuntimeAsset('https://unused.invalid/library.whl', hash, root)).toBe(archive)
    await unpackPrimaryRuntimeWheel(archive, join(root, 'site-packages'))
    expect(await readFile(join(root, 'site-packages/sample.py'), 'utf8')).toBe('sample = 42\n')
    await writeFile(archive, 'corrupt archive')
    await expect(downloadPrimaryRuntimeAsset('https://unused.invalid/library.whl', hash, root)).rejects.toThrow('checksum mismatch')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('fully extracts a large deflate-compressed wheel entry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-large-wheel-'))
  try {
    const expected = Buffer.alloc(1024 * 1024)
    // Seeded xorshift bytes keep the compressed entry larger than the stream buffers.
    let state = 26
    for (let index = 0; index < expected.length; index++) {
      state ^= state << 13
      state ^= state >>> 17
      state ^= state << 5
      expected[index] = state & 255
    }
    const archive = join(root, 'large.whl')
    await writeFile(archive, zipSync({ 'large.bin': expected }, { level: 6 }))
    await unpackPrimaryRuntimeWheel(archive, root)
    expect(await readFile(join(root, 'large.bin'))).toEqual(expected)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('retains auxiliary wheel scripts without generating command wrappers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-wheel-'))
  try {
    const archive = join(root, 'relocated.whl')
    await writeFile(archive, relocatedWheel)
    await unpackPrimaryRuntimeWheel(archive, join(root, 'site-packages'))
    expect(await readFile(join(root, 'site-packages/sample-1.0.data/scripts/sample'), 'utf8')).toBe('requires relocation\n')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('rejects library files requiring an unsupported installation scheme', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-wheel-'))
  try {
    const archive = join(root, 'relocated.whl')
    await writeFile(archive, externalLibraryWheel)
    await expect(unpackPrimaryRuntimeWheel(archive, join(root, 'site-packages'))).rejects.toThrow('unsupported installation paths')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('copies complete Office resources outside the application archive and removes obsolete assets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-office-assets-'))
  try {
    const source = join(root, 'package', 'assets')
    const destination = join(root, 'Contents', 'Resources', 'runtime', 'office-skills')
    await mkdir(join(source, 'scripts'), { recursive: true })
    await writeFile(join(source, 'scripts', 'check_office.py'), 'print("checker")\n')
    for (const name of ['office-docx', 'office-pptx', 'office-xlsx']) {
      await mkdir(join(source, name))
      await writeFile(join(source, name, 'SKILL.md'), `# ${name}\n`)
    }
    await prepareOfficeSkillAssets(source, destination)
    await writeFile(join(destination, 'obsolete.py'), 'old helper')
    await prepareOfficeSkillAssets(source, destination)
    for (const name of ['office-docx', 'office-pptx', 'office-xlsx']) {
      expect(await readFile(join(destination, name, 'SKILL.md'), 'utf8')).toBe(`# ${name}\n`)
    }
    expect(await readFile(join(destination, 'scripts', 'check_office.py'), 'utf8')).toBe('print("checker")\n')
    await expect(readFile(join(destination, 'obsolete.py'))).rejects.toMatchObject({ code: 'ENOENT' })
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('gives compact payloads a distinct identity, so an installed complete payload is replaced', () => {
  expect(primaryRuntimePayloadDigest('mac-arm64', lock, false)).not.toBe(primaryRuntimePayloadDigest('mac-arm64', lock, true))
})

/** Create each relative file (or `name -> target` link) under root. */
async function tree(root: string, entries: readonly string[]): Promise<void> {
  for (const entry of entries) {
    const [path, target] = entry.split(' -> ') as [string, string | undefined]
    await mkdir(join(root, path, '..'), { recursive: true })
    if (target === undefined) await writeFile(join(root, path), path)
    else await symlink(target, join(root, path))
  }
}

it('keeps one Unix interpreter under the name the path query returns and drops pip, IDLE, Tk, and ensurepip', async () => {
  const python = await mkdtemp(join(tmpdir(), 'compact-unix-'))
  try {
    await tree(python, [
      'bin/python3.12', 'bin/python -> python3.12', 'bin/python3 -> python3.12', 'bin/pip3', 'bin/idle3 -> idle3.12', 'bin/idle3.12',
      'lib/libpython3.12.dylib', 'lib/libtcl9.0.dylib', 'lib/libtcl9tk9.0.dylib', 'lib/tcl9.0/init.tcl', 'lib/tk9.0/tk.tcl', 'lib/itcl4.3.8/a', 'lib/thread3.0.6/a',
      'lib/python3.12/os.py', 'lib/python3.12/turtle.py', 'lib/python3.12/tkinter/__init__.py', 'lib/python3.12/idlelib/a.py',
      'lib/python3.12/turtledemo/a.py', 'lib/python3.12/ensurepip/a.py', 'lib/python3.12/lib-dynload/_tkinter.cpython-312-darwin.so',
      'lib/python3.12/lib-dynload/_ssl.cpython-312-darwin.so', 'lib/python3.12/site-packages/pip/a.py', 'lib/python3.12/site-packages/pip-26.2.1.dist-info/METADATA',
    ])
    compactInterpreter(python, 'mac-arm64')
    expect(await readdir(join(python, 'bin'))).toEqual(['python3'])
    // The versioned executable takes the name; a dangling link would fail the materializing copy.
    expect(await readFile(join(python, 'bin/python3'), 'utf8')).toBe('bin/python3.12')
    expect((await readdir(join(python, 'lib'))).sort()).toEqual(['libpython3.12.dylib', 'python3.12'])
    expect((await readdir(join(python, 'lib/python3.12'))).sort()).toEqual(['lib-dynload', 'os.py', 'site-packages'])
    expect(await readdir(join(python, 'lib/python3.12/lib-dynload'))).toEqual(['_ssl.cpython-312-darwin.so'])
    expect(await readdir(join(python, 'lib/python3.12/site-packages'))).toEqual([])
  } finally { await rm(python, { recursive: true, force: true }) }
})

it('drops pip, IDLE, Tk, and ensurepip from the Windows layout without touching the interpreter', async () => {
  const python = await mkdtemp(join(tmpdir(), 'compact-windows-'))
  try {
    await tree(python, [
      'python.exe', 'pythonw.exe', 'python312.dll', 'tcl/tcl8.6/init.tcl', 'DLLs/_tkinter.pyd', 'DLLs/tcl86t.dll', 'DLLs/tk86t.dll', 'DLLs/_ssl.pyd',
      'Lib/os.py', 'Lib/tkinter/__init__.py', 'Lib/idlelib/a.py', 'Lib/turtledemo/a.py', 'Lib/turtle.py', 'Lib/ensurepip/a.py',
      'Lib/site-packages/pip/a.py', 'Lib/site-packages/pip-26.2.1.dist-info/METADATA', 'Lib/site-packages/README.txt',
    ])
    compactInterpreter(python, 'win-x64')
    expect((await readdir(python)).sort()).toEqual(['DLLs', 'Lib', 'python.exe', 'python312.dll', 'pythonw.exe'])
    expect(await readdir(join(python, 'DLLs'))).toEqual(['_ssl.pyd'])
    expect((await readdir(join(python, 'Lib'))).sort()).toEqual(['os.py', 'site-packages'])
    expect(await readdir(join(python, 'Lib/site-packages'))).toEqual(['README.txt'])
  } finally { await rm(python, { recursive: true, force: true }) }
})

it('fails the build when a compact rule matches nothing, since the locked archive layout changed', async () => {
  const python = await mkdtemp(join(tmpdir(), 'compact-drift-'))
  try {
    await tree(python, ['python.exe', 'tcl/a', 'DLLs/_tkinter.pyd', 'Lib/tkinter/a.py', 'Lib/site-packages/README.txt'])
    expect(() => { compactInterpreter(python, 'win-x64') }).toThrow(/matched nothing in .*site-packages/u)
  } finally { await rm(python, { recursive: true, force: true }) }
})

it('keeps the Desktop pnpm version aligned with the repository package manager', () => {
  const root = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    packageManager: string
    devDependencies: { pnpm: string }
  }
  const desktop = JSON.parse(readFileSync(new URL('../../apps/desktop/package.json', import.meta.url), 'utf8')) as {
    devDependencies: { pnpm: string }
  }
  expect(desktop.devDependencies.pnpm).toBe(root.devDependencies.pnpm)
  expect(root.packageManager).toBe(`pnpm@${root.devDependencies.pnpm}`)
})
