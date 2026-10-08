/**
 * TFlow account settings: identity, balance, and the subscription covering the
 * selected group.
 *
 * Every value here comes from the panel through the desktop shell, which owns
 * the session. The component holds no session state of its own and derives
 * nothing: the entitlement is one server fact, and a window missing from it is
 * a window the panel did not report rather than a zero.
 *
 * @module
 */
import { useRefresh } from './use-refresh.ts'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './AccountSection.module.css'

/** Remaining allowance for one subscription window, in USD as the panel reports it. */
export interface TFlowRemainingView {
  readonly daily?: number
  readonly weekly?: number
  readonly monthly?: number
}

/** One selectable group's subscription state, as this section renders it. */
export interface TFlowSubscriptionView {
  readonly groupName: string
  readonly remaining: TFlowRemainingView
}

/** The entitlement the shell reported for the signed-in account. */
export interface TFlowAccountView {
  readonly displayName: string
  readonly balance: number
  readonly subscription?: TFlowSubscriptionView
}

/** Account read outcome; `signed-out` and `failed` are different states with different actions. */
export type TFlowAccountSnapshot =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly account: TFlowAccountView }
  | { readonly status: 'signed-out' }
  | { readonly status: 'failed' }

/** Shell operations this section depends on. */
export interface TFlowAccountInjected {
  /** Account read outcome, published by the registrant and observed through a framework hook. */
  hooks: { account: { getSnapshot: () => TFlowAccountSnapshot; subscribe: (listener: () => void) => () => void } }
  /** @returns after the account read settles; concurrent refreshes share one request. */
  refresh: () => Promise<void>
  /** Open the TFlow account site in the operating system browser. */
  manage: () => void
  /** Sign out and return to the TFlow login window. */
  signOut: () => Promise<void>
}

/** Composed props for the TFlow account section. */
export type TFlowAccountSectionProps =
  PropsRuntime<'settings.section'> & PropsLocale<'settings.accountTflow'> & InjectFace<TFlowAccountInjected>

/** The three windows the panel may report, in display order. */
const WINDOWS = ['daily', 'weekly', 'monthly'] as const

/**
 * Render one amount the panel reported.
 * @param value - amount in USD.
 * @returns the formatted amount.
 */
function amount(value: number): string {
  return `$${value.toFixed(2)}`
}

/**
 * Render the signed-in TFlow account.
 * @param props - localized copy, injected account hook, and refresh action.
 * @returns identity card plus balance and subscription rows.
 */
export function TFlowAccountSection({ t, useAccount, refresh, manage }: TFlowAccountSectionProps) {
  const snapshot = useAccount(value => value)
  const { busy, runRefresh } = useRefresh(refresh)

  if (snapshot.status === 'signed-out') {
    return <section className={css.section} aria-label={t('nav')}>
      <p className={css.secondary} role="status">{t('signInRequired')}</p>
    </section>
  }
  if (snapshot.status === 'loading') {
    return <section className={css.section} aria-label={t('nav')}>
      <p className={css.secondary} role="status">{t('loading')}</p>
    </section>
  }
  if (snapshot.status === 'failed') {
    return <section className={css.section} aria-label={t('nav')}>
      <p className={css.secondary} role="status">{t('failed')}</p>
      <button type="button" className={css.retry} disabled={busy} onClick={() => { void runRefresh() }}>{t('retry')}</button>
    </section>
  }

  const { account } = snapshot
  const subscription = account.subscription
  const reported = subscription === undefined
    ? []
    : WINDOWS.flatMap((window) => {
      const value = subscription.remaining[window]
      return value === undefined ? [] : [{ window, value }]
    })
  return <section className={css.section} aria-label={t('nav')}>
    <div className={css.card}>
      <div className={css.identityCopy}>
        <span className={css.name}>{account.displayName}</span>
      </div>
    </div>
    <div className={css.balanceCard}>
      <div className={css.row}>
        <span>{t('balance')}</span>
        <span className={css.amount}>{amount(account.balance)}</span>
      </div>
      <div className={css.divider} />
      <div className={css.row}>
        <span>{t('subscription')}</span>
        <span className={subscription === undefined ? css.unavailable : css.amount}>
          {subscription === undefined ? t('subscriptionNone') : subscription.groupName}
        </span>
      </div>
      {reported.length > 0 && <>
        <div className={css.divider} />
        <div className={css.row}>
          <span>{t('remaining')}</span>
          <span className={css.amount}>
            {reported.map(({ window, value }) => <span key={window}>{`${t(window)} ${amount(value)}`}</span>)}
          </span>
        </div>
      </>}
      <div className={css.divider} />
      <div className={css.row}>
        <button type="button" className={css.linkButton} onClick={manage}>{t('manage')}</button>
      </div>
    </div>
  </section>
}
