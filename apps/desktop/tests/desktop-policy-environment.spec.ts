import { expect, it } from 'vitest'
import { validateDesktopPackageEnvironment } from '../scripts/desktop-package-environment.mjs'
import { createElectronBuilderConfig } from '../scripts/electron-builder-config.mjs'

it.each(['win32', 'darwin'] as const)('packages %s without an upstream update policy', (platform) => {
  const environment = { DSH_DESKTOP_UNSIGNED: '1' }
  expect(() => {
    validateDesktopPackageEnvironment(environment, { platform, arch: 'x64' }, { unsigned: true })
  }).not.toThrow()
  const config = createElectronBuilderConfig(environment, platform, 'x64')
  expect(config.extraMetadata).not.toHaveProperty('dshMandatoryUpdatePolicy')
})

it('does not embed legacy update policy settings in an installer', () => {
  const config = createElectronBuilderConfig({
    DSH_DESKTOP_UNSIGNED: '1',
    DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN: 'https://upstream.example.com',
    DSH_DESKTOP_MANDATORY_UPDATE_CONFIG: 'invalid legacy configuration',
  }, 'darwin', 'arm64')
  expect(config.extraMetadata).not.toHaveProperty('dshMandatoryUpdatePolicy')
})
