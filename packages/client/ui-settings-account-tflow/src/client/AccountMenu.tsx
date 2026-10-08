/**
 * Sidebar account launcher for the TFlow edition.
 * Settings owns the usage page; account management and sign-out delegate to the desktop shell.
 * @module
 */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Menu, IconSettingsOutlineMedium, IconRightUpOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { useEffect, useState } from 'react'
import type { TFlowAccountInjected } from './AccountSection.tsx'
import css from './AccountMenu.module.css'

/** Launcher props composed by the settings shell. */
export type TFlowAccountMenuProps =
  PropsRuntime<'settings.launcher'> & PropsLocale<'settings.accountTflow'> & InjectFace<TFlowAccountInjected>

/**
 * Render the sidebar account launcher.
 * @param props - sidebar geometry, settings navigation, and account access.
 * @returns the launcher and its menu.
 */
export function TFlowAccountMenu({ wide, openSettings, useAccount, refresh, manage, signOut, t }: TFlowAccountMenuProps) {
  const snapshot = useAccount(value => value)
  const [open, setOpen] = useState(false)
  // The launcher is the first account surface on screen, so it starts the read that fills in the username.
  useEffect(() => { void refresh() }, [refresh])
  const label = snapshot.status === 'ready' ? snapshot.account.displayName : null
  return <div className={css.root}>
    <Menu open={open} side="top" portal autoFocus className={css.anchor}
      anchor={<button type="button" className={css.trigger} data-collapsed={!wide} aria-label={t('nav')}
        aria-haspopup="menu" aria-expanded={open} onClick={() => { setOpen(value => !value) }}>
        {wide && <span className={css.label}>{label ?? t('nav')}</span>}
      </button>}
      items={[
        { id: 'settings', label: t('settings'), icon: <IconSettingsOutlineMedium size={16} /> },
        { id: 'manage', label: t('manage'), icon: <IconRightUpOutlineRegular size={16} /> },
        { id: 'sign-out', label: t('signOut') },
      ]}
      onClose={() => { setOpen(false) }}
      onSelect={(id) => {
        setOpen(false)
        if (id === 'settings') openSettings()
        else if (id === 'manage') manage()
        else void signOut()
      }} />
  </div>
}
