import { expect, it } from 'vitest'
import { desktopOfficeDisabled, desktopOfficePackageDisabled } from '../../desktop-host/src/desktop-feature-policy.ts'

it('disables bundled Office features only for Windows ia32', () => {
  expect(desktopOfficeDisabled({ platform: 'win32', arch: 'ia32' })).toBe(true)
  expect(desktopOfficeDisabled({ platform: 'win32', arch: 'x64' })).toBe(false)
  expect(desktopOfficeDisabled({ platform: 'darwin', arch: 'arm64' })).toBe(false)
})

it('omits only Office packages from the Windows ia32 runtime', () => {
  expect(desktopOfficePackageDisabled('@deepseek-ai/dsh-office-to-pdf', { platform: 'win32', arch: 'ia32' })).toBe(true)
  expect(desktopOfficePackageDisabled('@deepseek-ai/libreoffice-kit-win32-ia32', { platform: 'win32', arch: 'ia32' })).toBe(true)
  expect(desktopOfficePackageDisabled('@deepseek-ai/dsh-office-to-pdf', { platform: 'win32', arch: 'x64' })).toBe(false)
  expect(desktopOfficePackageDisabled('@deepseek-ai/dsh-tool-fs', { platform: 'win32', arch: 'ia32' })).toBe(false)
})
