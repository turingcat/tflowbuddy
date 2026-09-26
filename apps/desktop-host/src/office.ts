/** Desktop Office skills and bundled authoring dependencies. */

import { realpathSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import * as officeSkills from '@deepseek-ai/dsh-skill-office'
import * as workspaceDependencies from '@deepseek-ai/dsh-tool-workspace-dependencies'
import { runtimeArchivePath } from './office-engine.ts'

/** Loader identity for the application-owned Office composition. */
export const name = 'desktop-office'
/** Application-selected bundled payload and installation directories. */
export interface Config {
  /** Bundled payload directory. Missing sibling `office-skills` resources fail Host startup. */
  readonly source: string
  /** Prepared or ASAR-contained application dependency directory. */
  readonly runtimeDir: string
  /** Harness-home directory where workspace dependencies are installed. */
  readonly root: string
  /** Electron Node.js launcher the agent runs scripts and pnpm with; the payload ships no Node.js. */
  readonly node: string
  /** Bundled pnpm entry script, when the shell supplied one. */
  readonly pnpm?: string
}

/**
 * Enable offline Office authoring and structural checks in the Desktop profile.
 * @param ctx - Profile scope; child plugins declare their own service requirements.
 * @param config - Bundled payload source and Harness-home installation root.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  await ctx.plugin(workspaceDependencies, config)
  const archive = runtimeArchivePath(config.runtimeDir) === undefined ? undefined : dirname(realpathSync(config.runtimeDir))
  const manifest = fileURLToPath(import.meta.resolve('@deepseek-ai/libreoffice-kit/package.json'))
  const packageRoot = dirname(archive === undefined ? manifest : join(`${archive}.unpacked`, relative(archive, manifest)))
  await ctx.plugin(officeSkills, {
    assetRoot: join(dirname(config.source), 'office-skills'),
    node: config.node,
    cli: join(packageRoot, 'lib', 'cli.js'),
  })
}
