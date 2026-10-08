import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveDesktopHome, resolveDesktopPaths } from '../src/paths.ts'

const edition = join(homedir(), '.tflowbuddy')

describe('desktop Harness home', () => {
  it('keeps the packaged application out of the npm-installed dsh home', () => {
    // A user who points DSH_HOME at their dsh CLI home must not see TFlowBuddy
    // profiles, sessions, or credentials appear there.
    expect(resolveDesktopHome(true, {})).toBe(edition)
    expect(resolveDesktopHome(true, { DSH_HOME: join(homedir(), '.dsh') })).toBe(edition)
    expect(resolveDesktopPaths(resolveDesktopHome(true, {})).profile).toBe(join(edition, 'profiles', 'desktop'))
  })

  it('lets development launchers isolate an unpackaged run', () => {
    expect(resolveDesktopHome(false, { DSH_HOME: 'checkout-home' })).toBe(resolve('checkout-home'))
    expect(resolveDesktopHome(false, { DSH_HOME: '  ' })).toBe(edition)
    expect(resolveDesktopHome(false, {})).toBe(edition)
  })
})
