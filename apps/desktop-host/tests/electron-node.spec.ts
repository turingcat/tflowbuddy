import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { writeElectronNodeLauncher } from '../src/electron-node.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function directory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "desktop-electron-node-'quoted'-"))
  roots.push(root)
  return root
}

it.skipIf(process.platform === 'win32')('runs scripts in Node mode, and a nested `node` reaches the same executable', async () => {
  const root = await directory()
  // A quote in the executable path must survive the shell script's quoting.
  const executable = join(root, "it's-electron")
  await symlink(process.execPath, executable)
  const launcher = writeElectronNodeLauncher(join(root, 'launcher'), executable)
  expect((await stat(launcher)).mode & 0o111).not.toBe(0)
  const script = [
    'const { execFileSync } = require("node:child_process")',
    'const nested = execFileSync("node", ["-p", "process.env.ELECTRON_RUN_AS_NODE + String(process.execArgv.includes(\\"--expose-internals\\"))"], { encoding: "utf8" }).trim()',
    'console.log(JSON.stringify({ marker: process.env.ELECTRON_RUN_AS_NODE, internals: process.execArgv.includes("--expose-internals"), nested }))',
  ].join('\n')
  const output = execFileSync(launcher, ['-e', script], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } })
  expect(JSON.parse(output)).toEqual({ marker: '1', internals: true, nested: '1true' })
})

it('writes a batch launcher on Windows that sets the marker before starting Electron', async () => {
  const root = await directory()
  const launcher = writeElectronNodeLauncher(root, 'C:\\Program Files\\TFlowBuddy\\TFlowBuddy.exe', 'win32')
  expect(launcher).toBe(join(root, 'node.cmd'))
  expect(await readFile(launcher, 'utf8')).toBe(
    '@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\nset "PATH=%~dp0;%PATH%"\r\n"C:\\Program Files\\TFlowBuddy\\TFlowBuddy.exe" --expose-internals %*\r\n',
  )
})

it('replaces the launcher of an earlier application location', async () => {
  const root = await directory()
  writeElectronNodeLauncher(root, '/old/Electron', 'darwin')
  const launcher = writeElectronNodeLauncher(root, '/new/Electron', 'darwin')
  const body = await readFile(launcher, 'utf8')
  expect(body).toContain("exec '/new/Electron'")
  expect(body).not.toContain('/old/')
})
