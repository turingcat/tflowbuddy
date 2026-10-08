/** Filesystem ownership for the Electron-managed desktop installation. */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { DSH_HOME_ENV, resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** Directory name of the TFlowBuddy Harness home under the OS home. */
const TFLOWBUDDY_HOME_DIR_NAME = '.tflowbuddy'

/**
 * Resolve the Harness home the TFlowBuddy Host runs against.
 *
 * The packaged application always uses `~/.tflowbuddy`, so its profiles,
 * sessions, workspaces, and credential document never share the `~/.dsh` home
 * of an npm-installed dsh, even when `$DSH_HOME` names that home. An unpackaged
 * run honours a non-blank `$DSH_HOME`, which the development launchers set to
 * a checkout-local home.
 * @param packaged - whether Electron runs the packaged application.
 * @param env - environment read for the development `$DSH_HOME`.
 * @returns the absolute Harness home path.
 */
export function resolveDesktopHome(packaged: boolean, env: NodeJS.ProcessEnv = process.env): string {
  const development = packaged ? undefined : env[DSH_HOME_ENV]
  return resolveDshHome(development !== undefined && development.trim().length > 0
    ? development
    : join(homedir(), TFLOWBUDDY_HOME_DIR_NAME))
}

/** Stable desktop installation paths under the TFlowBuddy Harness home. */
export interface DesktopPaths {
  readonly profile: string
  readonly lock: string
}

/**
 * Resolve every Electron-owned path without changing the shared data roots.
 * @param dshHome - Harness home from {@link resolveDesktopHome}.
 * @returns immutable desktop path set.
 */
export function resolveDesktopPaths(dshHome: string): DesktopPaths {
  return {
    profile: join(dshHome, 'profiles', 'desktop'),
    lock: join(dshHome, 'profiles', 'desktop', 'lock'),
  }
}

/**
 * Credential record for the desktop product's own account session.
 *
 * It lives under Electron's per-user data directory rather than the shared
 * Harness home because its owner is the Electron main process, not the Host:
 * the Host's credential document is written by the credentials plugin and read
 * by providers, while this record holds a panel session no provider sees. The
 * two secrets inside are sealed with the platform vault, so the location adds
 * separation rather than carrying the protection.
 * @param userData - Electron's `userData` directory.
 * @returns absolute path of the record.
 */
export function resolveTFlowCredentialsPath(userData: string): string {
  return join(userData, 'tflow-credentials.json')
}

/** @param userData - Electron user-data directory. @returns group preference path. */
export function resolveTFlowGroupPreferencePath(userData: string): string {
  return join(userData, 'tflow-group-preference.json')
}
