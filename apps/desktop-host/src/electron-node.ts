/** Node.js launcher for agent scripts: the running Electron executable in Node mode. */

import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Write the launcher for one Electron executable, replacing an earlier one atomically.
 *
 * The launcher sets `ELECTRON_RUN_AS_NODE=1` and passes `--expose-internals` like the shell's own `node`
 * launcher. It puts its own directory first on the `PATH` of the process it starts, so a pnpm lifecycle
 * script that runs `node` reaches the same Electron executable; the caller's `PATH` is unchanged.
 * @param directory - Harness-home directory owning the launcher; created when missing.
 * @param executable - Electron executable of the running application.
 * @param platform - Platform deciding between a POSIX shell script and a Windows batch file.
 * @returns Absolute launcher path.
 */
export function writeElectronNodeLauncher(directory: string, executable: string, platform: NodeJS.Platform = process.platform): string {
  const windows = platform === 'win32'
  const path = join(directory, windows ? 'node.cmd' : 'node')
  const body = windows
    ? `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\nset "PATH=%~dp0;%PATH%"\r\n"${executable}" --expose-internals %*\r\n`
    : `#!/bin/sh\nexport ELECTRON_RUN_AS_NODE=1\nPATH="$(dirname -- "$0"):$PATH"\nexport PATH\nexec '${executable.replaceAll('\'', '\'\\\'\'')}' --expose-internals "$@"\n`
  mkdirSync(directory, { recursive: true })
  const staging = `${path}.${String(process.pid)}.tmp`
  const launcherBody = body.replace('$(dirname -- "$0")', '${0%/*}')
  writeFileSync(staging, launcherBody, { mode: 0o755 })
  renameSync(staging, path)
  return path
}
