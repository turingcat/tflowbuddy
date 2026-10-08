/** TFlowBuddy product identity for the Electron shell and its build inputs. */

/** Distribution edition this Desktop source tree builds. */
export type DesktopEdition = 'tflowbuddy'

/** Stable product identity shared by runtime, packaging, and release qualification. */
export interface DesktopEditionManifest {
  readonly edition: DesktopEdition
  /** Application name Electron installs as `app.name`. */
  readonly productName: string
  readonly bundleId: string
  /** URL scheme the application registers for deep links. */
  readonly protocol: string
  /** Scheme name recorded by the operating system's protocol handler registry. */
  readonly protocolName: string
  readonly windowsAppId: string
  /** Installer, executable, and artifact stem. */
  readonly executableName: string
  readonly artifactStem: string
  /** Resource stem for every shipped icon under `resources/`. */
  readonly iconStem: string
  /** Account site opened for sign-in, balance, and subscription management. */
  readonly siteUrl: string
  /** Stable edition marker read by account surfaces instead of inferring the product from copy. */
  readonly siteKind: string
}

const identityPattern = /^[!-~]+$/u

/**
 * Reject an identity value the operating system, installer, or protocol registry cannot represent.
 * @param field - manifest key being validated.
 * @param value - declared value.
 * @returns the validated value.
 */
function assertIdentity(field: keyof DesktopEditionManifest, value: string): string {
  if (!identityPattern.test(value)) {
    throw new Error(`desktop edition: ${field} must be non-empty printable ASCII without spaces`)
  }
  return value
}

/**
 * Validate one account-site origin.
 * @param value - declared site URL.
 * @returns the origin without a trailing path.
 */
function assertSiteUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:') throw new Error('desktop edition: siteUrl must be https')
  if (url.origin !== value) throw new Error('desktop edition: siteUrl must be a bare origin')
  return url.origin
}

/**
 * Freeze one validated edition manifest.
 * @param manifest - declared identity.
 * @returns the frozen manifest.
 */
export function resolveDesktopEdition(manifest: DesktopEditionManifest): DesktopEditionManifest {
  return Object.freeze({
    edition: manifest.edition,
    productName: assertIdentity('productName', manifest.productName),
    bundleId: assertIdentity('bundleId', manifest.bundleId),
    protocol: assertIdentity('protocol', manifest.protocol),
    protocolName: assertIdentity('protocolName', manifest.protocolName),
    windowsAppId: assertIdentity('windowsAppId', manifest.windowsAppId),
    executableName: assertIdentity('executableName', manifest.executableName),
    artifactStem: assertIdentity('artifactStem', manifest.artifactStem),
    iconStem: assertIdentity('iconStem', manifest.iconStem),
    siteUrl: assertSiteUrl(manifest.siteUrl),
    siteKind: assertIdentity('siteKind', manifest.siteKind),
  })
}

/** The single product identity every TFlowBuddy surface reads. */
export const desktopEdition: DesktopEditionManifest = resolveDesktopEdition({
  edition: 'tflowbuddy',
  productName: 'TFlowBuddy',
  bundleId: 'com.tflow.buddy',
  protocol: 'tflowbuddy',
  protocolName: 'TFlowBuddyProtocol',
  windowsAppId: 'com.tflow.buddy',
  executableName: 'TFlowBuddy',
  artifactStem: 'tflowbuddy',
  iconStem: 'icon-tflowbuddy',
  siteUrl: 'https://tflow.online',
  siteKind: 'tflow',
})
