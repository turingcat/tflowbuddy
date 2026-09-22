// @vitest-environment jsdom
/** TFlow account registration inside the shipped client composition. */
import { afterEach, expect, vi } from 'vitest'
import { createClientTest, webApp } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { TFlowAccountInjected } from '../src/client/AccountSection.tsx'

const it = createClientTest({ roster: webApp })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

/**
 * The launcher's injected operations, as the shell would call them.
 * @param slots - the client's slot registry.
 * @returns the operations the launcher registration exposes.
 */
function operations(slots: TestSlots): TFlowAccountInjected {
  return slots.entries('settings.launcher')[0]!.inject!() as TFlowAccountInjected
}

/** The slot-registry surface this spec reads; the shipped registry satisfies it. */
interface TestSlots {
  entries: (name: 'settings.launcher' | 'settings.section') => readonly {
    options: { id?: string; priority?: number; label?: string | (() => string) }
    inject?: () => unknown
  }[]
}

it('stays dormant in a renderer the Electron shell did not load', async ({ start }) => {
  const context = await start()
  await context.flush()
  expect((context.ctx.slots as unknown as TestSlots).entries('settings.launcher')).toHaveLength(0)
  expect((context.ctx.slots as unknown as TestSlots).entries('settings.section').some(entry => entry.options.id === 'tflow-account')).toBe(false)
})

it('registers the account section and launcher for a desktop renderer', async ({ start }) => {
  const read = vi.fn(() => Promise.resolve({ displayName: 'alice', balance: 12.34 }))
  vi.stubGlobal('dshDesktopAccount', { read })
  const context = await start()
  const actions = operations(context.ctx.slots as unknown as TestSlots)
  await actions.refresh()

  const section = (context.ctx.slots as unknown as TestSlots).entries('settings.section').find(entry => entry.options.id === 'tflow-account')
  expect(section).toBeDefined()
  // The test client boots in English; the label follows the active language, so
  // registering both dictionaries is what makes the Chinese copy reachable.
  expect(resolveSlotLabel(section!.options.label)).toBe('Account')
  expect(context.ctx.locale.getSnapshot().active).toBe('en')
  // The launcher shadows the DeepSeek menu at a different priority rather than colliding.
  expect((context.ctx.slots as unknown as TestSlots).entries('settings.launcher')[0]!.options.priority).toBe(1)
  expect(actions.hooks.account.getSnapshot()).toEqual({
    status: 'ready',
    account: { displayName: 'alice', balance: 12.34 },
  })
})

it('reports a signed-out account when the shell has no session', async ({ start }) => {
  vi.stubGlobal('dshDesktopAccount', { read: () => Promise.resolve(null) })
  const context = await start()
  const actions = operations(context.ctx.slots as unknown as TestSlots)
  await actions.refresh()
  expect(actions.hooks.account.getSnapshot()).toEqual({ status: 'signed-out' })
})

it('reports a failed read when the shell rejects', async ({ start }) => {
  vi.stubGlobal('dshDesktopAccount', { read: () => Promise.reject(new Error('panel unreachable')) })
  const context = await start()
  const actions = operations(context.ctx.slots as unknown as TestSlots)
  await actions.refresh()
  expect(actions.hooks.account.getSnapshot()).toEqual({ status: 'failed' })
})

// The fixture-carrying test function does not compose with `it.each`, so each
// malformed payload gets its own case over the same assertion.
const malformed: Array<[string, unknown]> = [
  ['a missing display name', { balance: 1 }],
  ['a missing balance', { displayName: 'alice' }],
  ['a non-numeric balance', { displayName: 'alice', balance: '1' }],
  ['a subscription without a group name', { displayName: 'alice', balance: 1, subscription: { remaining: { daily: 1 } } }],
  ['a subscription without remaining windows', { displayName: 'alice', balance: 1, subscription: { groupName: 'g', remaining: {} } }],
  ['a non-numeric window', { displayName: 'alice', balance: 1, subscription: { groupName: 'g', remaining: { daily: '1' } } }],
  ['a payload that is not an object', 'nope'],
]
for (const [label, payload] of malformed) {
  it(`refuses ${label} rather than rendering a partial card`, async ({ start }) => {
    vi.stubGlobal('dshDesktopAccount', { read: () => Promise.resolve(payload) })
    const context = await start()
    const actions = operations(context.ctx.slots as unknown as TestSlots)
    await actions.refresh()
    expect(actions.hooks.account.getSnapshot()).toEqual({ status: 'failed' })
  })
}

it('shares one request between concurrent refreshes', async ({ start }) => {
  const pending = Promise.withResolvers<unknown>()
  const read = vi.fn(() => pending.promise)
  vi.stubGlobal('dshDesktopAccount', { read })
  const context = await start()
  const actions = operations(context.ctx.slots as unknown as TestSlots)
  const first = actions.refresh()
  const second = actions.refresh()
  expect(first).toBe(second)
  pending.resolve({ displayName: 'alice', balance: 1 })
  await first
  expect(read).toHaveBeenCalledOnce()
})

it('notifies subscribers of each published snapshot and stops when they unsubscribe', async ({ start }) => {
  vi.stubGlobal('dshDesktopAccount', { read: () => Promise.resolve({ displayName: 'alice', balance: 1 }) })
  const context = await start()
  const actions = operations(context.ctx.slots as unknown as TestSlots)
  const listener = vi.fn()
  const stop = actions.hooks.account.subscribe(listener)
  await actions.refresh()
  expect(listener).toHaveBeenCalledTimes(1)
  stop()
  await actions.refresh()
  expect(listener).toHaveBeenCalledTimes(1)
})

it('opens the TFlow site for account management', async ({ start }) => {
  vi.stubGlobal('dshDesktopAccount', { read: () => Promise.resolve(null) })
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  const context = await start()
  operations(context.ctx.slots as unknown as TestSlots).manage()
  expect(open).toHaveBeenCalledWith('https://tflow.online', '_blank', 'noopener,noreferrer')
})
