/** Native welcome window and its presentation-only renderer. */

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import { resolveWelcomeLocale, type DesktopLocale } from './locale.ts'
import type { TFlowLoginBackend } from './tflow/login-backend.ts'
import { installTFlowLoginIpc } from './tflow/login-ipc.ts'

/**
 * Resolve the fixed-size welcome window's native material and controls.
 * @param platform - operating system hosting Electron.
 * @param locale - shell-owned localized copy.
 * @returns sandboxed window options with a locale-only preload.
 */
export function welcomeWindowOptions(platform: NodeJS.Platform, locale: DesktopLocale): BrowserWindowConstructorOptions {
  return {
    width: 600,
    height: 700,
    useContentSize: true,
    center: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: locale.messages.welcomeTitle,
    backgroundColor: platform === 'darwin' || platform === 'win32' ? '#00000000' : '#FFFFFF',
    ...(platform === 'darwin' ? {
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 21, y: 21 },
      vibrancy: 'menu',
      visualEffectState: 'active',
    } as const : {}),
    ...(platform === 'win32' ? {
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#00000000', symbolColor: '#0F1115', height: 42 },
      backgroundMaterial: 'acrylic',
    } as const : {}),
    webPreferences: {
      preload: fileURLToPath(new URL('./preload-tflow.cjs', import.meta.url)),
      // The sign-in surface opens in the product's challenge language rather
      // than the operating-system language; the workspace keeps the user's own.
      additionalArguments: [`--dsh-welcome-locale=${resolveWelcomeLocale().id}`],
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      devTools: platform !== 'darwin' || process.env.DSH_DESKTOP_OPEN_DEVTOOLS !== '0',
    },
  }
}

/** What the welcome window reports to its owner while it is open. */
export interface WelcomeOperations {
  /** @returns whether the window may hand off to the workspace. */
  enterWorkspace(): Promise<void>
}

let disposeActiveHandlers: (() => void) | undefined

/**
 * Open the process's sole welcome window over one TFlow sign-in flow.
 * Replaces IPC ownership immediately; the caller closes the previous native window.
 * @param locale - shell-owned localized copy for native window chrome.
 * @param backend - TFlow sign-in driver owning the session.
 * @param operations - workspace handoff.
 * @returns the visible window; a failed load destroys it before rejecting.
 */
export async function openWelcomeWindow(
  locale: DesktopLocale,
  backend: TFlowLoginBackend,
  operations: WelcomeOperations,
): Promise<BrowserWindow> {
  const window = new BrowserWindow(welcomeWindowOptions(process.platform, locale))
  disposeActiveHandlers?.()
  const disposeHandlers = installTFlowLoginIpc(window, backend, () => operations.enterWorkspace())
  disposeActiveHandlers = disposeHandlers
  window.once('closed', () => {
    disposeHandlers()
    if (disposeActiveHandlers === disposeHandlers) disposeActiveHandlers = undefined
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => { event.preventDefault() })
  try {
    await window.loadFile(join(app.getAppPath(), 'renderer', 'welcome.html'))
  } catch (error) {
    disposeHandlers()
    if (!window.isDestroyed()) window.destroy()
    throw error
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- another window can replace ownership during loadFile.
  if (disposeActiveHandlers === disposeHandlers && !window.isDestroyed()) window.show()
  return window
}
