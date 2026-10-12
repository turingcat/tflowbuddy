import { TFlowLogo } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * Render the official mark with the presentation requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the TFlowBuddy robot icon.
 */
export function OfficialBrandMark({ size }: SidebarBrandMarkOwnerProps) {
  return <TFlowLogo size={size} />
}

/**
 * Render the product name using the sidebar's typography.
 * @param props - Brand dictionary supplied by the locale service.
 * @returns the official name wordmark.
 */
export function OfficialBrandName({ t }: PropsLocale<'brand.tflow'>) {
  return <span>{t('productName')}</span>
}
