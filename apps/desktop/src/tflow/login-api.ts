/**
 * Credential-free view of the TFlow sign-in flow, as the welcome renderer needs
 * it. The renderer never receives a token, a model key, or a raw panel
 * response: every field here is either copy the shell already owns or a value
 * safe to display.
 *
 * @module
 */

import type { TFlowAuthState } from './session.ts'
import type { TFlowEntitlement, TFlowGroup } from './types.ts'

/** Alibaba Cloud captcha SDK globals in the isolated welcome renderer. */
declare global {
  interface Window {
    initAliyunCaptcha?: (options: { SceneId: string; prefix: string; mode: 'popup'; element: string; button: string; captchaVerifyCallback: (proof: string) => { captchaResult: boolean }; onBizResultCallback: () => void; getInstance: () => void; slideStyle: { width: number; height: number } }) => void
    AliyunCaptchaConfig?: { region: 'cn' | 'sgp'; prefix: string }
  }
}

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
  account: 'dsh-tflow:account',
} as const

/** One selectable group, as the group step renders it. */
export interface TFlowGroupView {
  readonly id: string
  readonly name: string
}

/** Remaining allowance the panel reported for one subscription window. */
export interface TFlowRemainingView {
  readonly daily?: number
  readonly weekly?: number
  readonly monthly?: number
}

/**
 * What the signed-in account draws on, as an account surface renders it.
 *
 * Balance and subscription are independent server facts and both may exist; the
 * client reports whichever the panel served for the selected group and never
 * derives one from the other.
 */
export interface TFlowAccountView {
  /** Address prefix the panel derives the display name from. */
  readonly displayName: string
  /** Panel balance in USD, as the panel reports it. */
  readonly balance: number
  /** Present when a subscription covers the selected group. */
  readonly subscription?: { readonly groupName: string; readonly remaining: TFlowRemainingView }
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
 * Project one panel entitlement onto the account view.
 * @param entitlement - what the panel reported.
 * @returns the credential-free account view.
 */
export function accountView(entitlement: TFlowEntitlement): TFlowAccountView {
  return entitlement.kind === 'subscription'
    ? {
      displayName: entitlement.account.displayName,
      balance: entitlement.account.balance,
      subscription: { groupName: entitlement.groupName, remaining: entitlement.remaining },
    }
    : { displayName: entitlement.account.displayName, balance: entitlement.account.balance }
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
