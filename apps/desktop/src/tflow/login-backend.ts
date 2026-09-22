/**
 * Main-process driver for the TFlow sign-in flow.
 *
 * One instance owns the credential record, the panel session, and the provider
 * route for the lifetime of the application. The welcome window drives it
 * through the operations here; every input arrives from a renderer and is
 * validated before it reaches the panel.
 *
 * @module
 */

import { fetchPublicSettings, type TFlowFetch } from './protocol.ts'
import type { TFlowCredentialStore, TFlowCredentials } from './credentials.ts'
import { createTFlowSession, type TFlowSessionEffects } from './session.ts'
import { loginView, type TFlowLoginBootstrap, type TFlowLoginSettings, type TFlowLoginView, type TFlowStartInput } from './login-api.ts'

/** Effects the shell supplies for the hosted provider route. */
export interface TFlowProviderRoute {
  /**
   * @param credentials - session to serve models with.
   * @param modelIds - models the gateway advertised for this key.
   */
  apply(credentials: TFlowCredentials, modelIds: readonly string[]): Promise<void>
  /** Remove the route and the credential the provider resolves. */
  revoke(): Promise<void>
}

/** Everything the driver needs beyond the panel address. */
export interface TFlowLoginBackendOptions {
  /** Panel origin serving the account API. */
  readonly panelUrl: string
  readonly credentials: TFlowCredentialStore
  readonly route: TFlowProviderRoute
  /** Transport override; omitted uses the runtime fetch. */
  readonly fetch?: TFlowFetch
  readonly timeoutMs?: number
  readonly idempotencyKey?: () => string
}

/** The operations the welcome window may call. */
export interface TFlowLoginBackend {
  /** @returns the current flow state without touching the panel. */
  state(): TFlowLoginView
  /** @returns the flow state plus the captcha facts the form needs. */
  bootstrap(): Promise<TFlowLoginBootstrap>
  /** @param input - account address, password, and captcha proof. @returns the settled state. */
  start(input: TFlowStartInput): Promise<TFlowLoginView>
  /** @param code - six-digit authenticator code. @returns the settled state. */
  complete(code: string): Promise<TFlowLoginView>
  /** @param groupId - group to provision the model key for. @returns the settled state. */
  selectGroup(groupId: string): Promise<TFlowLoginView>
  /** @returns the signed-out state. */
  signOut(): Promise<TFlowLoginView>
  /** Abandon an attempt without touching stored credentials. @returns the restored state. */
  cancel(): Promise<TFlowLoginView>
  /** @param listener - view recipient. @returns subscription disposer. */
  subscribe(listener: (view: TFlowLoginView) => void): () => void
}

/** Longest panel field this shell forwards; the panel's own limits are lower. */
const MAX_FIELD_LENGTH = 512

/**
 * Read one renderer-supplied text field, refusing anything the form could not
 * have produced. The renderer is untrusted input, so lengths and types are
 * checked here rather than assumed from the form.
 * @param value - value from the renderer.
 * @param field - field name for the failure message.
 * @param allowEmpty - whether an empty string is a legitimate value.
 * @returns the trimmed value.
 */
function textField(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== 'string') throw new Error(`TFlow 登录：${field} 必须是文本`)
  const trimmed = value.trim()
  if (!allowEmpty && trimmed === '') throw new Error(`TFlow 登录：请填写${field}`)
  if (trimmed.length > MAX_FIELD_LENGTH) throw new Error(`TFlow 登录：${field} 过长`)
  return trimmed
}

/** Read the captcha proof, which a deployment without a captcha legitimately leaves empty. */
function captchaProof(value: unknown): string {
  return textField(value, '验证码凭证', true)
}

/**
 * Build the sign-in driver over one panel and one credential record.
 * @param options - panel address, credential store, and provider route.
 * @returns the driver.
 */
export function createTFlowLoginBackend(options: TFlowLoginBackendOptions): TFlowLoginBackend {
  const listeners = new Set<(view: TFlowLoginView) => void>()
  let cachedSettings: TFlowLoginSettings | undefined

  const requestOptions = {
    panelUrl: options.panelUrl,
    ...options.fetch === undefined ? {} : { fetch: options.fetch },
    ...options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs },
  }

  const effects: TFlowSessionEffects = {
    save: credentials => options.credentials.save(credentials),
    clear: () => options.credentials.clear(),
    apply: (credentials, modelIds) => options.route.apply(credentials, modelIds),
    revoke: () => options.route.revoke(),
  }
  const session = createTFlowSession({
    ...requestOptions,
    effects,
    ...options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey },
  })
  session.subscribe(state => {
    const view = loginView(state)
    for (const listener of listeners) listener(view)
  })

  /**
   * Load the captcha facts once per process. A panel that cannot be reached
   * yet leaves them absent, and the form reports that instead of submitting a
   * request the panel would refuse.
   */
  const loadSettings = async (): Promise<TFlowLoginSettings | undefined> => {
    if (cachedSettings !== undefined) return cachedSettings
    try {
      const settings = await fetchPublicSettings(requestOptions)
      cachedSettings = {
        captchaEnabled: settings.captchaEnabled,
        captchaSceneId: settings.captchaSceneId,
        captchaPrefix: settings.captchaPrefix,
        captchaRegion: settings.captchaRegion,
      }
      return cachedSettings
    } catch {
      // The failure reaches the user through the first sign-in attempt, which
      // repeats the same request and reports the classified reason.
      return undefined
    }
  }

  /**
   * Adopt a credential record that survived a restart. A record the store
   * cannot trust is removed, so the next launch asks the user to sign in again
   * rather than reporting a failure with no way forward.
   */
  const adoptStored = async (): Promise<void> => {
    const stored = await options.credentials.load()
    if (stored.kind === 'absent') return
    if (stored.kind === 'unusable') {
      await session.signOut()
      return
    }
    await session.restore(stored.credentials)
  }

  return {
    state: () => loginView(session.state()),

    async bootstrap() {
      if (session.state().kind === 'signed-out') await adoptStored()
      const settings = await loadSettings()
      const view = loginView(session.state())
      return { state: view, ...settings === undefined ? {} : { settings } }
    },

    async start(input) {
      return loginView(await session.start({
        email: textField(input?.email, '邮箱'),
        password: textField(input?.password, '密码'),
        captchaProof: captchaProof(input?.captchaProof),
      }))
    },

    async complete(code) {
      return loginView(await session.complete(textField(code, '验证码')))
    },

    async selectGroup(groupId) {
      return loginView(await session.selectGroup(textField(groupId, '分组')))
    },

    async signOut() {
      return loginView(await session.signOut())
    },

    async cancel() {
      // Cancelling an attempt leaves stored credentials alone: the user may
      // have backed out of a second sign-in while a usable record exists.
      return loginView(await session.abandon())
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}
