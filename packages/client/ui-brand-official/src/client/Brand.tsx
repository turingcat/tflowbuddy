import { TFlowLogo } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * Render the official mark with the presentation requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the TFlow app badge.
 */
export function OfficialBrandMark({ size }: SidebarBrandMarkOwnerProps) {
  return <TFlowLogo size={size} />
}

/**
 * Render the official name artwork without its independently slotted mark.
 * @param props - Brand dictionary supplied by the locale service.
 * @returns the official name wordmark.
 */
export function OfficialBrandName({ t }: PropsLocale<'brand.tflow'>) {
  return <svg viewBox="26 0 156 24" role="img" aria-label={t('productName')}>
    <text x="0" y="18">{t('productName')}</text>
  </svg>
}
