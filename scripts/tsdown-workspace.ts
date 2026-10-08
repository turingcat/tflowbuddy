/**
 * Root tsdown workspace selection shared by `tsdown.config.ts` and its spec.
 *
 * `vendor/dsh-pocket` is excluded: the direct GPL vendor ships prebuilt
 * JavaScript from its pinned upstream release (vendor/README.md), so the
 * workspace build must not rebundle it. The exclusion is recorded in tsdown's
 * `exclude` list rather than by negation inside the include globs, which
 * tsdown does not support.
 */

/** Prebuilt vendored package the workspace build leaves alone. */
const PREBUILT_VENDOR_EXCLUSION = 'vendor/dsh-pocket'

/**
 * tsdown's built-in workspace excludes, restated because passing `exclude`
 * replaces rather than extends the default list.
 */
const TSDOWN_DEFAULT_EXCLUDES = ['**/node_modules/**', '**/dist/**', '**/test?(s)/**', '**/t?(e)mp/**']

/**
 * The root build's workspace member selection for one build face.
 * @param client - whether the Client face (browser bundles) is being built;
 *   the Host face additionally bundles `apps/desktop-host`.
 * @returns tsdown workspace options: member include globs plus the prebuilt
 *   vendor exclusion.
 */
export function tsdownWorkspace(client: boolean): { include: string[]; exclude: string[] } {
  return {
    include: client
      ? ['vendor/*', 'packages/*/*', 'apps/cli']
      : ['vendor/*', 'packages/*/*', 'apps/cli', 'apps/desktop-host'],
    exclude: [...TSDOWN_DEFAULT_EXCLUDES, PREBUILT_VENDOR_EXCLUSION],
  }
}
