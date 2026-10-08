/**
 * TFlow account surface registration: the account and usage settings sections
 * and the sidebar launcher.
 *
 * This edition signs in through the TFlow panel, which the Electron shell owns,
 * so the account surface reads the shell's bridge instead of the Host account
 * Remote the DeepSeek edition uses. Every payload crossing that bridge is
 * validated here, because a bridge is a process boundary rather than a typed
 * same-process call.
 *
 * @module
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { TFlowAccountInjected, TFlowAccountSnapshot } from './AccountSection.tsx'
import { TFlowAccountSection } from './AccountSection.tsx'
import { TFlowAccountMenu } from './AccountMenu.tsx'
import { TFlowUsageSection, type TFlowUsageInjected, type TFlowUsageSnapshot } from './UsageSection.tsx'
import { en, zh, type TFlowAccountKey } from './locales.ts'

export type { TFlowAccountInjected, TFlowAccountSnapshot, TFlowAccountView, TFlowRemainingView } from './AccountSection.tsx'
export type { TFlowUsageInjected, TFlowUsagePeriodView, TFlowUsageSnapshot, TFlowUsageView } from './UsageSection.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'settings.accountTflow': TFlowAccountKey }
}

/** Account site opened for balance, subscription, and payment management. */
const ACCOUNT_SITE = 'https://www.tflow.online/dashboard'

/**
 * Priority that yields to the DeepSeek account launcher without colliding with
 * its cell; the edition profile overlay disables that launcher's row.
 * `settings.launcher` is a single-cell slot, and two registrations at the same
 * priority are refused; registering higher leaves the other edition's
 * registration intact and lets this one render where that one is absent.
 */
const LAUNCHER_PRIORITY = 1

/** Bridge the Electron shell exposes to desktop renderers. */
interface TFlowDesktopAccount {
  /** @returns the entitlement the shell read, or null while signed out or after a failed read. */
  read: () => Promise<unknown>
  /** @returns the usage the shell read, or null while signed out or after a failed read. */
  usage: () => Promise<unknown>
  /** Sign out the desktop session and reopen the login window. */
  signOut: () => Promise<void>
}

/** Services required by the account surface. */
export const inject = ['slots', 'locale']

/**
 * Read the shell's account bridge, or `undefined` outside a desktop renderer.
 * @returns the bridge when this renderer was loaded by the Electron shell.
 */
function desktopAccount(): TFlowDesktopAccount | undefined {
  return (globalThis as typeof globalThis & { dshDesktopAccount?: TFlowDesktopAccount }).dshDesktopAccount
}

/** A JSON object, as every field of a bridge payload must be. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read one optional amount the panel reported.
 * @param source - window entry.
 * @param field - amount field name.
 * @returns the amount, or `undefined` when the panel omitted it.
 */
function amountOf(source: Record<string, unknown>, field: string): number | undefined {
  const value = source[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Validate one entitlement the shell reported.
 *
 * A payload this build cannot render is a failure rather than a partial card:
 * showing a balance beside a silently dropped subscription would misreport what
 * the account holds.
 * @param value - value the bridge returned.
 * @returns the snapshot to render.
 */
function validateSnapshot(value: unknown): TFlowAccountSnapshot {
  if (!isRecord(value)) return { status: 'failed' }
  const { displayName, balance, subscription } = value
  if (typeof displayName !== 'string' || displayName === '') return { status: 'failed' }
  if (typeof balance !== 'number' || !Number.isFinite(balance)) return { status: 'failed' }
  if (subscription === undefined) return { status: 'ready', account: { displayName, balance } }
  if (!isRecord(subscription) || typeof subscription['groupName'] !== 'string' || subscription['groupName'] === '') {
    return { status: 'failed' }
  }
  const reported = subscription['remaining']
  if (!isRecord(reported)) return { status: 'failed' }
  const remaining: { daily?: number; weekly?: number; monthly?: number } = {}
  for (const window of ['daily', 'weekly', 'monthly'] as const) {
    if (reported[window] === undefined) continue
    const amount = amountOf(reported, window)
    if (amount === undefined) return { status: 'failed' }
    remaining[window] = amount
  }
  if (Object.keys(remaining).length === 0) return { status: 'failed' }
  return { status: 'ready', account: { displayName, balance, subscription: { groupName: subscription['groupName'], remaining } } }
}

/**
 * Read one usage period the shell reported.
 * @param value - period entry.
 * @returns the period, or `undefined` when any total is missing.
 */
function periodOf(value: unknown): { requests: number; tokens: number; cost: number } | undefined {
  if (!isRecord(value)) return undefined
  const requests = amountOf(value, 'requests')
  const tokens = amountOf(value, 'tokens')
  const cost = amountOf(value, 'cost')
  return requests === undefined || tokens === undefined || cost === undefined ? undefined : { requests, tokens, cost }
}

/**
 * Validate the usage the shell reported. A missing total is a failure rather
 * than a zero, which would misreport what the account has spent.
 * @param value - value the bridge returned.
 * @returns the snapshot to render.
 */
function validateUsage(value: unknown): TFlowUsageSnapshot {
  if (!isRecord(value)) return { status: 'failed' }
  const today = periodOf(value['today'])
  const total = periodOf(value['total'])
  return today === undefined || total === undefined ? { status: 'failed' } : { status: 'ready', usage: { today, total } }
}

/** Read outcomes shared by the account and usage snapshots. */
type BridgeReadState = { readonly status: 'loading' } | { readonly status: 'signed-out' } | { readonly status: 'failed' }

/**
 * Hold the latest outcome of one bridge read for a framework hook.
 * @param read - bridge operation; null or undefined means signed out.
 * @param validate - payload validation for a signed-in answer.
 * @returns the observable snapshot and a refresh whose concurrent callers share one request.
 */
function bridgeRead<S extends { readonly status: string }>(read: () => Promise<unknown>, validate: (value: unknown) => S) {
  let snapshot: S | BridgeReadState = { status: 'loading' }
  const listeners = new Set<() => void>()
  const publish = (value: S | BridgeReadState): void => {
    snapshot = value
    for (const listener of listeners) listener()
  }
  let running: Promise<void> | undefined
  const refresh = (): Promise<void> => {
    running ??= (async () => {
      try {
        const value = await read()
        publish(value === null || value === undefined ? { status: 'signed-out' } : validate(value))
      } catch {
        publish({ status: 'failed' })
      } finally {
        running = undefined
      }
    })()
    return running
  }
  return {
    hook: {
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    },
    refresh,
  }
}

/**
 * Register the TFlow account surface.
 * @param ctx - client plugin context.
 */
export function apply(ctx: Context): void {
  const bridge = desktopAccount()
  if (bridge === undefined) return
  ctx.effect(() => ctx.locale.register('settings.accountTflow', { en, zh }), 'account-tflow: dictionaries')
  const t = ctx.locale.bind('settings.accountTflow')

  const account = bridgeRead(() => bridge.read(), validateSnapshot)
  const usage = bridgeRead(() => bridge.usage(), validateUsage)
  const usageInjected = (): TFlowUsageInjected => ({ hooks: { usage: usage.hook }, refresh: usage.refresh })

  const injected = (): TFlowAccountInjected => ({
    hooks: { account: account.hook },
    refresh: account.refresh,
    manage: () => { window.open(ACCOUNT_SITE, '_blank', 'noopener,noreferrer') },
    signOut: bridge.signOut,
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'tflow-account',
    order: -10,
    label: () => t('nav'),
    locale: 'settings.accountTflow',
    inject: injected,
  }, TFlowAccountSection))

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'tflow-usage',
    order: -9,
    label: () => t('usage'),
    locale: 'settings.accountTflow',
    inject: usageInjected,
  }, TFlowUsageSection))

  ctx.slots.inject('settings.launcher', () => ctx.slots.register({
    name: 'settings.launcher',
    priority: LAUNCHER_PRIORITY,
    locale: 'settings.accountTflow',
    inject: injected,
  }, TFlowAccountMenu))
}
