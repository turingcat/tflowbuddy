/**
 * Native IPC ownership for the TFlow sign-in flow.
 *
 * The welcome window is the only renderer that reaches these channels, and only
 * while it exists. Every handler is removed when its window closes, so a stale
 * document cannot drive the flow after its window is gone.
 *
 * @module
 */

import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { TFLOW_IPC, type TFlowAccountView, type TFlowLoginBootstrap, type TFlowLoginView, type TFlowStartInput } from './login-api.ts'
import type { TFlowLoginBackend } from './login-backend.ts'

/** Channels this bridge registers and therefore removes. */
const REQUEST_CHANNELS = [
  TFLOW_IPC.bootstrap, TFLOW_IPC.start, TFLOW_IPC.complete,
  TFLOW_IPC.selectGroup, TFLOW_IPC.signOut, TFLOW_IPC.cancel, TFLOW_IPC.enterWorkspace, TFLOW_IPC.account,
] as const

/**
 * Install the TFlow channels for one welcome window.
 * @param window - window allowed to drive the flow.
 * @param backend - driver owning the session.
 * @returns disposer that removes every channel this call registered.
 */
export function installTFlowLoginIpc(
  window: BrowserWindow,
  backend: TFlowLoginBackend,
  enterWorkspace: () => Promise<void>,
): () => void {
  let active = true
  const assertSender = (event: IpcMainInvokeEvent): void => {
    if (!active || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('desktop TFlow: rejected action from an unowned frame')
    }
  }
  const request = <T>(channel: string, run: (args: readonly unknown[]) => Promise<T>): void => {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      assertSender(event)
      return await run(args)
    })
  }
  request<TFlowLoginBootstrap>(TFLOW_IPC.bootstrap, () => backend.bootstrap())
  // The renderer supplies one payload object; the driver validates each field,
  // because a renderer is untrusted input even when the form produced it.
  request<TFlowLoginView>(TFLOW_IPC.start, ([input]) => backend.start((input ?? {}) as TFlowStartInput))
  request<TFlowLoginView>(TFLOW_IPC.complete, ([code]) => backend.complete(typeof code === 'string' ? code : ''))
  request<TFlowLoginView>(TFLOW_IPC.selectGroup, ([groupId]) => backend.selectGroup(typeof groupId === 'string' ? groupId : ''))
  request<TFlowLoginView>(TFLOW_IPC.signOut, () => backend.signOut())
  request<TFlowLoginView>(TFLOW_IPC.cancel, () => backend.cancel())
  request<void>(TFLOW_IPC.enterWorkspace, () => enterWorkspace())
  request<TFlowAccountView | undefined>(TFLOW_IPC.account, () => backend.account())

  const unsubscribe = backend.subscribe((view) => {
    if (!active || window.isDestroyed()) return
    window.webContents.send(TFLOW_IPC.state, view)
  })
  return () => {
    active = false
    unsubscribe()
    for (const channel of REQUEST_CHANNELS) ipcMain.removeHandler(channel)
  }
}
