/** Localized TFlow sign-in operations for the isolated welcome renderer. */

import { contextBridge, ipcRenderer } from 'electron'
import { TFLOW_IPC, type TFlowLoginBootstrap, type TFlowLoginView, type TFlowStartInput } from './tflow/login-api.ts'
import { resolveWelcomeLocale, isWelcomeLocale, type DesktopLocale } from './locale.ts'

/** Window argument carrying the locale the shell created this window with. */
const LOCALE_ARGUMENT = '--dsh-welcome-locale='

/** The window-exposed TFlow sign-in API; no credential ever crosses it. */
export interface TFlowWelcomeApi {
  /** Shell-owned copy for the sign-in surface. */
  readonly messages: DesktopLocale['messages']
  /** @returns the current view and the captcha facts the form needs. */
  bootstrap(): Promise<TFlowLoginBootstrap>
  /** @param input - account address, password, and captcha proof. @returns the settled view. */
  start(input: TFlowStartInput): Promise<TFlowLoginView>
  /** @param code - six-digit authenticator code. @returns the settled view. */
  complete(code: string): Promise<TFlowLoginView>
  /** @param groupId - group to provision the model key for. @returns the settled view. */
  selectGroup(groupId: string): Promise<TFlowLoginView>
  /** @returns the signed-out view. */
  signOut(): Promise<TFlowLoginView>
  /** @returns the view after abandoning an attempt. */
  cancel(): Promise<TFlowLoginView>
  /** Ask the shell to reveal the workspace; used when the stored record was already valid. */
  enterWorkspace(): Promise<void>
  /** @param listener - view recipient. @returns subscription disposer. */
  onView(listener: (view: TFlowLoginView) => void): () => void
}

const argument = process.argv.find(value => value.startsWith(LOCALE_ARGUMENT))?.slice(LOCALE_ARGUMENT.length)
if (!isWelcomeLocale(argument)) throw new Error('desktop welcome: unsupported window locale')

const api: TFlowWelcomeApi = {
  messages: resolveWelcomeLocale().messages,
  bootstrap: () => ipcRenderer.invoke(TFLOW_IPC.bootstrap) as Promise<TFlowLoginBootstrap>,
  start: input => ipcRenderer.invoke(TFLOW_IPC.start, input) as Promise<TFlowLoginView>,
  complete: code => ipcRenderer.invoke(TFLOW_IPC.complete, code) as Promise<TFlowLoginView>,
  selectGroup: groupId => ipcRenderer.invoke(TFLOW_IPC.selectGroup, groupId) as Promise<TFlowLoginView>,
  signOut: () => ipcRenderer.invoke(TFLOW_IPC.signOut) as Promise<TFlowLoginView>,
  cancel: () => ipcRenderer.invoke(TFLOW_IPC.cancel) as Promise<TFlowLoginView>,
  enterWorkspace: () => ipcRenderer.invoke(TFLOW_IPC.enterWorkspace) as Promise<void>,
  onView: (listener) => {
    const receive = (_event: Electron.IpcRendererEvent, view: TFlowLoginView): void => { listener(view) }
    ipcRenderer.on(TFLOW_IPC.state, receive)
    return () => { ipcRenderer.removeListener(TFLOW_IPC.state, receive) }
  },
}

contextBridge.exposeInMainWorld('dshTFlow', api)
