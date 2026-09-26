/** TFlow panel and gateway contract as the tflow.online deployment serves it. */

/** Public captcha and gateway settings the panel advertises before sign-in. */
export interface TFlowPublicSettings {
  /** Whether the panel requires an Aliyun captcha proof on the login request. */
  readonly captchaEnabled: boolean
  readonly captchaSceneId: string
  readonly captchaPrefix: string
  readonly captchaRegion: string
  /** Panel origin serving the `/api/v1` account API. */
  readonly panelUrl: string
  /** OpenAI-compatible gateway origin serving `/v1`. */
  readonly gatewayUrl: string
}

/** Panel token pair. The panel rotates the refresh token, so both fields are replaced together. */
export interface TFlowSession {
  readonly accessToken: string
  /** Absent when the deployment issues access tokens without a refresh grant. */
  readonly refreshToken?: string
}

/** Which second factor the panel asked for after the password step. */
export interface TFlowTotpChallenge {
  readonly tempToken: string
  /** Panel-masked address shown while the user enters the code. */
  readonly maskedEmail?: string
}

/** One selectable model group, as the panel's `/groups/available` reports it. */
export interface TFlowGroup {
  readonly id: string
  readonly name: string
}

/** Account facts the panel reports for the signed-in user. */
export interface TFlowAccount {
  readonly displayName: string
  /** Panel balance in USD; the panel already reports dollars and no conversion applies. */
  readonly balance: number
}

/** Service-provided remaining allowance for one subscription window. */
export interface TFlowRemaining {
  readonly daily?: number
  readonly weekly?: number
  readonly monthly?: number
}

/**
 * What the account currently draws on: a metered balance, or a subscription
 * with its own remaining windows. The two are independent server facts and the
 * client never derives one from the other.
 */
export type TFlowEntitlement =
  | { readonly kind: 'balance'; readonly account: TFlowAccount }
  | { readonly kind: 'subscription'; readonly account: TFlowAccount; readonly groupName: string; readonly remaining: TFlowRemaining }

/** Request, token, and charged totals for one usage period. */
export interface TFlowUsagePeriod {
  readonly requests: number
  readonly tokens: number
  /** Amount the panel deducted, in USD as the panel reports it. */
  readonly cost: number
}

/** Usage the panel reports for the signed-in user. */
export interface TFlowUsage {
  readonly today: TFlowUsagePeriod
  readonly total: TFlowUsagePeriod
}

/** A TFlow model key together with the group it is bound to. */
export interface TFlowModelKey {
  readonly key: string
  readonly groupId?: string
}

/** One model the gateway advertises. */
export interface TFlowModel {
  readonly id: string
}
