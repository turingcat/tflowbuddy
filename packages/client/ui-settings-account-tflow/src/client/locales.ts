/** TFlow account settings copy, owned by this feature. */
export const en = {
  nav: 'Account',
  settings: 'Settings',
  signedInAs: 'Signed in as {name}',
  signInRequired: 'Sign in with your TFlow account to see your balance.',
  loading: 'Loading…',
  failed: 'Could not read the account. Try again.',
  retry: 'Retry',
  balance: 'Balance',
  balanceUnavailable: 'Not reported by TFlow',
  subscription: 'Subscription',
  subscriptionNone: 'No subscription for this group',
  remaining: 'Remaining',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  amountUnavailable: '—',
  manage: 'Manage on the TFlow website',
  notSupported: 'Not available in the desktop app',
} as const

/** TFlow account locale keys. */
export type TFlowAccountKey = keyof typeof en

/** Chinese TFlow account copy; the product's audience reads this by default. */
export const zh: Record<TFlowAccountKey, string> = {
  nav: '账号与余额',
  settings: '设置',
  signedInAs: '已登录：{name}',
  signInRequired: '登录 TFlow 账号后即可查看余额。',
  loading: '加载中…',
  failed: '未能读取账号信息，请重试。',
  retry: '重试',
  balance: '余额',
  balanceUnavailable: 'TFlow 未返回余额',
  subscription: '订阅',
  subscriptionNone: '当前分组没有订阅',
  remaining: '剩余额度',
  daily: '日',
  weekly: '周',
  monthly: '月',
  amountUnavailable: '—',
  manage: '前往 TFlow 网站管理账号',
  notSupported: '桌面端不提供此操作',
}
