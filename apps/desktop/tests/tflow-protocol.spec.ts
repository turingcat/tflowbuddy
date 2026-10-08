import { describe, expect, it, vi } from 'vitest'
import {
  TFLOW_MODEL_KEY_NAME,
  TFlowProtocolError,
  completeTwoFactor,
  ensureModelKey,
  fetchAccount,
  fetchEntitlement,
  fetchPublicSettings,
  fetchSubscription,
  fetchUsage,
  gatewayRoot,
  listGroups,
  listModels,
  refreshSession,
  signIn,
  type TFlowFetch,
  type TFlowRequestOptions,
} from '../src/tflow/protocol.ts'

const PANEL = 'https://tflow.online'
const OPTIONS: TFlowRequestOptions = { panelUrl: PANEL }

/** Answer one request with a panel envelope. */
function envelope(data: unknown, status = 200, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ code: 0, ...extra, data }), { status })
}

/** Answer one request with an arbitrary body. */
function body(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status })
}

/** A transport that answers each request from a queue and records what it received. */
function queued(
  ...responses: Array<Response | (() => Response)>
): TFlowFetch & { calls: Array<{ url: string; init: RequestInit | undefined }> } {
  const queue = [...responses]
  const calls: Array<{ url: string; init: RequestInit | undefined }> = []
  const fetchImpl = (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init })
    const next = queue.shift()
    if (next === undefined) return Promise.reject(new Error(`unexpected request to ${url}`))
    return Promise.resolve(typeof next === 'function' ? next() : next)
  }
  return Object.assign(fetchImpl, { calls })
}

/** Read the JSON request emitted by the protocol fixture. */
function parseRequestBody(body: RequestInit['body']): unknown {
  if (typeof body !== 'string') throw new Error('Expected a JSON request body')
  return JSON.parse(body)
}

describe('gatewayRoot', () => {
  it('normalizes an advertised address to a single /v1 root', () => {
    expect(gatewayRoot('https://tflow.online')).toBe('https://tflow.online/v1')
    expect(gatewayRoot('https://tflow.online/')).toBe('https://tflow.online/v1')
    expect(gatewayRoot('https://tflow.online/v1')).toBe('https://tflow.online/v1')
    expect(gatewayRoot('https://tflow.online/v1/')).toBe('https://tflow.online/v1')
  })
})

describe('fetchPublicSettings', () => {
  it('reads the captcha and gateway settings the login form needs', async () => {
    const fetchImpl = queued(envelope({
      aliyun_captcha_enabled: true,
      aliyun_captcha_scene_id: 'scene-1',
      aliyun_captcha_prefix: 'prefix',
      aliyun_captcha_region: 'cn',
      api_base_url: 'https://tflow.online/',
    }))

    await expect(fetchPublicSettings({ ...OPTIONS, fetch: fetchImpl })).resolves.toEqual({
      captchaEnabled: true,
      captchaSceneId: 'scene-1',
      captchaPrefix: 'prefix',
      captchaRegion: 'cn',
      panelUrl: 'https://tflow.online',
      gatewayUrl: 'https://tflow.online/v1',
    })
    expect(fetchImpl.calls[0]?.url).toBe('https://tflow.online/api/v1/settings/public')
  })

  it('rejects settings that omit the captcha switch', async () => {
    const fetchImpl = queued(envelope({ api_base_url: 'https://tflow.online' }))
    await expect(fetchPublicSettings({ ...OPTIONS, fetch: fetchImpl }))
      .rejects.toThrow(/aliyun_captcha_enabled/u)
  })

  it('rejects settings without a gateway address', async () => {
    const fetchImpl = queued(envelope({ aliyun_captcha_enabled: false }))
    await expect(fetchPublicSettings({ ...OPTIONS, fetch: fetchImpl }))
      .rejects.toThrow(/api_base_url/u)
  })

  it('classifies a non-JSON response as protocol, keeping the HTTP status', async () => {
    const fetchImpl = queued(new Response('<html/>', { status: 200 }))
    await expect(fetchPublicSettings({ ...OPTIONS, fetch: fetchImpl })).rejects.toMatchObject({
      kind: 'protocol',
      status: 200,
    })
  })

  it('classifies an unreachable panel as network', async () => {
    const fetchImpl: TFlowFetch = () => Promise.reject(new Error('ECONNREFUSED'))
    await expect(fetchPublicSettings({ ...OPTIONS, fetch: fetchImpl })).rejects.toMatchObject({ kind: 'network' })
  })

  it('classifies an elapsed deadline as timeout', async () => {
    const fetchImpl: TFlowFetch = () => Promise.reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' }))
    await expect(fetchPublicSettings({ ...OPTIONS, fetch: fetchImpl })).rejects.toMatchObject({ kind: 'timeout' })
  })
})

describe('signIn', () => {
  it('returns the token pair on a password-only deployment', async () => {
    const fetchImpl = queued(envelope({ access_token: 'access', refresh_token: 'refresh' }))
    await expect(signIn({ ...OPTIONS, fetch: fetchImpl }, { email: 'a@b.c', password: 'secret', captchaProof: 'proof' }))
      .resolves.toEqual({ kind: 'authenticated', session: { accessToken: 'access', refreshToken: 'refresh' } })
    expect(fetchImpl.calls[0]?.url).toBe('https://tflow.online/api/v1/auth/login')
    expect(parseRequestBody(fetchImpl.calls[0]?.init?.body)).toEqual({
      email: 'a@b.c', password: 'secret', turnstile_token: 'proof',
    })
  })

  it('reports a token pair without a refresh grant', async () => {
    const fetchImpl = queued(envelope({ access_token: 'access' }))
    await expect(signIn({ ...OPTIONS, fetch: fetchImpl }, { email: 'a@b.c', password: 'p', captchaProof: '' }))
      .resolves.toEqual({ kind: 'authenticated', session: { accessToken: 'access' } })
  })

  it('reports the second-factor challenge with the masked address', async () => {
    const fetchImpl = queued(envelope({ requires_2fa: true, temp_token: 'temp', user_email_masked: 'a***@b.c' }))
    await expect(signIn({ ...OPTIONS, fetch: fetchImpl }, { email: 'a@b.c', password: 'p', captchaProof: '' }))
      .resolves.toEqual({ kind: 'totp-required', challenge: { tempToken: 'temp', maskedEmail: 'a***@b.c' } })
  })

  it('reports a second-factor challenge the panel sent without a masked address', async () => {
    const fetchImpl = queued(envelope({ requires_2fa: true, temp_token: 'temp' }))
    await expect(signIn({ ...OPTIONS, fetch: fetchImpl }, { email: 'a@b.c', password: 'p', captchaProof: '' }))
      .resolves.toEqual({ kind: 'totp-required', challenge: { tempToken: 'temp' } })
  })

  it('fails when a challenge carries no temporary token', async () => {
    const fetchImpl = queued(envelope({ requires_2fa: true }))
    await expect(signIn({ ...OPTIONS, fetch: fetchImpl }, { email: 'a@b.c', password: 'p', captchaProof: '' }))
      .rejects.toThrow(/temp_token/u)
  })

  it('surfaces the panel message and reason on a refused sign-in', async () => {
    const fetchImpl = queued(body({ code: 4001, message: '验证码错误', reason: 'captcha_invalid' }, 200))
    await expect(signIn({ ...OPTIONS, fetch: fetchImpl }, { email: 'a@b.c', password: 'p', captchaProof: '' }))
      .rejects.toMatchObject({ kind: 'service', message: '验证码错误', reason: 'captcha_invalid' })
  })

  it('classifies a refused credential as unauthorized', async () => {
    const fetchImpl = queued(body({ code: 401, message: '邮箱或密码错误' }, 401))
    await expect(signIn({ ...OPTIONS, fetch: fetchImpl }, { email: 'a@b.c', password: 'p', captchaProof: '' }))
      .rejects.toMatchObject({ kind: 'unauthorized', status: 401 })
  })

  it('honours a refusal code the panel sent with a success status', async () => {
    const fetchImpl = queued(body({ code: 401, message: '登录已失效' }))
    await expect(signIn({ ...OPTIONS, fetch: fetchImpl }, { email: 'a@b.c', password: 'p', captchaProof: '' }))
      .rejects.toMatchObject({ kind: 'unauthorized', status: 200 })
  })

  it('classifies a throttled refusal code sent with a success status', async () => {
    const fetchImpl = queued(body({ code: 429, message: '请求过于频繁' }))
    await expect(signIn({ ...OPTIONS, fetch: fetchImpl }, { email: 'a@b.c', password: 'p', captchaProof: '' }))
      .rejects.toMatchObject({ kind: 'rate-limited' })
  })

  it('classifies a forbidden refusal code sent with a success status', async () => {
    const fetchImpl = queued(body({ code: 403, message: '无权访问' }))
    await expect(signIn({ ...OPTIONS, fetch: fetchImpl }, { email: 'a@b.c', password: 'p', captchaProof: '' }))
      .rejects.toMatchObject({ kind: 'forbidden' })
  })

  it('falls back to the envelope message when the panel sent none', async () => {
    const fetchImpl = queued(body({ code: 5001 }))
    await expect(signIn({ ...OPTIONS, fetch: fetchImpl }, { email: 'a@b.c', password: 'p', captchaProof: '' }))
      .rejects.toMatchObject({ kind: 'service', message: 'TFlow 请求失败' })
  })

  it('classifies a failed response that carries no envelope as a service failure', async () => {
    const fetchImpl = queued(new Response('<html/>', { status: 502 }))
    await expect(signIn({ ...OPTIONS, fetch: fetchImpl }, { email: 'a@b.c', password: 'p', captchaProof: '' }))
      .rejects.toMatchObject({ kind: 'service', status: 502 })
  })

  it('reports a success envelope whose code is not a number', async () => {
    const fetchImpl = queued(body({ code: '0', data: {} }))
    await expect(signIn({ ...OPTIONS, fetch: fetchImpl }, { email: 'a@b.c', password: 'p', captchaProof: '' }))
      .rejects.toMatchObject({ kind: 'protocol' })
  })

  it('reports a success envelope with a zero code but a failed status', async () => {
    const fetchImpl = queued(body({ code: 0, data: { access_token: 'access' } }, 500))
    await expect(signIn({ ...OPTIONS, fetch: fetchImpl }, { email: 'a@b.c', password: 'p', captchaProof: '' }))
      .rejects.toMatchObject({ kind: 'service', status: 500 })
  })

  it('classifies a throttled sign-in as rate-limited', async () => {
    const fetchImpl = queued(body({ code: 429, message: '请求过于频繁' }, 429))
    await expect(signIn({ ...OPTIONS, fetch: fetchImpl }, { email: 'a@b.c', password: 'p', captchaProof: '' }))
      .rejects.toMatchObject({ kind: 'rate-limited' })
  })

  it('classifies a forbidden sign-in as forbidden', async () => {
    const fetchImpl = queued(body({ code: 403, message: '账号已停用' }, 403))
    await expect(signIn({ ...OPTIONS, fetch: fetchImpl }, { email: 'a@b.c', password: 'p', captchaProof: '' }))
      .rejects.toMatchObject({ kind: 'forbidden' })
  })

  it('rejects a success envelope that carries no access token', async () => {
    const fetchImpl = queued(envelope({ refresh_token: 'refresh' }))
    await expect(signIn({ ...OPTIONS, fetch: fetchImpl }, { email: 'a@b.c', password: 'p', captchaProof: '' }))
      .rejects.toThrow(/access_token/u)
  })

  it('rejects a success envelope that is not an object', async () => {
    const fetchImpl = queued(envelope('nope'))
    await expect(signIn({ ...OPTIONS, fetch: fetchImpl }, { email: 'a@b.c', password: 'p', captchaProof: '' }))
      .rejects.toThrow(/登录响应格式异常/u)
  })
})

describe('completeTwoFactor', () => {
  it('exchanges the challenge for a token pair', async () => {
    const fetchImpl = queued(envelope({ access_token: 'access' }))
    await expect(completeTwoFactor({ ...OPTIONS, fetch: fetchImpl }, { tempToken: 'temp' }, '123456'))
      .resolves.toEqual({ accessToken: 'access' })
    expect(fetchImpl.calls[0]?.url).toBe('https://tflow.online/api/v1/auth/login/2fa')
    expect(parseRequestBody(fetchImpl.calls[0]?.init?.body)).toEqual({ temp_token: 'temp', totp_code: '123456' })
  })

  it.each(['12345', '1234567', 'abcdef', ''])('refuses the malformed code %j before any request', async (code) => {
    const fetchImpl = queued()
    await expect(completeTwoFactor({ ...OPTIONS, fetch: fetchImpl }, { tempToken: 'temp' }, code))
      .rejects.toThrow(/6 位数字/u)
    expect(fetchImpl.calls).toEqual([])
  })
})

describe('refreshSession', () => {
  it('returns the rotated pair', async () => {
    const fetchImpl = queued(envelope({ access_token: 'next-access', refresh_token: 'next-refresh' }))
    await expect(refreshSession({ ...OPTIONS, fetch: fetchImpl }, 'refresh'))
      .resolves.toEqual({ accessToken: 'next-access', refreshToken: 'next-refresh' })
    expect(parseRequestBody(fetchImpl.calls[0]?.init?.body)).toEqual({ refresh_token: 'refresh' })
  })
})

describe('fetchAccount', () => {
  it('derives the display name from the address and reads the USD balance', async () => {
    const fetchImpl = queued(envelope({ email: 'alice@example.com', balance: 12.34 }))
    await expect(fetchAccount({ ...OPTIONS, fetch: fetchImpl }, 'access'))
      .resolves.toEqual({ displayName: 'alice', balance: 12.34 })
    expect(new Headers(fetchImpl.calls[0]?.init?.headers).get('Authorization')).toBe('Bearer access')
  })

  it('rejects an account payload without a deliverable address', async () => {
    const fetchImpl = queued(envelope({ email: 'not-an-address', balance: 1 }))
    await expect(fetchAccount({ ...OPTIONS, fetch: fetchImpl }, 'access')).rejects.toThrow(/可用邮箱/u)
  })

  it('rejects an account payload without a numeric balance', async () => {
    const fetchImpl = queued(envelope({ email: 'a@b.c', balance: '1' }))
    await expect(fetchAccount({ ...OPTIONS, fetch: fetchImpl }, 'access')).rejects.toThrow(/balance/u)
  })

  it('rejects an account payload that is not an object', async () => {
    const fetchImpl = queued(envelope(null))
    await expect(fetchAccount({ ...OPTIONS, fetch: fetchImpl }, 'access')).rejects.toThrow(/账户响应格式异常/u)
  })
})

describe('listGroups', () => {
  it('reads the array form and stringifies numeric identifiers', async () => {
    const fetchImpl = queued(envelope([{ id: 12, name: '默认' }, { id: 'sub-2', name: '订阅' }]))
    await expect(listGroups({ ...OPTIONS, fetch: fetchImpl }, 'access')).resolves.toEqual([
      { id: '12', name: '默认' },
      { id: 'sub-2', name: '订阅' },
    ])
  })

  it('reads the envelope form and skips entries the panel spelled unusably', async () => {
    const fetchImpl = queued(envelope({ items: [{ id: 1, name: 'ok' }, { id: null, name: 'no-id' }, { id: 2, name: '' }, 7] }))
    await expect(listGroups({ ...OPTIONS, fetch: fetchImpl }, 'access')).resolves.toEqual([{ id: '1', name: 'ok' }])
  })

  it('rejects a payload that carries neither form', async () => {
    const fetchImpl = queued(envelope({ total: 0 }))
    await expect(listGroups({ ...OPTIONS, fetch: fetchImpl }, 'access')).rejects.toThrow(/分组响应格式异常/u)
  })
})

describe('ensureModelKey', () => {
  it('reuses the active key already bound to the selected group', async () => {
    const fetchImpl = queued(envelope({ items: [
      { name: TFLOW_MODEL_KEY_NAME, status: 'active', key: 'sk-bound', group_id: 7 },
    ] }))
    await expect(ensureModelKey({ ...OPTIONS, fetch: fetchImpl }, 'access', '7', 'idem'))
      .resolves.toEqual({ key: 'sk-bound', groupId: '7' })
    expect(fetchImpl.calls).toHaveLength(1)
    expect(fetchImpl.calls[0]?.url).toContain('group_id=7')
    expect(fetchImpl.calls[0]?.url).toContain(`search=${TFLOW_MODEL_KEY_NAME}`)
  })

  it('ignores a key that belongs to another group and creates one for the selection', async () => {
    const fetchImpl = queued(
      envelope({ items: [{ name: TFLOW_MODEL_KEY_NAME, status: 'active', key: 'sk-other', group_id: 9 }] }),
      envelope({ key: 'sk-new', group_id: 7 }),
    )
    await expect(ensureModelKey({ ...OPTIONS, fetch: fetchImpl }, 'access', '7', 'idem'))
      .resolves.toEqual({ key: 'sk-new', groupId: '7' })
    const created = fetchImpl.calls[1]
    expect(created?.init?.method).toBe('POST')
    expect(created?.init?.headers).toMatchObject({ 'Idempotency-Key': 'idem' })
    expect(parseRequestBody(created?.init?.body)).toEqual({ name: TFLOW_MODEL_KEY_NAME, group_id: 7 })
  })

  it('ignores a key the panel no longer reports as active', async () => {
    const fetchImpl = queued(
      envelope({ items: [{ name: TFLOW_MODEL_KEY_NAME, status: 'disabled', key: 'sk-old', group_id: 7 }] }),
      envelope({ key: 'sk-new', group_id: 7 }),
    )
    await expect(ensureModelKey({ ...OPTIONS, fetch: fetchImpl }, 'access', '7', 'idem')).resolves.toMatchObject({ key: 'sk-new' })
  })

  it('searches without a group when the account has no selection', async () => {
    const fetchImpl = queued(envelope({ items: [] }), envelope({ key: 'sk-ungrouped' }))
    await expect(ensureModelKey({ ...OPTIONS, fetch: fetchImpl }, 'access', undefined, 'idem'))
      .resolves.toEqual({ key: 'sk-ungrouped' })
    expect(fetchImpl.calls[0]?.url).not.toContain('group_id')
    expect(parseRequestBody(fetchImpl.calls[1]?.init?.body)).toEqual({ name: TFLOW_MODEL_KEY_NAME })
  })

  it('refuses a non-numeric group before asking the panel to create anything', async () => {
    const fetchImpl = queued(envelope({ items: [] }))
    await expect(ensureModelKey({ ...OPTIONS, fetch: fetchImpl }, 'access', 'group-a', 'idem'))
      .rejects.toThrow(/分组 ID 无效/u)
    expect(fetchImpl.calls).toHaveLength(1)
  })

  it('rejects a created key entry without a key value', async () => {
    const fetchImpl = queued(envelope({ items: [] }), envelope({ group_id: 7 }))
    await expect(ensureModelKey({ ...OPTIONS, fetch: fetchImpl }, 'access', '7', 'idem')).rejects.toThrow(/API Key 创建/u)
  })

  it('rejects a key list that is not a page', async () => {
    const fetchImpl = queued(envelope({ total: 1 }))
    await expect(ensureModelKey({ ...OPTIONS, fetch: fetchImpl }, 'access', '7', 'idem'))
      .rejects.toThrow(/API Key 查询响应格式异常/u)
  })

  it('rejects a create response that is not an object', async () => {
    const fetchImpl = queued(envelope({ items: [] }), envelope(null))
    await expect(ensureModelKey({ ...OPTIONS, fetch: fetchImpl }, 'access', '7', 'idem'))
      .rejects.toThrow(/API Key 创建响应格式异常/u)
  })

  it('keeps a reused key whose group the panel did not report', async () => {
    const fetchImpl = queued(envelope({ items: [{ name: TFLOW_MODEL_KEY_NAME, status: 'active', key: 'sk-any' }] }))
    await expect(ensureModelKey({ ...OPTIONS, fetch: fetchImpl }, 'access', undefined, 'idem')).resolves.toEqual({ key: 'sk-any' })
  })
})

describe('fetchSubscription', () => {
  it('reads every window the panel reported for the selected group', async () => {
    const fetchImpl = queued(envelope([
      { subscription: { group_id: 7 }, progress: { group_name: '订阅套餐', daily: { remaining_usd: 1.5 }, monthly: { remaining_usd: 30 } } },
    ]))
    await expect(fetchSubscription({ ...OPTIONS, fetch: fetchImpl }, 'access', '7')).resolves.toEqual({
      groupName: '订阅套餐',
      remaining: { daily: 1.5, monthly: 30 },
    })
  })

  it('reports no subscription when the group has no progress entry', async () => {
    const fetchImpl = queued(envelope([{ subscription: { group_id: 9 }, progress: { group_name: 'other', daily: { remaining_usd: 1 } } }]))
    await expect(fetchSubscription({ ...OPTIONS, fetch: fetchImpl }, 'access', '7')).resolves.toBeNull()
  })

  it('rejects progress without any remaining window', async () => {
    const fetchImpl = queued(envelope([{ subscription: { group_id: 7 }, progress: { group_name: 'g' } }]))
    await expect(fetchSubscription({ ...OPTIONS, fetch: fetchImpl }, 'access', '7')).rejects.toThrow(/订阅响应格式异常/u)
  })

  it('rejects a window whose remaining amount is not numeric', async () => {
    const fetchImpl = queued(envelope([{ subscription: { group_id: 7 }, progress: { group_name: 'g', daily: { remaining_usd: '1' } } }]))
    await expect(fetchSubscription({ ...OPTIONS, fetch: fetchImpl }, 'access', '7')).rejects.toThrow(/remaining_usd/u)
  })

  it('rejects a progress entry that is not an object', async () => {
    const fetchImpl = queued(envelope([{ subscription: { group_id: 7 }, progress: null }]))
    await expect(fetchSubscription({ ...OPTIONS, fetch: fetchImpl }, 'access', '7')).rejects.toThrow(/订阅响应格式异常/u)
  })

  it('rejects a window entry that is not an object', async () => {
    const fetchImpl = queued(envelope([{ subscription: { group_id: 7 }, progress: { group_name: 'g', daily: 1 } }]))
    await expect(fetchSubscription({ ...OPTIONS, fetch: fetchImpl }, 'access', '7')).rejects.toThrow(/订阅响应格式异常/u)
  })

  it('rejects a progress payload that is not a list', async () => {
    const fetchImpl = queued(envelope({ items: [] }))
    await expect(fetchSubscription({ ...OPTIONS, fetch: fetchImpl }, 'access', '7')).rejects.toThrow(/订阅响应格式异常/u)
  })

  it('rejects progress without a group name', async () => {
    const fetchImpl = queued(envelope([{ subscription: { group_id: 7 }, progress: { daily: { remaining_usd: 1 } } }]))
    await expect(fetchSubscription({ ...OPTIONS, fetch: fetchImpl }, 'access', '7')).rejects.toThrow(/group_name/u)
  })
})

describe('fetchEntitlement', () => {
  it('reports the metered balance when the account has no group', async () => {
    const fetchImpl = queued(envelope({ email: 'alice@example.com', balance: 3 }))
    await expect(fetchEntitlement({ ...OPTIONS, fetch: fetchImpl }, 'access', undefined)).resolves.toEqual({
      kind: 'balance',
      account: { displayName: 'alice', balance: 3 },
    })
  })

  it('prefers the subscription that covers the selected group', async () => {
    const fetchImpl = queued(
      envelope({ email: 'alice@example.com', balance: 3 }),
      envelope([{ subscription: { group_id: 7 }, progress: { group_name: '套餐', weekly: { remaining_usd: 9 } } }]),
    )
    await expect(fetchEntitlement({ ...OPTIONS, fetch: fetchImpl }, 'access', '7')).resolves.toEqual({
      kind: 'subscription',
      account: { displayName: 'alice', balance: 3 },
      groupName: '套餐',
      remaining: { weekly: 9 },
    })
  })

  it('falls back to the balance when no subscription covers the group', async () => {
    const fetchImpl = queued(envelope({ email: 'alice@example.com', balance: 3 }), envelope([]))
    await expect(fetchEntitlement({ ...OPTIONS, fetch: fetchImpl }, 'access', '7')).resolves.toMatchObject({ kind: 'balance' })
  })
})

describe('fetchUsage', () => {
  const stats = {
    today_requests: 4, today_tokens: 1200, today_cost: 0.5, today_actual_cost: 0.4,
    total_requests: 90, total_tokens: 56000, total_cost: 12, total_actual_cost: 9.6,
  }

  it('reports what the panel deducted, not the standard price', async () => {
    const fetchImpl = queued(envelope(stats))
    await expect(fetchUsage({ ...OPTIONS, fetch: fetchImpl }, 'access')).resolves.toEqual({
      today: { requests: 4, tokens: 1200, cost: 0.4 },
      total: { requests: 90, tokens: 56000, cost: 9.6 },
    })
    expect(fetchImpl.calls[0]?.url).toBe(`${PANEL}/api/v1/usage/dashboard/stats`)
  })

  it('refuses a payload missing a total rather than reporting it as zero', async () => {
    const { total_actual_cost: _omitted, ...partial } = stats
    const fetchImpl = queued(envelope(partial))
    await expect(fetchUsage({ ...OPTIONS, fetch: fetchImpl }, 'access')).rejects.toThrow(/total_actual_cost/u)
  })
})

describe('listModels', () => {
  it('reads the OpenAI-compatible catalog behind the gateway root', async () => {
    const fetchImpl = queued(body({ object: 'list', data: [{ id: 'glm-5' }, { id: 'qwen3' }] }))
    await expect(listModels({ ...OPTIONS, gatewayUrl: 'https://tflow.online', fetch: fetchImpl }, 'sk'))
      .resolves.toEqual([{ id: 'glm-5' }, { id: 'qwen3' }])
    expect(fetchImpl.calls[0]?.url).toBe('https://tflow.online/v1/models')
    expect(new Headers(fetchImpl.calls[0]?.init?.headers).get('Authorization')).toBe('Bearer sk')
  })

  it('accepts an advertised address that already carries the version segment', async () => {
    const fetchImpl = queued(body({ data: [{ id: 'a' }] }))
    await expect(listModels({ ...OPTIONS, gatewayUrl: 'https://tflow.online/v1/', fetch: fetchImpl }, 'sk'))
      .resolves.toEqual([{ id: 'a' }])
    expect(fetchImpl.calls[0]?.url).toBe('https://tflow.online/v1/models')
  })

  it('reports an empty catalog as empty rather than inventing a model', async () => {
    const fetchImpl = queued(body({ data: [] }))
    await expect(listModels({ ...OPTIONS, gatewayUrl: PANEL, fetch: fetchImpl }, 'sk')).resolves.toEqual([])
  })

  it('drops entries without a usable identifier', async () => {
    const fetchImpl = queued(body({ data: [{ id: 'a' }, { id: '' }, { id: 7 }, null] }))
    await expect(listModels({ ...OPTIONS, gatewayUrl: PANEL, fetch: fetchImpl }, 'sk')).resolves.toEqual([{ id: 'a' }])
  })

  it('classifies a refused key as unauthorized', async () => {
    const fetchImpl = queued(body({ error: 'invalid key' }, 401))
    await expect(listModels({ ...OPTIONS, gatewayUrl: PANEL, fetch: fetchImpl }, 'sk'))
      .rejects.toMatchObject({ kind: 'unauthorized', status: 401 })
  })

  it('rejects a catalog payload that is not a list envelope', async () => {
    const fetchImpl = queued(body({ object: 'list' }))
    await expect(listModels({ ...OPTIONS, gatewayUrl: PANEL, fetch: fetchImpl }, 'sk')).rejects.toThrow(/模型目录响应格式异常/u)
  })

  it('rejects a success response that is not JSON', async () => {
    const fetchImpl = queued(new Response('nope', { status: 200 }))
    await expect(listModels({ ...OPTIONS, gatewayUrl: PANEL, fetch: fetchImpl }, 'sk')).rejects.toThrow(/模型服务响应格式异常/u)
  })

  it('classifies an unreachable gateway as network', async () => {
    const fetchImpl: TFlowFetch = () => Promise.reject(new Error('ECONNREFUSED'))
    await expect(listModels({ ...OPTIONS, gatewayUrl: PANEL, fetch: fetchImpl }, 'sk')).rejects.toMatchObject({ kind: 'network' })
  })

  it('classifies an elapsed gateway deadline as timeout', async () => {
    const fetchImpl: TFlowFetch = () => Promise.reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' }))
    await expect(listModels({ ...OPTIONS, gatewayUrl: PANEL, fetch: fetchImpl }, 'sk')).rejects.toMatchObject({ kind: 'timeout' })
  })
})

describe('TFlowProtocolError', () => {
  it('carries only the fields the caller supplied', () => {
    const minimal = new TFlowProtocolError('network', 'offline')
    expect(minimal.status).toBeUndefined()
    expect(minimal.reason).toBeUndefined()
    expect(minimal.name).toBe('TFlowProtocolError')
    expect(new TFlowProtocolError('service', 'refused', { status: 500, reason: 'boom' })).toMatchObject({
      status: 500, reason: 'boom',
    })
  })
})

describe('default transport', () => {
  it('uses the runtime fetch when no transport is injected', async () => {
    const stub = vi.fn(() => Promise.resolve(envelope({ access_token: 'access' })))
    vi.stubGlobal('fetch', stub)
    try {
      await expect(signIn(OPTIONS, { email: 'a@b.c', password: 'p', captchaProof: '' }))
        .resolves.toMatchObject({ kind: 'authenticated' })
      expect(stub).toHaveBeenCalledWith('https://tflow.online/api/v1/auth/login', expect.objectContaining({ method: 'POST' }))
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('applies the configured deadline to every request', async () => {
    const fetchImpl = queued(envelope({ access_token: 'access' }))
    await signIn({ ...OPTIONS, fetch: fetchImpl, timeoutMs: 1234 }, { email: 'a@b.c', password: 'p', captchaProof: '' })
    expect(fetchImpl.calls[0]?.init?.signal).toBeInstanceOf(AbortSignal)
  })
})
