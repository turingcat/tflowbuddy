/**
 * TFlow sign-in orchestration.
 *
 * The flow is a small state machine over the panel client: read the public
 * settings, submit the password step, answer a second factor when the panel
 * asks for one, provision a model key for a group the account may use, and
 * confirm the gateway actually serves models before the session is reported as
 * usable. The orchestrator owns the session state and nothing else — the hosted
 * provider route, the credential document, and the account menus are injected
 * effects, so this module is exercised without Electron or a live panel.
 *
 * @module
 */

import {
  completeTwoFactor,
  ensureModelKey,
  fetchPublicSettings,
  listGroups,
  listModels,
  refreshSession,
  signIn,
  TFlowProtocolError,
  type TFlowRequestOptions,
} from './protocol.ts'
import type { TFlowCredentials } from './credentials.ts'
import type { TFlowGroup, TFlowPublicSettings, TFlowSession } from './types.ts'

/** What the sign-in surface must render right now. */
export type TFlowAuthState =
  | { readonly kind: 'signed-out' }
  | { readonly kind: 'totp-required'; readonly maskedEmail?: string }
  | { readonly kind: 'group-required'; readonly groups: readonly TFlowGroup[] }
  | { readonly kind: 'authenticated'; readonly credentials: TFlowCredentials }
  /** The attempt failed; the fields carry operator-facing copy plus whether a retry can help. */
  | { readonly kind: 'failed'; readonly message: string; readonly retryable: boolean; readonly reason?: string }

/** Effects the orchestrator performs outside its own state. */
export interface TFlowSessionEffects {
  /** Persist the credentials the session is now using. */
  save(credentials: TFlowCredentials): Promise<void>
  /** Remove persisted credentials. */
  clear(): Promise<void>
  /**
   * Make the credentials available to the hosted model provider.
   * @param credentials - session the provider serves requests with.
   * @param modelIds - models the gateway advertised for this key, in advertised order.
   */
  apply(credentials: TFlowCredentials, modelIds: readonly string[]): Promise<void>
  /** Stop serving the hosted model provider. */
  revoke(): Promise<void>
}

/** Everything the orchestrator needs to run one attempt. */
export interface TFlowSessionOptions {
  /** Panel origin; the gateway address arrives with the public settings. */
  readonly panelUrl: string
  /** Transport override for panel and gateway requests. */
  readonly fetch?: TFlowRequestOptions['fetch']
  readonly timeoutMs?: number
  readonly effects: TFlowSessionEffects
  /** Supplies the create request's idempotency key. */
  readonly idempotencyKey?: () => string
}

/** The sign-in surface's whole API. */
export interface TFlowSignIn {
  /** @returns the current state. */
  state(): TFlowAuthState
  /** @param listener - state recipient. @returns subscription disposer. */
  subscribe(listener: (state: TFlowAuthState) => void): () => void
  /**
   * Start an attempt with the collected password-step fields.
   * @param input - account address, password, and captcha proof.
   * @returns the state the attempt settled into.
   */
  start(input: { email: string, password: string, captchaProof: string }): Promise<TFlowAuthState>
  /**
   * Answer the panel's second factor.
   * @param code - six-digit authenticator code.
   * @returns the state the attempt settled into.
   */
  complete(code: string): Promise<TFlowAuthState>
  /**
   * Continue with one of the offered groups, provisioning its model key.
   * @param groupId - group the model key must serve.
   * @returns the state the attempt settled into.
   */
  selectGroup(groupId: string): Promise<TFlowAuthState>
  /**
   * Re-establish a session from a stored credential record.
   * @param credentials - record read from the credential store.
   * @returns the state after the attempt; a refused grant signs the session out.
   */
  restore(credentials: TFlowCredentials): Promise<TFlowAuthState>
  /**
   * Refresh the panel session and re-apply it to the provider.
   * @returns the state after the refresh.
   */
  refresh(): Promise<TFlowAuthState>
  /**
   * Abandon an outstanding attempt without touching stored credentials, so a
   * user who backs out of a second sign-in keeps the session they already had.
   * @returns the restored state.
   */
  abandon(): Promise<TFlowAuthState>
  /**
   * Sign out and stop serving the provider.
   * @returns the signed-out state.
   */
  signOut(): Promise<TFlowAuthState>
}

/** An attempt's mid-flow facts, held only while a step is outstanding. */
interface Pending {
  settings: TFlowPublicSettings
  session: TFlowSession
  challenge?: { tempToken: string, maskedEmail?: string }
}

/** Turn any thrown value into the state the surface renders. */
function failureState(error: unknown): Extract<TFlowAuthState, { kind: 'failed' }> {
  if (error instanceof TFlowProtocolError) {
    // A refused credential and a throttled panel both stay retryable: the user
    // may correct the entry, and the limit expires on its own.
    return {
      kind: 'failed',
      message: error.message,
      retryable: error.kind !== 'forbidden',
      ...error.reason === undefined ? {} : { reason: error.reason },
    }
  }
  return { kind: 'failed', message: error instanceof Error ? error.message : 'TFlow 登录失败', retryable: true }
}

/**
 * Build the sign-in session over one panel connection.
 * @param options - panel address, transport, and injected effects.
 * @returns the session.
 */
export function createTFlowSession(options: TFlowSessionOptions): TFlowSignIn {
  const request: TFlowRequestOptions = {
    panelUrl: options.panelUrl,
    ...options.fetch === undefined ? {} : { fetch: options.fetch },
    ...options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs },
  }
  const newIdempotencyKey = options.idempotencyKey ?? (() => globalThis.crypto.randomUUID())
  const listeners = new Set<(state: TFlowAuthState) => void>()
  let current: TFlowAuthState = { kind: 'signed-out' }
  let pending: Pending | undefined
  /**
   * The session an attempt replaced. An attempt overwrites {@link current} at
   * its first step, so abandoning one without this would strand a user who
   * backed out of a second sign-in with no session at all.
   */
  let incumbent: TFlowAuthState = { kind: 'signed-out' }
  /**
   * Models the gateway advertised for the current key. A refresh replaces only
   * the session, so it republishes this catalog rather than an empty one that
   * would leave the route serving nothing.
   */
  let advertised: readonly string[] = []

  const publish = (state: TFlowAuthState): TFlowAuthState => {
    current = state
    for (const listener of listeners) listener(state)
    return state
  }

  /**
   * Confirm the gateway serves models for the provisioned key, then persist and
   * apply the credentials. A key that cannot list models never becomes an
   * authenticated session, because the alternative is a workspace that looks
   * ready and cannot answer.
   */
  const provision = async (base: Omit<TFlowCredentials, 'modelKey'>, groupId: string): Promise<TFlowAuthState> => {
    const modelKey = await ensureModelKey(request, base.session.accessToken, groupId, newIdempotencyKey())
    const models = await listModels({ ...request, gatewayUrl: base.gatewayUrl }, modelKey.key)
    if (models.length === 0) throw new TFlowProtocolError('protocol', 'TFlow 网关未返回可用模型')
    const credentials: TFlowCredentials = { ...base, modelKey: modelKey.key }
    await options.effects.save(credentials)
    // The advertised catalog travels with the key: the route declares the
    // models the gateway serves, so a gateway that renames or retires one is
    // republished at the next sign-in rather than drifting.
    advertised = models.map(model => model.id)
    await options.effects.apply(credentials, advertised)
    pending = undefined
    incumbent = { kind: 'signed-out' }
    return publish({ kind: 'authenticated', credentials })
  }

  /**
   * Offer every group the panel allows, including a lone one, so the user
   * confirms the target a key is minted for. Zero groups is an account-level
   * failure, not an empty menu.
   */
  const offerGroups = async (settings: TFlowPublicSettings, session: TFlowSession): Promise<TFlowAuthState> => {
    const groups = await listGroups(request, session.accessToken)
    if (groups.length === 0) throw new TFlowProtocolError('service', '当前账号没有可用的模型分组')
    pending = { settings, session }
    return publish({ kind: 'group-required', groups })
  }

  return {
    state: () => current,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },

    async start(input) {
      try {
        const settings = await fetchPublicSettings(request)
        incumbent = current.kind === 'authenticated' ? current : { kind: 'signed-out' }
        const step = await signIn(request, input)
        if (step.kind === 'totp-required') {
          // No access token exists until the code exchange; the challenge is
          // the only panel state this step holds.
          pending = { settings, session: { accessToken: '' }, challenge: step.challenge }
          return publish({
            kind: 'totp-required',
            ...step.challenge.maskedEmail === undefined ? {} : { maskedEmail: step.challenge.maskedEmail },
          })
        }
        return await offerGroups(settings, step.session)
      } catch (error) {
        return publish(failureState(error))
      }
    },

    async complete(code) {
      const held = pending
      if (held?.challenge === undefined) {
        return publish({ kind: 'failed', message: '登录状态已失效，请重新登录', retryable: true })
      }
      try {
        const session = await completeTwoFactor(request, held.challenge, code)
        return await offerGroups(held.settings, session)
      } catch (error) {
        return publish(failureState(error))
      }
    },

    async selectGroup(groupId) {
      const held = pending
      if (held === undefined || held.session.accessToken === '') {
        return publish({ kind: 'failed', message: '登录状态已失效，请重新登录', retryable: true })
      }
      try {
        return await provision({
          session: held.session,
          panelUrl: held.settings.panelUrl,
          gatewayUrl: held.settings.gatewayUrl,
        }, groupId)
      } catch (error) {
        return publish(failureState(error))
      }
    },

    async restore(credentials: TFlowCredentials) {
      // An access token this process never validated is not usable: every panel
      // call would fail before the provider could serve anything. The record is
      // re-established by exchanging its refresh grant, and a record without one
      // cannot be recovered at all.
      if (credentials.session.refreshToken === undefined) {
        await options.effects.clear()
        await options.effects.revoke()
        return publish({ kind: 'signed-out' })
      }
      publish({ kind: 'authenticated', credentials })
      return this.refresh()
    },

    async refresh() {
      const state = current
      if (state.kind !== 'authenticated') return state
      const refreshToken = state.credentials.session.refreshToken
      if (refreshToken === undefined) return state
      try {
        const rotated = await refreshSession(request, refreshToken)
        // The panel treats the returned refresh token as optional. When it
        // rotates only the access token, the grant that just worked stays in
        // force; dropping it would sign the user out at the next refresh.
        const session = rotated.refreshToken === undefined
          ? { accessToken: rotated.accessToken, refreshToken }
          : rotated
        const credentials: TFlowCredentials = { ...state.credentials, session }
        // Persist before applying: a provider serving a token the store has not
        // committed would survive a restart as a session that cannot refresh.
        await options.effects.save(credentials)
        await options.effects.apply(credentials, advertised)
        return publish({ kind: 'authenticated', credentials })
      } catch (error) {
        const failure = failureState(error)
        // A refused grant is not recoverable, and leaving a dead session in
        // place would keep failing every later request.
        if (error instanceof TFlowProtocolError && (error.kind === 'unauthorized' || error.kind === 'forbidden')) {
          pending = undefined
          advertised = []
          await options.effects.clear()
          await options.effects.revoke()
          return publish(failure)
        }
        return publish(failure)
      }
    },

    async abandon() {
      pending = undefined
      // A signed-in session is what the user returns to; without one the
      // attempt leaves nothing behind, and no stored record is touched either way.
      return publish(incumbent)
    },

    async signOut() {
      pending = undefined
      incumbent = { kind: 'signed-out' }
      advertised = []
      await options.effects.clear()
      await options.effects.revoke()
      return publish({ kind: 'signed-out' })
    },
  }
}
