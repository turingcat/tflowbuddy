/** Command-management worker process resolution: always Electron in Node mode, never a bundled Node copy. */

import { join } from 'node:path'

/**
 * Environment every command-manager worker runs with. `ELECTRON_RUN_AS_NODE` selects Node mode
 * and `DSH_DESKTOP_NODE_EXECUTABLE` lets the runtime's launcher scripts resolve the same binary,
 * so the worker uses the packaged Electron executable rather than a shipped Node copy.
 */
export interface CommandManagerEnvironment {
  readonly ELECTRON_RUN_AS_NODE: '1'
  readonly DSH_DESKTOP_NODE_EXECUTABLE: string
}

/** Resolved worker invocation shared by direct and elevated execution. */
export interface CommandManagerInvocation {
  /** Packaged Electron executable the worker runs through. */
  readonly executable: string
  /** Built command-manager entry inside `resources/runtime/cli`. */
  readonly entry: string
  /** Node-mode fields merged into the caller-scrubbed direct-worker environment. */
  readonly environment: CommandManagerEnvironment
  /** Complete environment for the elevated worker, whose `/usr/bin/env -i` drops everything else. */
  readonly elevatedEnvironment: CommandManagerEnvironment & { readonly PATH: string }
}

/**
 * Resolve the worker process for one installed application.
 * @param resources - Packaged `resources` directory owning the runtime tree.
 * @param platform - Platform the installed application runs on.
 * @param executable - Packaged Electron executable (`process.execPath` of the shell).
 * @returns Executable, entry point, and Node-mode environments for direct and elevated runs.
 */
export function commandManagerProcess(
  resources: string,
  platform: NodeJS.Platform,
  executable: string,
): CommandManagerInvocation {
  const environment: CommandManagerEnvironment = { ELECTRON_RUN_AS_NODE: '1', DSH_DESKTOP_NODE_EXECUTABLE: executable }
  return {
    executable,
    entry: join(resources, 'runtime', 'cli', 'command-manager.js'),
    environment,
    elevatedEnvironment: {
      ...environment,
      PATH: platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32') : '/usr/bin:/bin:/usr/sbin:/sbin',
    },
  }
}
