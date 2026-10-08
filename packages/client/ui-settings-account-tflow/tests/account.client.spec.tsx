// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import {
  TFlowAccountSection,
  type TFlowAccountInjected,
  type TFlowAccountSnapshot,
} from '../src/client/AccountSection.tsx'
import { TFlowUsageSection, type TFlowUsageSnapshot } from '../src/client/UsageSection.tsx'
import { TFlowAccountMenu } from '../src/client/AccountMenu.tsx'
import { en, zh, type TFlowAccountKey } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

/** The observable the slot supplies; the component only reads it through its hook seat. */
function source(snapshot: TFlowAccountSnapshot): HostObservable<TFlowAccountSnapshot> {
  return { getSnapshot: () => snapshot, subscribe: () => () => {} }
}

/** The copy seat as the locale service binds it. */
function copySeat(copy: typeof en | typeof zh) {
  return (key: TFlowAccountKey): string => copy[key]
}

/** Mount the section over one published snapshot. */
function mountSection(snapshot: TFlowAccountSnapshot, copy: typeof en | typeof zh = en, refresh = vi.fn(() => Promise.resolve())) {
  const operations: TFlowAccountInjected = { hooks: { account: source(snapshot) }, refresh, manage: vi.fn(), signOut: vi.fn() }
  const observable = source(snapshot)
  // The section consumes no slot-derived share beyond the inject face, so the
  // stub supplies the three seats it reads and no framework seats.
  const props = {
    usePanelInfo: () => { throw new Error('unexpected panel hook') },
    useSessions: () => { throw new Error('unexpected sessions hook') },
    useSessionStatus: () => { throw new Error('unexpected status hook') },
    useSessionRetainInfo: () => { throw new Error('unexpected retain hook') },
    useWorkspaces: () => { throw new Error('unexpected workspace hook') },
    useResource: () => { throw new Error('unexpected resource hook') },
    close: () => {},
    refresh: operations.refresh,
    manage: operations.manage,
    signOut: operations.signOut,
    useAccount: <T,>(selector: (value: TFlowAccountSnapshot) => T): T => selector(observable.getSnapshot()),
    t: copySeat(copy),
  } as Parameters<typeof TFlowAccountSection>[0]
  render(<TFlowAccountSection {...props} />)
  return operations
}

it.each([en, zh])('renders the balance and the subscription covering the group', async (copy) => {
  mountSection({
    status: 'ready',
    account: {
      displayName: 'alice',
      balance: 12.34,
      subscription: { groupName: '订阅套餐', remaining: { daily: 1.5, monthly: 30 } },
    },
  }, copy)
  expect(screen.getByText('alice')).toBeTruthy()
  expect(screen.getByText(copy.balance)).toBeTruthy()
  expect(screen.getByText('$12.34')).toBeTruthy()
  expect(screen.getByText('订阅套餐')).toBeTruthy()
  expect(screen.getByText(`${copy.daily} $1.50`)).toBeTruthy()
  expect(screen.getByText(`${copy.monthly} $30.00`)).toBeTruthy()
  // A window the panel did not report is absent rather than rendered as zero.
  expect(screen.queryByText(`${copy.weekly} $0.00`)).toBeNull()
  await expect(`${screen.getByRole('region').textContent}\n`).toMatchFileSnapshot(`./expected/account-${copy === en ? 'en' : 'zh'}.txt`)
})

it('reports no subscription without hiding the balance', async () => {
  mountSection({ status: 'ready', account: { displayName: 'alice', balance: 0 } })
  expect(screen.getByText('$0.00')).toBeTruthy()
  expect(screen.getByText(en.subscriptionNone)).toBeTruthy()
  expect(screen.queryByText(en.remaining)).toBeNull()
})

it('opens the TFlow site for account management', async () => {
  const operations = mountSection({ status: 'ready', account: { displayName: 'alice', balance: 1 } })
  fireEvent.click(screen.getByRole('button', { name: en.manage }))
  expect(operations.manage).toHaveBeenCalledOnce()
})

it('asks for a sign-in rather than showing an empty balance', async () => {
  mountSection({ status: 'signed-out' })
  expect(screen.getByText(en.signInRequired)).toBeTruthy()
  expect(document.body.textContent).not.toContain('$')
})

it('reports a failed read with a retry that refreshes again', async () => {
  const refresh = vi.fn(() => Promise.resolve())
  mountSection({ status: 'failed' }, en, refresh)
  // The mount effect's own refresh settles before the button can be used.
  await act(async () => { await Promise.resolve() })
  expect(refresh).toHaveBeenCalledTimes(1)
  expect(screen.getByText(en.failed)).toBeTruthy()
  expect(screen.getByRole('button', { name: en.retry }).hasAttribute('disabled')).toBe(false)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.retry })); await Promise.resolve() })
  expect(refresh).toHaveBeenCalledTimes(2)
})

it('keeps the retry usable when a refresh rejects', async () => {
  const refresh = vi.fn(() => Promise.reject(new Error('panel down')))
  mountSection({ status: 'failed' }, en, refresh)
  await act(async () => { await Promise.resolve() })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.retry })); await Promise.resolve() })
  expect(refresh).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('button', { name: en.retry }).hasAttribute('disabled')).toBe(false)
})

it('reports the loading state before the first read settles', async () => {
  mountSection({ status: 'loading' })
  expect(screen.getByText(en.loading)).toBeTruthy()
})

it('labels the section for assistive technology in the active language', async () => {
  mountSection({ status: 'ready', account: { displayName: 'alice', balance: 1 } }, zh)
  expect(screen.getByRole('region').getAttribute('aria-label')).toBe(zh.nav)
})

it('offers settings and the account site from the launcher, and shows the account name', async () => {
  const openSettings = vi.fn()
  const manage = vi.fn()
  const operations: TFlowAccountInjected = {
    hooks: { account: source({ status: 'ready', account: { displayName: 'alice', balance: 1 } }) },
    refresh: vi.fn(() => Promise.resolve()),
    manage,
    signOut: vi.fn(),
  }
  const observable = source({ status: 'ready', account: { displayName: 'alice', balance: 1 } })
  const props = {
    usePanelInfo: () => { throw new Error('unexpected panel hook') },
    useSessions: () => { throw new Error('unexpected sessions hook') },
    useSessionStatus: () => { throw new Error('unexpected status hook') },
    useSessionRetainInfo: () => { throw new Error('unexpected retain hook') },
    useWorkspaces: () => { throw new Error('unexpected workspace hook') },
    useResource: () => { throw new Error('unexpected resource hook') },
    refresh: operations.refresh, manage: operations.manage, signOut: operations.signOut,
    useAccount: <T,>(selector: (value: TFlowAccountSnapshot) => T): T => selector(observable.getSnapshot()),
    wide: true, settingsOpen: false, openSettings, openOnboarding: () => {}, t: copySeat(zh),
  } as Parameters<typeof TFlowAccountMenu>[0]
  render(<TFlowAccountMenu {...props} />)
  // The sidebar is the first account surface on screen; without this read the name never replaces the fallback.
  expect(operations.refresh).toHaveBeenCalledOnce()
  expect(screen.getByRole('button', { name: zh.nav }).textContent).toBe('alice')
  fireEvent.click(screen.getByRole('button', { name: zh.nav }))
  expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual([zh.settings, zh.manage, zh.signOut])
  await expect(`${screen.getByRole('menu').textContent}\n`).toMatchFileSnapshot('./expected/menu-zh.txt')
  fireEvent.click(screen.getByRole('menuitem', { name: zh.settings }))
  expect(openSettings).toHaveBeenCalledOnce()
  expect(manage).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: zh.nav }))
  fireEvent.click(screen.getByRole('menuitem', { name: zh.signOut }))
  expect(operations.signOut).toHaveBeenCalledOnce()
})

it('opens the account site from the launcher and hides the name in the collapsed rail', async () => {
  const manage = vi.fn()
  const operations: TFlowAccountInjected = {
    hooks: { account: source({ status: 'signed-out' }) },
    refresh: vi.fn(() => Promise.resolve()),
    manage,
    signOut: vi.fn(),
  }
  const observable = source({ status: 'signed-out' })
  const props = {
    usePanelInfo: () => { throw new Error('unexpected panel hook') },
    useSessions: () => { throw new Error('unexpected sessions hook') },
    useSessionStatus: () => { throw new Error('unexpected status hook') },
    useSessionRetainInfo: () => { throw new Error('unexpected retain hook') },
    useWorkspaces: () => { throw new Error('unexpected workspace hook') },
    useResource: () => { throw new Error('unexpected resource hook') },
    refresh: operations.refresh, manage: operations.manage,
    useAccount: <T,>(selector: (value: TFlowAccountSnapshot) => T): T => selector(observable.getSnapshot()),
    wide: false, settingsOpen: false, signOut: operations.signOut, openSettings: vi.fn(), openOnboarding: () => {}, t: copySeat(en),
  } as Parameters<typeof TFlowAccountMenu>[0]
  render(<TFlowAccountMenu {...props} />)
  expect(screen.getByRole('button', { name: en.nav }).textContent).toBe('')
  fireEvent.click(screen.getByRole('button', { name: en.nav }))
  fireEvent.click(screen.getByRole('menuitem', { name: en.manage }))
  expect(manage).toHaveBeenCalledOnce()
})

it('ships the same key set in both languages', () => {
  expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
})

/** Mount the usage section over one published snapshot. */
function mountUsage(snapshot: TFlowUsageSnapshot, refresh = vi.fn(() => Promise.resolve())) {
  // Same seat subset as `mountSection`: the section reads no framework seats.
  const props = {
    usePanelInfo: () => { throw new Error('unexpected panel hook') },
    useSessions: () => { throw new Error('unexpected sessions hook') },
    useSessionStatus: () => { throw new Error('unexpected status hook') },
    useSessionRetainInfo: () => { throw new Error('unexpected retain hook') },
    useWorkspaces: () => { throw new Error('unexpected workspace hook') },
    useResource: () => { throw new Error('unexpected resource hook') },
    close: () => {},
    refresh,
    useUsage: <T,>(selector: (value: TFlowUsageSnapshot) => T): T => selector(snapshot),
    t: copySeat(zh),
  } as Parameters<typeof TFlowUsageSection>[0]
  render(<TFlowUsageSection {...props} />)
  return refresh
}

it('reports today and all-time usage with the amount the panel deducted', async () => {
  mountUsage({
    status: 'ready',
    usage: { today: { requests: 4, tokens: 1200, cost: 0.0042 }, total: { requests: 90, tokens: 56000, cost: 9.6 } },
  })
  expect(screen.getByRole('region').getAttribute('aria-label')).toBe(zh.usage)
  const today = screen.getByRole('group', { name: zh.today })
  // A sub-cent charge stays visible instead of rounding to $0.00.
  expect(today.textContent).toContain('$0.0042')
  expect(screen.getByRole('group', { name: zh.total }).textContent).toContain('56,000')
  await expect(`${screen.getByRole('region').textContent}\n`).toMatchFileSnapshot('./expected/usage-zh.txt')
})

it('asks for a sign-in rather than showing zero usage', () => {
  mountUsage({ status: 'signed-out' })
  expect(screen.getByText(zh.usageSignInRequired)).toBeTruthy()
  expect(document.body.textContent).not.toContain('$')
})

it('offers a retry after a failed usage read', async () => {
  const refresh = mountUsage({ status: 'failed' })
  await act(async () => { await Promise.resolve() })
  expect(screen.getByText(zh.usageFailed)).toBeTruthy()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh.retry })); await Promise.resolve() })
  expect(refresh).toHaveBeenCalledTimes(2)
})

it('shows usage loading before the first read settles', () => {
  mountUsage({ status: 'loading' })
  expect(screen.getByText(zh.loading)).toBeTruthy()
})

it('does not update retry state after the section unmounts', async () => {
  const pending = Promise.withResolvers<undefined>()
  mountSection({ status: 'failed' }, en, vi.fn(() => pending.promise))
  cleanup()
  await act(async () => { pending.resolve(undefined); await pending.promise })
})

it('closes the launcher on Escape and uses the navigation label without an account', async () => {
  const props = {
    usePanelInfo: () => { throw new Error('unexpected panel hook') },
    useSessions: () => { throw new Error('unexpected sessions hook') },
    useSessionStatus: () => { throw new Error('unexpected status hook') },
    useSessionRetainInfo: () => { throw new Error('unexpected retain hook') },
    useWorkspaces: () => { throw new Error('unexpected workspace hook') },
    useResource: () => { throw new Error('unexpected resource hook') },
    wide: true, settingsOpen: false, openSettings: vi.fn(), openOnboarding: vi.fn(),
    useAccount: <T,>(selector: (value: TFlowAccountSnapshot) => T): T => selector({ status: 'signed-out' }),
    refresh: vi.fn(() => Promise.resolve()), manage: vi.fn(), signOut: vi.fn(), t: copySeat(en),
  } as Parameters<typeof TFlowAccountMenu>[0]
  render(<TFlowAccountMenu {...props} />)
  expect(screen.getByRole('button', { name: en.nav }).textContent).toBe(en.nav)
  fireEvent.click(screen.getByRole('button', { name: en.nav }))
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
  expect(screen.queryByRole('menu')).toBeNull()
})
