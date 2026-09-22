import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { desktopEdition, resolveDesktopEdition, type DesktopEditionManifest } from '../src/edition.ts'
import { createElectronBuilderConfig } from '../scripts/electron-builder-config.mjs'
import { resolveDesktopAppId } from '../scripts/desktop-release-environment.mjs'

const declared: DesktopEditionManifest = {
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
}

// An unsigned Windows target keeps the identity assertions independent of release signing credentials.
const config: ReturnType<typeof createElectronBuilderConfig> = createElectronBuilderConfig({
  DSH_DESKTOP_TARGET_PLATFORM: 'win32',
  DSH_DESKTOP_TARGET_ARCH: 'x64',
  DSH_DESKTOP_UNSIGNED: '1',
  DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN: 'https://policy.example.com',
  DSH_DESKTOP_MANDATORY_UPDATE_CONFIG: JSON.stringify({ allowedAuthOrigins: ['https://login.example.com'] }),
}, 'darwin', 'arm64')

describe('desktop edition manifest', () => {
  it('declares the TFlowBuddy desktop identity', () => {
    expect(desktopEdition).toEqual(declared)
    expect(Object.isFrozen(desktopEdition)).toBe(true)
  })

  it('rejects an identity the operating system cannot represent', () => {
    expect(() => resolveDesktopEdition({ ...declared, productName: '' })).toThrow(/productName/)
    expect(() => resolveDesktopEdition({ ...declared, bundleId: 'com tflow buddy' })).toThrow(/bundleId/)
    expect(() => resolveDesktopEdition({ ...declared, protocol: 'tflow buddy' })).toThrow(/protocol/)
  })

  it('requires an account site the application can open without credentials in the URL', () => {
    expect(() => resolveDesktopEdition({ ...declared, siteUrl: 'http://tflow.online' })).toThrow(/https/)
    expect(() => resolveDesktopEdition({ ...declared, siteUrl: 'https://tflow.online/account' })).toThrow(/bare origin/)
  })

  it('drives the packaged application identity', () => {
    expect(config.appId).toBe(desktopEdition.bundleId)
    expect(resolveDesktopAppId({})).toBe(desktopEdition.bundleId)
    expect(config.extraMetadata.dshDesktopAppId).toBe(desktopEdition.bundleId)
    expect(config.productName).toBe(desktopEdition.productName)
    expect(config.artifactName).toContain(desktopEdition.artifactStem)
    expect(config.protocols).toEqual([{ name: desktopEdition.protocolName, schemes: [desktopEdition.protocol] }])
    expect(config.mac.icon).toMatch(new RegExp(`/resources/${desktopEdition.iconStem}\\.icns$`, 'u'))
    expect(config.win.icon).toMatch(new RegExp(`/resources/${desktopEdition.iconStem}\\.ico$`, 'u'))
    expect(config.extraResources).toContainEqual({ from: expect.stringMatching(new RegExp(`/resources/${desktopEdition.iconStem}\\.png$`, 'u')), to: 'icon.png' })
    expect(config.dmg.title).toBe(desktopEdition.productName)
  })

  it('registers the manifest protocol instead of a fixed scheme', () => {
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
    expect(main).toContain('desktopEdition.protocol')
    expect(main).toContain('desktopEdition.productName')
    expect(main).not.toMatch(/setAsDefaultProtocolClient\('dsh'\)/u)
    expect(main).not.toMatch(/'dsh:\/\/open/u)
  })

  it('keeps product identity out of the shared Harness runtime', () => {
    const locale = readFileSync(new URL('../src/locale.ts', import.meta.url), 'utf8')
    expect(locale).toContain('desktopEdition.productName')
    for (const file of ['../src/locale.ts', '../src/main.ts']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8')
      expect(source).not.toContain('DeepSeek Harness')
    }
  })

  it('ships an icon resource for every packaged identity field', () => {
    for (const suffix of ['icns', 'ico', 'png']) {
      expect(existsSync(new URL(`../resources/${desktopEdition.iconStem}.${suffix}`, import.meta.url))).toBe(true)
    }
  })
})
