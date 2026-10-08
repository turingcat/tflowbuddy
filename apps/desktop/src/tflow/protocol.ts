/**
 * TFlow panel and gateway client.
 *
 * Every response crosses a wire boundary, so each field this module reads is
 * validated before use and a malformed payload raises {@link TFlowProtocolError}
 * rather than reaching a caller as `undefined`. The panel answers with the
 * sub2api envelope `{ code, message?, reason?, data? }`, where `code === 0` is
 * success and a non-zero code carries the operator-facing message.
 *
 * @module
 */

import type {
  TFlowAccount,
  TFlowEntitlement,
  TFlowGroup,
  TFlowModel,
  TFlowModelKey,
  TFlowPublicSettings,
  TFlowRemaining,
  TFlowSession,
  TFlowTotpChallenge,
  TFlowUsage,
  TFlowUsagePeriod,
} from './types.ts'

/** How one panel or gateway request failed. */
export type TFlowErrorKind =
  /** The panel rejected the credential; the caller decides whether to refresh or re-authenticate. */
  | 'unauthorized'
  /** The credential is valid but the account may not perform the operation. */
  | 'forbidden'
  /** The panel rate-limited the request. */
  | 'rate-limited'
  /** The request did not complete in time. */
  | 'timeout'
  /** The service could not be reached at all. */
  | 'network'
  /** A response arrived but did not match the documented contract. */
  | 'protocol'
  /** The service refused the request for an application reason it explained. */
  | 'service'

/** One failed panel or gateway request, classified for the recovery the UI offers. */
export class TFlowProtocolError extends Error {
  readonly kind: TFlowErrorKind
  /** HTTP status when a response arrived; absent for transport failures. */
  readonly status?: number
  /** Operator-facing message the panel supplied, when it supplied one. */
  readonly reason?: string

  constructor(kind: TFlowErrorKind, message: string, options: { status?: number; reason?: string } = {}) {
    super(message)
    this.name = 'TFlowProtocolError'
    this.kind = kind
    if (options.status !== undefined) this.status = options.status
    if (options.reason !== undefined) this.reason = options.reason
  }
}

/** Injected transport; the default is the runtime's global fetch. */
export type TFlowFetch = (input: string, init?: RequestInit) => Promise<Response>

/** Deployment choices for one panel connection. */
export interface TFlowRequestOptions {
  /** Panel origin, for example `https://tflow.online`. */
  readonly panelUrl: string
  /** Transport override; omitted uses global fetch. */
  readonly fetch?: TFlowFetch
  /** Per-request deadline; omitted uses {@link TFLOW_REQUEST_TIMEOUT_MS}. */
  readonly timeoutMs?: number
}

/** Deadline for one panel or gateway request. */
export const TFLOW_REQUEST_TIMEOUT_MS = 15_000

/** Name a TFlow model key is provisioned under; the panel scopes lookup by exact name. */
export const TFLOW_MODEL_KEY_NAME = 'TFlowBuddy'

/** Credential reference holding the provisioned model key for the Host provider route. */
export const TFLOW_MODEL_KEY_REF = 'TFLOW_MODEL_KEY'

const CONTENT_TYPE_JSON = { 'Content-Type': 'application/json' }

/** One decoded success envelope. */
interface Envelope {
  readonly code: number
  readonly message?: string
  readonly reason?: string
  readonly data?: unknown
}

/** A JSON object, as every contract in this module requires. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Strip trailing slashes so path joins stay single-slashed. */
function trimOrigin(value: string): string {
  return value.replace(/\/+$/u, '')
}

/**
 * Normalize a configured gateway address to its `/v1` root. The panel may
 * advertise either the bare origin or an address that already carries the
 * version segment, and the gateway serves only one of the two spellings.
 * @param value - gateway address as advertised or configured.
 * @returns the gateway root ending in `/v1`.
 */
export function gatewayRoot(value: string): string {
  return `${trimOrigin(value).replace(/\/v1$/u, '')}/v1`
}

/** Map one HTTP status to the recovery it implies. */
function errorKindFor(status: number): TFlowErrorKind {
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 429) return 'rate-limited'
  // A 2xx that still failed failed on its payload, not on the service.
  if (status >= 200 && status < 300) return 'protocol'
  return 'service'
}

/**
 * Classify a refused envelope. The deployment reports authentication,
 * authorization, and throttling refusals both as an HTTP status and as an
 * envelope code, and a body carrying only the code is still a refusal the UI
 * must recover from correctly.
 * @param status - HTTP status the response carried.
 * @param code - envelope code.
 * @returns the recovery the refusal implies.
 */
function refusalKind(status: number, code: number): TFlowErrorKind {
  const fromStatus = errorKindFor(status)
  if (fromStatus !== 'protocol') return fromStatus
  return code === 401 || code === 403 || code === 429 ? errorKindFor(code) : 'service'
}

/** Read the response body as JSON, or `undefined` when it is not JSON at all. */
async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

/** Decode one envelope, turning every failure into a classified error. */
async function requestEnvelope(url: string, init: RequestInit, options: TFlowRequestOptions): Promise<unknown> {
  const send = options.fetch ?? globalThis.fetch
  let response: Response
  try {
    response = await send(url, { ...init, signal: AbortSignal.timeout(options.timeoutMs ?? TFLOW_REQUEST_TIMEOUT_MS) })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new TFlowProtocolError('timeout', '请求超时，请稍后重试')
    }
    throw new TFlowProtocolError('network', '无法连接 TFlow 服务，请检查网络')
  }

  const body = await readJson(response)
  if (body === undefined || !isRecord(body) || typeof body['code'] !== 'number') {
    throw new TFlowProtocolError(errorKindFor(response.status),
      response.ok ? 'TFlow 服务响应格式异常' : `TFlow 服务不可用（HTTP ${response.status}）`,
      { status: response.status })
  }
  const envelope = body as unknown as Envelope
  if (envelope.code !== 0) {
    throw new TFlowProtocolError(refusalKind(response.status, envelope.code), envelope.message ?? 'TFlow 请求失败', {
      status: response.status,
      ...envelope.reason === undefined ? {} : { reason: envelope.reason },
    })
  }
  if (!response.ok) {
    throw new TFlowProtocolError(errorKindFor(response.status), `TFlow 服务不可用（HTTP ${response.status}）`, { status: response.status })
  }
  return envelope.data
}

/** Read one gateway response, which uses raw HTTP status rather than the panel envelope. */
async function requestGateway(url: string, init: RequestInit, options: TFlowRequestOptions): Promise<unknown> {
  const send = options.fetch ?? globalThis.fetch
  let response: Response
  try {
    response = await send(url, { ...init, signal: AbortSignal.timeout(options.timeoutMs ?? TFLOW_REQUEST_TIMEOUT_MS) })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new TFlowProtocolError('timeout', '请求超时，请稍后重试')
    }
    throw new TFlowProtocolError('network', '无法连接 TFlow 模型服务，请检查网络')
  }
  // A success that is not JSON is a contract violation, not a service outage;
  // only a failed status is classified as one.
  const body = await readJson(response)
  if (!response.ok) {
    throw new TFlowProtocolError(errorKindFor(response.status), `TFlow 模型服务不可用（HTTP ${response.status}）`, { status: response.status })
  }
  if (body === undefined) throw new TFlowProtocolError('protocol', 'TFlow 模型服务响应格式异常', { status: response.status })
  return body
}

/** Require one string field, naming the contract in the failure. */
function requiredString(source: Record<string, unknown>, field: string, contract: string): string {
  const value = source[field]
  if (typeof value !== 'string' || value === '') {
    throw new TFlowProtocolError('protocol', `${contract}响应缺少 ${field}`)
  }
  return value
}

/** Read an optional string field, treating an empty string as absent. */
function optionalString(source: Record<string, unknown>, field: string): string | undefined {
  const value = source[field]
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Require one finite number field. */
function requiredNumber(source: Record<string, unknown>, field: string, contract: string): number {
  const value = source[field]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TFlowProtocolError('protocol', `${contract}响应缺少 ${field}`)
  }
  return value
}

/** Coerce a panel group identifier, which the deployment may spell as a number or a string. */
function groupIdOf(value: unknown): string | undefined {
  if (typeof value === 'string' && value !== '') return value
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value)
  return undefined
}

/** Decode the public captcha and gateway settings the login form needs. */
function decodePublicSettings(data: unknown): TFlowPublicSettings {
  if (!isRecord(data)) throw new TFlowProtocolError('protocol', 'TFlow 公开设置响应格式异常')
  const captchaEnabled = data['aliyun_captcha_enabled']
  if (typeof captchaEnabled !== 'boolean') {
    throw new TFlowProtocolError('protocol', 'TFlow 公开设置响应缺少 aliyun_captcha_enabled')
  }
  return {
    captchaEnabled,
    captchaSceneId: typeof data['aliyun_captcha_scene_id'] === 'string' ? data['aliyun_captcha_scene_id'] : '',
    captchaPrefix: typeof data['aliyun_captcha_prefix'] === 'string' ? data['aliyun_captcha_prefix'] : '',
    captchaRegion: typeof data['aliyun_captcha_region'] === 'string' ? data['aliyun_captcha_region'] : '',
    panelUrl: trimOrigin(requiredString(data, 'api_base_url', 'TFlow 公开设置')),
    gatewayUrl: gatewayRoot(requiredString(data, 'api_base_url', 'TFlow 公开设置')),
  }
}

/** Decode one token pair, which the panel returns on login, 2FA, and refresh alike. */
function decodeSession(data: unknown): TFlowSession {
  if (!isRecord(data)) throw new TFlowProtocolError('protocol', 'TFlow 登录响应格式异常')
  return {
    accessToken: requiredString(data, 'access_token', 'TFlow 登录'),
    ...(() => {
      const refresh = optionalString(data, 'refresh_token')
      return refresh === undefined ? {} : { refreshToken: refresh }
    })(),
  }
}

/**
 * Read the panel settings that gate the login form.
 * @param options - panel address and transport.
 * @returns the captcha and gateway settings.
 * @throws TFlowProtocolError when the panel is unreachable or answers off-contract.
 */
export async function fetchPublicSettings(options: TFlowRequestOptions): Promise<TFlowPublicSettings> {
  const data = await requestEnvelope(`${trimOrigin(options.panelUrl)}/api/v1/settings/public`, { method: 'GET' }, options)
  return decodePublicSettings(data)
}

/**
 * Submit the password step.
 * @param options - panel address and transport.
 * @param credentials - account address, password, and the captcha proof the form collected.
 * @returns the token pair, or the second-factor challenge the panel demands next.
 * @throws TFlowProtocolError when the panel refuses or answers off-contract.
 */
export async function signIn(
  options: TFlowRequestOptions,
  credentials: { email: string; password: string; captchaProof: string },
): Promise<{ kind: 'authenticated'; session: TFlowSession } | { kind: 'totp-required'; challenge: TFlowTotpChallenge }> {
  const data = await requestEnvelope(`${trimOrigin(options.panelUrl)}/api/v1/auth/login`, {
    method: 'POST',
    headers: CONTENT_TYPE_JSON,
    body: JSON.stringify({
      email: credentials.email,
      password: credentials.password,
      turnstile_token: credentials.captchaProof,
    }),
  }, options)
  if (!isRecord(data)) throw new TFlowProtocolError('protocol', 'TFlow 登录响应格式异常')
  if (data['requires_2fa'] === true) {
    const maskedEmail = optionalString(data, 'user_email_masked')
    return {
      kind: 'totp-required',
      challenge: {
        tempToken: requiredString(data, 'temp_token', 'TFlow 登录'),
        ...maskedEmail === undefined ? {} : { maskedEmail },
      },
    }
  }
  return { kind: 'authenticated', session: decodeSession(data) }
}

/**
 * Complete the second factor.
 * @param options - panel address and transport.
 * @param challenge - temporary token the password step returned.
 * @param totpCode - six-digit code from the authenticator.
 * @returns the token pair.
 * @throws TFlowProtocolError when the code is malformed, refused, or answered off-contract.
 */
export async function completeTwoFactor(
  options: TFlowRequestOptions,
  challenge: TFlowTotpChallenge,
  totpCode: string,
): Promise<TFlowSession> {
  if (!/^[0-9]{6}$/u.test(totpCode)) {
    throw new TFlowProtocolError('protocol', '请输入 6 位数字验证码')
  }
  const data = await requestEnvelope(`${trimOrigin(options.panelUrl)}/api/v1/auth/login/2fa`, {
    method: 'POST',
    headers: CONTENT_TYPE_JSON,
    body: JSON.stringify({ temp_token: challenge.tempToken, totp_code: totpCode }),
  }, options)
  return decodeSession(data)
}

/**
 * Exchange a refresh token for a new pair. The panel rotates the refresh token,
 * so the caller must persist both returned fields or the next refresh fails.
 * @param options - panel address and transport.
 * @param refreshToken - token from the previous pair.
 * @returns the replacement pair.
 * @throws TFlowProtocolError when the panel refuses the grant.
 */
export async function refreshSession(options: TFlowRequestOptions, refreshToken: string): Promise<TFlowSession> {
  const data = await requestEnvelope(`${trimOrigin(options.panelUrl)}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: CONTENT_TYPE_JSON,
    body: JSON.stringify({ refresh_token: refreshToken }),
  }, options)
  return decodeSession(data)
}

/** Panel call authorized by the access token. */
function authorized(accessToken: string, init: RequestInit = {}): RequestInit {
  return { ...init, headers: { ...init.headers, Authorization: `Bearer ${accessToken}` } }
}

/**
 * Read the signed-in account summary.
 * @param options - panel address and transport.
 * @param accessToken - current panel access token.
 * @returns the display name and USD balance.
 * @throws TFlowProtocolError when the token is refused or the payload is off-contract.
 */
export async function fetchAccount(options: TFlowRequestOptions, accessToken: string): Promise<TFlowAccount> {
  const data = await requestEnvelope(`${trimOrigin(options.panelUrl)}/api/v1/auth/me`, authorized(accessToken), options)
  if (!isRecord(data)) throw new TFlowProtocolError('protocol', 'TFlow 账户响应格式异常')
  const email = requiredString(data, 'email', 'TFlow 账户')
  if (!email.includes('@')) throw new TFlowProtocolError('protocol', 'TFlow 账户响应缺少可用邮箱')
  return { displayName: email.split('@', 1)[0] ?? email, balance: requiredNumber(data, 'balance', 'TFlow 账户') }
}

/**
 * List the model groups this account may provision a key for.
 * @param options - panel address and transport.
 * @param accessToken - current panel access token.
 * @returns the selectable groups; an account with none yields an empty list.
 * @throws TFlowProtocolError when the token is refused or the payload is off-contract.
 */
export async function listGroups(options: TFlowRequestOptions, accessToken: string): Promise<TFlowGroup[]> {
  const data = await requestEnvelope(`${trimOrigin(options.panelUrl)}/api/v1/groups/available`, authorized(accessToken), options)
  const items = Array.isArray(data) ? data : isRecord(data) && Array.isArray(data['items']) ? data['items'] : undefined
  if (items === undefined) throw new TFlowProtocolError('protocol', 'TFlow 分组响应格式异常')
  const groups: TFlowGroup[] = []
  for (const item of items) {
    if (!isRecord(item)) continue
    const id = groupIdOf(item['id'])
    const name = item['name']
    if (id === undefined || typeof name !== 'string' || name === '') continue
    groups.push({ id, name })
  }
  return groups
}

/** One page of the account's model keys, filtered by the panel. */
async function listKeys(options: TFlowRequestOptions, accessToken: string, groupId?: string): Promise<Record<string, unknown>[]> {
  const query = new URLSearchParams({ page: '1', page_size: '100', search: TFLOW_MODEL_KEY_NAME, status: 'active' })
  if (groupId !== undefined) query.set('group_id', groupId)
  const data = await requestEnvelope(`${trimOrigin(options.panelUrl)}/api/v1/keys?${query.toString()}`, authorized(accessToken), options)
  if (!isRecord(data) || !Array.isArray(data['items'])) {
    throw new TFlowProtocolError('protocol', 'TFlow API Key 查询响应格式异常')
  }
  return data['items'].filter(isRecord)
}

/** Whether one key entry is the active key this product owns for the given group. */
function matchesModelKey(entry: Record<string, unknown>, groupId: string | undefined): boolean {
  if (entry['name'] !== TFLOW_MODEL_KEY_NAME || entry['status'] !== 'active') return false
  if (groupId === undefined) return true
  return groupIdOf(entry['group_id']) === groupId
}

/**
 * Find or create this product's active model key.
 *
 * The panel refuses an ungrouped key on this deployment, so a caller that knows
 * the group passes it and only a key bound to that group is reused. Creation
 * carries an idempotency key so a retried request cannot mint a second key.
 * @param options - panel address and transport.
 * @param accessToken - current panel access token.
 * @param groupId - group the key must serve; omitted searches every group.
 * @param idempotencyKey - value for the create request's `Idempotency-Key` header.
 * @returns the model key and the group it is bound to.
 * @throws TFlowProtocolError when the panel refuses or answers off-contract.
 */
export async function ensureModelKey(
  options: TFlowRequestOptions,
  accessToken: string,
  groupId: string | undefined,
  idempotencyKey: string,
): Promise<TFlowModelKey> {
  const existing = (await listKeys(options, accessToken, groupId)).find(entry => matchesModelKey(entry, groupId))
  const existingKey = existing?.['key']
  if (typeof existingKey === 'string' && existingKey !== '') {
    const boundGroup = groupIdOf(existing?.['group_id'])
    return { key: existingKey, ...boundGroup === undefined ? {} : { groupId: boundGroup } }
  }
  if (groupId !== undefined && !/^[0-9]+$/u.test(groupId)) {
    throw new TFlowProtocolError('protocol', '分组 ID 无效，请重新选择分组')
  }
  const created = await requestEnvelope(`${trimOrigin(options.panelUrl)}/api/v1/keys`, {
    method: 'POST',
    headers: { ...CONTENT_TYPE_JSON, ...authorized(accessToken).headers, 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ name: TFLOW_MODEL_KEY_NAME, ...groupId === undefined ? {} : { group_id: Number(groupId) } }),
  }, options)
  if (!isRecord(created)) throw new TFlowProtocolError('protocol', 'TFlow API Key 创建响应格式异常')
  const key = requiredString(created, 'key', 'TFlow API Key 创建')
  const boundGroup = groupIdOf(created['group_id'])
  return { key, ...boundGroup === undefined ? {} : { groupId: boundGroup } }
}

/**
 * Read the remaining allowance of the subscription bound to one group.
 * @param options - panel address and transport.
 * @param accessToken - current panel access token.
 * @param groupId - group whose subscription progress is requested.
 * @returns the group name and every window the panel reported, or `null` when no subscription covers the group.
 * @throws TFlowProtocolError when the token is refused or the payload is off-contract.
 */
export async function fetchSubscription(
  options: TFlowRequestOptions,
  accessToken: string,
  groupId: string,
): Promise<{ groupName: string; remaining: TFlowRemaining } | null> {
  const data = await requestEnvelope(`${trimOrigin(options.panelUrl)}/api/v1/subscriptions/progress`, authorized(accessToken), options)
  if (!Array.isArray(data)) throw new TFlowProtocolError('protocol', 'TFlow 订阅响应格式异常')
  for (const item of data) {
    if (!isRecord(item) || groupIdOf(isRecord(item['subscription']) ? item['subscription']['group_id'] : undefined) !== groupId) continue
    const progress = item['progress']
    if (!isRecord(progress)) throw new TFlowProtocolError('protocol', 'TFlow 订阅响应格式异常')
    const remaining: { daily?: number; weekly?: number; monthly?: number } = {}
    for (const window of ['daily', 'weekly', 'monthly'] as const) {
      const entry = progress[window]
      if (entry === undefined) continue
      if (!isRecord(entry)) throw new TFlowProtocolError('protocol', 'TFlow 订阅响应格式异常')
      remaining[window] = requiredNumber(entry, 'remaining_usd', 'TFlow 订阅')
    }
    if (Object.keys(remaining).length === 0) throw new TFlowProtocolError('protocol', 'TFlow 订阅响应格式异常')
    return { groupName: requiredString(progress, 'group_name', 'TFlow 订阅'), remaining }
  }
  return null
}

/**
 * Resolve what the account draws on: a subscription for the selected group when
 * one covers it, otherwise the metered balance. Both facts come from the panel;
 * the client never computes an allowance or a remaining amount itself.
 * @param options - panel address and transport.
 * @param accessToken - current panel access token.
 * @param groupId - selected group, when the account has one.
 * @returns the entitlement the account menu displays.
 * @throws TFlowProtocolError when the token is refused or a payload is off-contract.
 */
export async function fetchEntitlement(
  options: TFlowRequestOptions,
  accessToken: string,
  groupId: string | undefined,
): Promise<TFlowEntitlement> {
  const account = await fetchAccount(options, accessToken)
  if (groupId === undefined) return { kind: 'balance', account }
  const subscription = await fetchSubscription(options, accessToken, groupId)
  return subscription === null
    ? { kind: 'balance', account }
    : { kind: 'subscription', account, groupName: subscription.groupName, remaining: subscription.remaining }
}

/**
 * Read one usage period from the panel's dashboard statistics.
 * @param data - dashboard statistics object.
 * @param prefix - `today` or `total`, the panel's field prefix.
 * @returns the request, token, and charged totals.
 */
function usagePeriod(data: Record<string, unknown>, prefix: 'today' | 'total'): TFlowUsagePeriod {
  return {
    requests: requiredNumber(data, `${prefix}_requests`, 'TFlow 用量'),
    tokens: requiredNumber(data, `${prefix}_tokens`, 'TFlow 用量'),
    cost: requiredNumber(data, `${prefix}_actual_cost`, 'TFlow 用量'),
  }
}

/**
 * Read the signed-in user's usage for today and all time.
 * @param options - panel address and transport.
 * @param accessToken - current panel access token.
 * @returns today's and cumulative totals; cost is the amount the panel deducted.
 * @throws TFlowProtocolError when the token is refused or the payload is off-contract.
 */
export async function fetchUsage(options: TFlowRequestOptions, accessToken: string): Promise<TFlowUsage> {
  const data = await requestEnvelope(`${trimOrigin(options.panelUrl)}/api/v1/usage/dashboard/stats`, authorized(accessToken), options)
  if (!isRecord(data)) throw new TFlowProtocolError('protocol', 'TFlow 用量响应格式异常')
  return { today: usagePeriod(data, 'today'), total: usagePeriod(data, 'total') }
}

/**
 * List the models the gateway serves for one model key.
 * @param options - panel address and transport; the gateway root comes from the public settings.
 * @param modelKey - provisioned TFlow model key.
 * @returns the advertised models, in panel order.
 * @throws TFlowProtocolError when the key is refused, the gateway is unreachable, or the payload is off-contract.
 */
export async function listModels(options: TFlowRequestOptions & { readonly gatewayUrl: string }, modelKey: string): Promise<TFlowModel[]> {
  const body = await requestGateway(`${gatewayRoot(options.gatewayUrl)}/models`, authorized(modelKey), options)
  if (!isRecord(body) || !Array.isArray(body['data'])) {
    throw new TFlowProtocolError('protocol', 'TFlow 模型目录响应格式异常')
  }
  const models: TFlowModel[] = []
  for (const entry of body['data']) {
    if (isRecord(entry) && typeof entry['id'] === 'string' && entry['id'] !== '') models.push({ id: entry['id'] })
  }
  return models
}
