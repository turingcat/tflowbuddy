/**
 * Credential-free view of the TFlow sign-in flow, as the welcome renderer needs
 * it. The renderer never receives a token, a model key, or a raw panel
 * response: every field here is either copy the shell already owns or a value
 * safe to display.
 *
 * @module
 */

import type { TFlowAuthState } from './session.ts'
import type { TFlowGroup } from './types.ts'

/** Private welcome channels owning the TFlow flow. */
export const TFLOW_IPC = {
  state: 'dsh-tflow:state',
  bootstrap: 'dsh-tflow:bootstrap',
  start: 'dsh-tflow:start',
  complete: 'dsh-tflow:complete',
  selectGroup: 'dsh-tflow:select-group',
  signOut: 'dsh-tflow:sign-out',
  cancel: 'dsh-tflow:cancel',
  enterWorkspace: 'dsh-tflow:enter-workspace',
} as const

/** One selectable group, as the group step renders it. */
export interface TFlowGroupView {
  readonly id: string
  readonly name: string
}

/**
 * The flow state the renderer renders. `failure` carries whether a retry can
 * help, so the form offers the right action instead of a dead end.
 */
export type TFlowLoginView =
  | { readonly kind: 'signed-out' }
  | { readonly kind: 'starting' }
  | { readonly kind: 'totp'; readonly maskedEmail?: string }
  | { readonly kind: 'group'; readonly groups: readonly TFlowGroupView[] }
  | { readonly kind: 'authenticated' }
  | { readonly kind: 'failure'; readonly message: string; readonly retryable: boolean }

/** The captcha facts the login form needs before it can submit. */
export interface TFlowLoginSettings {
  readonly captchaEnabled: boolean
  readonly captchaSceneId: string
  readonly captchaPrefix: string
  readonly captchaRegion: string
}

/** Password-step fields the form submits. */
export interface TFlowStartInput {
  readonly email: string
  readonly password: string
  readonly captchaProof: string
}

/** What the welcome window reads at first paint. */
export interface TFlowLoginBootstrap {
  readonly state: TFlowLoginView
  /** Absent while the panel settings could not be read; the form then blocks submission. */
  readonly settings?: TFlowLoginSettings
}

/**
 * Project one orchestrator state onto the renderer view.
 * @param state - orchestrator state.
 * @returns the credential-free view.
 */
export function loginView(state: TFlowAuthState): TFlowLoginView {
  switch (state.kind) {
    case 'signed-out': return { kind: 'signed-out' }
    case 'totp-required': return { kind: 'totp', ...state.maskedEmail === undefined ? {} : { maskedEmail: state.maskedEmail } }
    case 'group-required': return { kind: 'group', groups: state.groups.map(groupView) }
    case 'authenticated': return { kind: 'authenticated' }
    case 'failed': return { kind: 'failure', message: state.message, retryable: state.retryable }
  }
}

/** @param group - panel group. @returns the renderer projection. */
function groupView(group: TFlowGroup): TFlowGroupView {
  return { id: group.id, name: group.name }
}
