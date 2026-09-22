// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import {
  TFlowAccountSection,
  type TFlowAccountInjected,
  type TFlowAccountSnapshot,
} from '../src/client/AccountSection.tsx'
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
  const operations: TFlowAccountInjected = { hooks: { account: source(snapshot) }, refresh, manage: vi.fn() }
  const observable = source(snapshot)
  // The section consumes no slot-derived share beyond the inject face, so the
  // stub supplies the three seats it reads and no framework seats.
  const props = {
    close: () => {},
    refresh: operations.refresh,
    manage: operations.manage,
    useAccount: (selector: (value: TFlowAccountSnapshot) => unknown) => selector(observable.getSnapshot()),
    t: copySeat(copy),
  } as unknown as Parameters<typeof TFlowAccountSection>[0]
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
  }
  const observable = source({ status: 'ready', account: { displayName: 'alice', balance: 1 } })
  const props = {
    refresh: operations.refresh, manage: operations.manage,
    useAccount: (selector: (value: TFlowAccountSnapshot) => unknown) => selector(observable.getSnapshot()),
    wide: true, openSettings, openOnboarding: () => {}, t: copySeat(zh),
  } as unknown as Parameters<typeof TFlowAccountMenu>[0]
  render(<TFlowAccountMenu {...props} />)
  expect(screen.getByRole('button', { name: zh.nav }).textContent).toBe('alice')
  fireEvent.click(screen.getByRole('button', { name: zh.nav }))
  expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual([zh.settings, zh.manage])
  await expect(`${screen.getByRole('menu').textContent}\n`).toMatchFileSnapshot('./expected/menu-zh.txt')
  fireEvent.click(screen.getByRole('menuitem', { name: zh.settings }))
  expect(openSettings).toHaveBeenCalledOnce()
  expect(manage).not.toHaveBeenCalled()
})

it('opens the account site from the launcher and hides the name in the collapsed rail', async () => {
  const manage = vi.fn()
  const operations: TFlowAccountInjected = {
    hooks: { account: source({ status: 'signed-out' }) },
    refresh: vi.fn(() => Promise.resolve()),
    manage,
  }
  const observable = source({ status: 'signed-out' })
  const props = {
    refresh: operations.refresh, manage: operations.manage,
    useAccount: (selector: (value: TFlowAccountSnapshot) => unknown) => selector(observable.getSnapshot()),
    wide: false, openSettings: vi.fn(), openOnboarding: () => {}, t: copySeat(en),
  } as unknown as Parameters<typeof TFlowAccountMenu>[0]
  render(<TFlowAccountMenu {...props} />)
  expect(screen.getByRole('button', { name: en.nav }).textContent).toBe('')
  fireEvent.click(screen.getByRole('button', { name: en.nav }))
  fireEvent.click(screen.getByRole('menuitem', { name: en.manage }))
  expect(manage).toHaveBeenCalledOnce()
})

it('ships the same key set in both languages', () => {
  expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
})
