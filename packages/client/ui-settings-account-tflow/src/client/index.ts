/**
 * TFlow account surface registration: the settings section and the sidebar
 * launcher.
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
import { en, zh, type TFlowAccountKey } from './locales.ts'

export type { TFlowAccountInjected, TFlowAccountSnapshot, TFlowAccountView, TFlowRemainingView } from './AccountSection.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'settings.accountTflow': TFlowAccountKey }
}

/** Account site opened for balance, subscription, and payment management. */
const ACCOUNT_SITE = 'https://tflow.online'

/**
 * Priority that shadows the DeepSeek account launcher without colliding with
 * its cell. `settings.launcher` is a single-cell slot, and two registrations at
 * the same priority are refused; registering higher leaves the other edition's
 * registration intact and lets this one render where that one is absent.
 */
const LAUNCHER_PRIORITY = 1

/** Bridge the Electron shell exposes to desktop renderers. */
interface TFlowDesktopAccount {
  /** @returns the entitlement the shell read, or null while signed out or after a failed read. */
  read: () => Promise<unknown>
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
 * Register the TFlow account surface.
 * @param ctx - client plugin context.
 */
export function apply(ctx: Context): void {
  const bridge = desktopAccount()
  if (bridge === undefined) return
  ctx.effect(() => ctx.locale.register('settings.accountTflow', { en, zh }), 'account-tflow: dictionaries')
  const t = ctx.locale.bind('settings.accountTflow')

  let snapshot: TFlowAccountSnapshot = { status: 'loading' }
  const listeners = new Set<() => void>()
  const publish = (value: TFlowAccountSnapshot): void => {
    snapshot = value
    for (const listener of listeners) listener()
  }
  let running: Promise<void> | undefined

  /** One account read; a concurrent caller joins the request already in flight. */
  const refresh = (): Promise<void> => {
    running ??= (async () => {
      try {
        const value = await bridge.read()
        publish(value === null || value === undefined ? { status: 'signed-out' } : validateSnapshot(value))
      } catch {
        publish({ status: 'failed' })
      } finally {
        running = undefined
      }
    })()
    return running
  }

  const injected = (): TFlowAccountInjected => ({
    hooks: {
      account: {
        getSnapshot: () => snapshot,
        subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      },
    },
    refresh,
    manage: () => { window.open(ACCOUNT_SITE, '_blank', 'noopener,noreferrer') },
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'tflow-account',
    order: -10,
    label: () => t('nav'),
    locale: 'settings.accountTflow',
    inject: injected,
  }, TFlowAccountSection))

  ctx.slots.inject('settings.launcher', () => ctx.slots.register({
    name: 'settings.launcher',
    priority: LAUNCHER_PRIORITY,
    locale: 'settings.accountTflow',
    inject: injected,
  }, TFlowAccountMenu))
}
