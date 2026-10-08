/** Features unavailable in the Windows ia32 Desktop edition. */

/**
 * Identify the target that omits the bundled Python and Office payload.
 * @param target - Target platform and architecture.
 * @returns Whether bundled Office features must be disabled.
 */
export function desktopOfficeDisabled(target: { platform: string; arch: string }): boolean {
  return target.platform === 'win32' && target.arch === 'ia32'
}

/**
 * Identify npm packages that belong only to the bundled Office feature.
 * @param name - Package name.
 * @param target - Target platform and architecture.
 * @returns Whether the package must be omitted from a Windows ia32 runtime.
 */
export function desktopOfficePackageDisabled(name: string, target: { platform: string; arch: string }): boolean {
  return desktopOfficeDisabled(target) && (
    name === '@deepseek-ai/dsh-office-to-pdf'
    || name === '@deepseek-ai/dsh-skill-office'
    || name === '@deepseek-ai/libreoffice-kit'
    || name.startsWith('@deepseek-ai/libreoffice-kit-')
  )
}
