/**
 * TFlow usage settings: requests, tokens, and deducted amount for today and
 * for the account's whole history.
 *
 * Every value comes from the panel's dashboard statistics through the desktop
 * shell. The component derives nothing; cost is the amount the panel deducted.
 *
 * @module
 */
import { useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './AccountSection.module.css'

/** Totals for one usage period, as the panel reports them. */
export interface TFlowUsagePeriodView {
  readonly requests: number
  readonly tokens: number
  /** Deducted amount in USD; rendered to four decimals because single requests cost fractions of a cent. */
  readonly cost: number
}

/** Usage the shell reported for the signed-in account. */
export interface TFlowUsageView {
  readonly today: TFlowUsagePeriodView
  readonly total: TFlowUsagePeriodView
}

/** Usage read outcome; `signed-out` and `failed` are different states with different actions. */
export type TFlowUsageSnapshot =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly usage: TFlowUsageView }
  | { readonly status: 'signed-out' }
  | { readonly status: 'failed' }

/** Shell operations the usage section depends on. */
export interface TFlowUsageInjected {
  /** Usage read outcome, published by the registrant and observed through a framework hook. */
  hooks: { usage: { getSnapshot: () => TFlowUsageSnapshot; subscribe: (listener: () => void) => () => void } }
  /** @returns after the usage read settles; concurrent refreshes share one request. */
  refresh: () => Promise<void>
}

/** Composed props for the TFlow usage section. */
export type TFlowUsageSectionProps =
  PropsRuntime<'settings.section'> & PropsLocale<'settings.accountTflow'> & InjectFace<TFlowUsageInjected>

/** The two periods the panel reports, in display order. */
const PERIODS = ['today', 'total'] as const

/**
 * Render the signed-in account's usage.
 * @param props - localized copy, injected usage hook, and refresh action.
 * @returns one card per period with request, token, and cost rows.
 */
export function TFlowUsageSection({ t, useUsage, refresh }: TFlowUsageSectionProps) {
  const snapshot = useUsage(value => value)
  const [busy, setBusy] = useState(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => { void runRefresh() }, [refresh])

  /** One refresh with a busy state the retry button reflects. */
  async function runRefresh(): Promise<void> {
    setBusy(true)
    try { await refresh() }
    catch {
      // The hook carries the failure state; a rejected refresh is already reported there.
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  if (snapshot.status === 'signed-out') {
    return <section className={css.section} aria-label={t('usage')}>
      <p className={css.secondary} role="status">{t('usageSignInRequired')}</p>
    </section>
  }
  if (snapshot.status === 'loading') {
    return <section className={css.section} aria-label={t('usage')}>
      <p className={css.secondary} role="status">{t('loading')}</p>
    </section>
  }
  if (snapshot.status === 'failed') {
    return <section className={css.section} aria-label={t('usage')}>
      <p className={css.secondary} role="status">{t('usageFailed')}</p>
      <button type="button" className={css.retry} disabled={busy} onClick={() => { void runRefresh() }}>{t('retry')}</button>
    </section>
  }

  const { usage } = snapshot
  return <section className={css.section} aria-label={t('usage')}>
    {PERIODS.map(period => <div key={period} className={css.balanceCard} role="group" aria-label={t(period)}>
      <div className={css.name}>{t(period)}</div>
      <div className={css.divider} />
      <div className={css.row}><span>{t('requests')}</span><span className={css.amount}>{usage[period].requests.toLocaleString('en-US')}</span></div>
      <div className={css.divider} />
      <div className={css.row}><span>{t('tokens')}</span><span className={css.amount}>{usage[period].tokens.toLocaleString('en-US')}</span></div>
      <div className={css.divider} />
      <div className={css.row}><span>{t('cost')}</span><span className={css.amount}>{`$${usage[period].cost.toFixed(4)}`}</span></div>
    </div>)}
  </section>
}
