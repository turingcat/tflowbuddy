/** Filesystem ownership for the Electron-managed desktop installation. */

import { join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** Stable desktop installation paths under the shared Harness home. */
export interface DesktopPaths {
  readonly profile: string
  readonly lock: string
}

/**
 * Resolve every Electron-owned path without changing the shared data roots.
 * @param dshHome - Harness home shared with npm-installed dsh.
 * @returns immutable desktop path set.
 */
export function resolveDesktopPaths(dshHome: string = resolveDshHome()): DesktopPaths {
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
