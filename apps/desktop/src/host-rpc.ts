/**
 * Authenticated Host RPC for shell-owned operations.
 *
 * The Electron main process reaches the running Host over the same authenticated
 * HTTP API the product documents use. Reads and writes here are limited to what
 * the shell needs before or beside a workspace: the shared language preference
 * and the model-provider route a signed-in account serves.
 *
 * @module
 */

import { randomUUID } from 'node:crypto'

/** One unary Host method call. */
export interface HostInvoke {
  (request: { namespace: string, method: string, args: Record<string, unknown> }): Promise<unknown>
}

/** A JSON object, as every Host reply this module reads must be. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Connect an authenticated unary RPC caller to a running Host.
 *
 * The workspace document itself is fetched with the same credentials, so a Host
 * that does not answer its own entry point is reported before any call is made.
 * @param authenticatedUrl - URL supplied by the running Desktop Host.
 * @param send - Electron session fetch, which retains the Web authentication cookie.
 * @returns the unary caller.
 */
export async function connectHostRpc(
  authenticatedUrl: string,
  send: (input: string, init?: RequestInit) => Promise<Response>,
): Promise<HostInvoke> {
  const origin = new URL(authenticatedUrl).origin
  const authenticated = await send(authenticatedUrl, { credentials: 'include' })
  await authenticated.body?.cancel()
  if (!authenticated.ok) throw new Error('desktop host: Web authentication failed')
  return async (request) => {
    const rpcId = randomUUID()
    const method = `${request.namespace}/${request.method}`
    const response = await send(new URL(`/api/${method}`, origin).href, {
      method: 'POST', credentials: 'include', redirect: 'error',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args: request.args } }),
    })
    if (!response.ok) throw new Error('desktop host: Web request failed')
    const envelope: unknown = await response.json()
    if (!isRecord(envelope) || envelope['type'] !== 'server-response' || envelope['rpcId'] !== rpcId
      || !isRecord(envelope['result']) || envelope['result']['ok'] !== true) {
      throw new Error('desktop host: Web RPC failed')
    }
    return envelope['result']['value']
  }
}

/** Settings namespace holding the shared language preference. */
const LOCALE_NAMESPACE = 'locale'

/**
 * Read the shared interface-language preference.
 * @param invoke - Host RPC caller.
 * @returns the stored preference, or `null` when the user has not chosen one.
 */
export async function readLocalePreference(invoke: HostInvoke): Promise<string | null> {
  const settings = await invoke({ namespace: 'settings', method: 'describe', args: {} })
  if (!isRecord(settings) || !Array.isArray(settings['namespaces'])) throw new Error('desktop host: missing settings namespaces')
  const locale: unknown = settings['namespaces'].find(item => isRecord(item) && item['ns'] === LOCALE_NAMESPACE)
  if (!isRecord(locale) || !isRecord(locale['value'])) throw new Error('desktop host: invalid locale preference')
  const preference = locale['value']['preference']
  if (preference === undefined || preference === null) return null
  if (typeof preference !== 'string') throw new Error('desktop host: invalid locale preference')
  return preference
}

/** Settings namespace owning the multi-provider adapter's routes. */
const PROVIDER_NAMESPACE = 'llm-pi-ai'
/**
 * Route name the desktop product owns. The adapter keys routes by this name, and
 * a request selects it with `GenerateOptions.provider`.
 */
export const TFLOW_PROVIDER = 'tflow'
/** Credential reference holding the model key the route resolves per request. */
const MODEL_KEY_REF = 'TFLOW_MODEL_KEY'

/**
 * One model entry for the route.
 * @param id - model identifier the gateway serves.
 * @returns the route's model entry, carrying only the identifier.
 */
function modelEntry(id: string): Record<string, unknown> {
  return { id }
}

/**
 * Publish the TFlow provider route and the model key it resolves.
 *
 * The route is declared inline rather than left to the installed catalog: the
 * gateway is not a catalog provider, so its protocol, endpoint, and model list
 * must all be stated here. The key travels through the credential seam, so no
 * secret enters the settings document.
 * @param invoke - Host RPC caller.
 * @param credentials - signed-in session.
 * @param modelIds - models the gateway advertised, in advertised order.
 */
export async function applyTFlowRoute(
  invoke: HostInvoke,
  credentials: { readonly gatewayUrl: string, readonly modelKey: string, readonly panelUrl: string },
  modelIds: readonly string[],
): Promise<void> {
  await invoke({
    namespace: PROVIDER_NAMESPACE,
    method: 'update',
    args: {
      patch: {
        providers: {
          [TFLOW_PROVIDER]: {
            displayName: 'TFlow',
            api: 'openai-completions',
            baseURL: credentials.gatewayUrl,
            apiKeyEnv: MODEL_KEY_REF,
            models: modelIds.map(modelEntry),
          },
        },
      },
      expectedRevision: undefined,
    },
  })
  await invoke({ namespace: 'credentials', method: 'set', args: { ref: MODEL_KEY_REF, value: credentials.modelKey } })
}

/**
 * Remove the provider route and the key it resolved.
 * @param invoke - Host RPC caller.
 */
export async function revokeTFlowRoute(invoke: HostInvoke): Promise<void> {
  // The key is removed first: a route without a key fails requests, while a
  // stored key with no route is an unused secret the user cannot see.
  await invoke({ namespace: 'credentials', method: 'unset', args: { ref: MODEL_KEY_REF } })
  await invoke({
    namespace: PROVIDER_NAMESPACE,
    method: 'mutate',
    args: { ops: [{ op: 'unset', path: ['providers', TFLOW_PROVIDER] }], expectedRevision: undefined },
  })
}
