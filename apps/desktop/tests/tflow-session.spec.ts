import { describe, expect, it, vi } from 'vitest'
import { createTFlowSession, type TFlowAuthState, type TFlowSessionEffects } from '../src/tflow/session.ts'
import type { TFlowCredentials } from '../src/tflow/credentials.ts'
import type { TFlowFetch } from '../src/tflow/protocol.ts'

const PANEL = 'https://tflow.online'
const SETTINGS = {
  aliyun_captcha_enabled: true,
  aliyun_captcha_scene_id: 'scene',
  aliyun_captcha_prefix: 'prefix',
  aliyun_captcha_region: 'cn',
  api_base_url: 'https://tflow.online',
}

/** Panel envelope. */
function panel(data: unknown, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ code: 0, ...extra, data }), { status: 200 })
}

/** Gateway body. */
function gateway(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status })
}

/**
 * A routed transport keyed by request URL fragment. Each route answers with a
 * fresh response, so a flow that hits the same endpoint twice — a restore
 * followed by an explicit refresh — reads a complete body both times.
 */
function routed(routes: Array<[string, Response | (() => Response)]>): TFlowFetch & { urls: string[] } {
  const urls: string[] = []
  const fetchImpl = (url: string): Promise<Response> => {
    urls.push(url)
    for (const [fragment, response] of routes) {
      if (!url.includes(fragment)) continue
      if (typeof response === 'function') return Promise.resolve(response())
      // Clone before reading: `routed` may be handed one shared response value,
      // and reading it here would exhaust it for every later request.
      return response.clone().text().then(text => new Response(text, { status: response.status, headers: response.headers }))
    }
    return Promise.reject(new Error(`unrouted request: ${url}`))
  }
  return Object.assign(fetchImpl, { urls })
}

/** Recording effects. */
function effects(overrides: Partial<TFlowSessionEffects> = {}): TFlowSessionEffects & {
  saved: TFlowCredentials[]
  cleared: number
  applied: TFlowCredentials[]
  catalogs: Array<readonly string[]>
  revoked: number
} {
  const recorded = {
    saved: [] as TFlowCredentials[],
    cleared: 0,
    applied: [] as TFlowCredentials[],
    catalogs: [] as Array<readonly string[]>,
    revoked: 0,
    save: (credentials: TFlowCredentials) => { recorded.saved.push(credentials); return Promise.resolve() },
    clear: () => { recorded.cleared++; return Promise.resolve() },
    apply: (credentials: TFlowCredentials, modelIds: readonly string[]) => {
      recorded.applied.push(credentials)
      recorded.catalogs.push(modelIds)
      return Promise.resolve()
    },
    revoke: () => { recorded.revoked++; return Promise.resolve() },
  }
  return Object.assign(recorded, overrides)
}

const SIGNED_IN_GROUPS = panel([{ id: 7, name: '默认分组' }])
const ONE_KEY = panel({ items: [{ name: 'TFlowBuddy', status: 'active', key: 'sk-model', group_id: 7 }] })

/** The routes a successful sign-in walks, in order. */
function successRoutes(models: unknown = { data: [{ id: 'glm-5' }] }): Array<[string, Response | (() => Response)]> {
  return [
    ['/api/v1/settings/public', panel(SETTINGS)],
    ['/api/v1/auth/login', panel({ access_token: 'access', refresh_token: 'refresh' })],
    ['/api/v1/groups/available', SIGNED_IN_GROUPS],
    ['/api/v1/keys?', ONE_KEY],
    ['/v1/models', gateway(models)],
  ]
}

describe('createTFlowSession', () => {
  it('starts signed out', () => {
    const session = createTFlowSession({ panelUrl: PANEL, effects: effects() })
    expect(session.state()).toEqual({ kind: 'signed-out' })
  })

  it('reports every state to its subscribers until they unsubscribe', async () => {
    const session = createTFlowSession({ panelUrl: PANEL, effects: effects(), fetch: routed(successRoutes()) })
    const seen: TFlowAuthState['kind'][] = []
    const stop = session.subscribe((state) => { seen.push(state.kind) })
    await session.start({ email: 'a@b.c', password: 'p', captchaProof: 'c' })
    expect(seen).toEqual(['group-required'])
    stop()
    await session.selectGroup('7')
    expect(seen).toEqual(['group-required'])
  })

  it('asks the user to confirm a group even when the account has only one', async () => {
    const record = effects()
    const session = createTFlowSession({ panelUrl: PANEL, effects: record, fetch: routed(successRoutes()) })
    await expect(session.start({ email: 'a@b.c', password: 'p', captchaProof: 'c' })).resolves.toEqual({
      kind: 'group-required',
      groups: [{ id: '7', name: '默认分组' }],
    })
    expect(record.saved).toEqual([])
  })

  it('provisions the selected group and reports an authenticated session', async () => {
    const record = effects()
    const session = createTFlowSession({ panelUrl: PANEL, effects: record, fetch: routed(successRoutes()), idempotencyKey: () => 'idem' })
    await session.start({ email: 'a@b.c', password: 'p', captchaProof: 'c' })
    const state = await session.selectGroup('7')
    expect(state).toEqual({
      kind: 'authenticated',
      credentials: {
        session: { accessToken: 'access', refreshToken: 'refresh' },
        panelUrl: PANEL,
        gatewayUrl: 'https://tflow.online/v1',
        modelKey: 'sk-model',
        // The binding travels with the key: the account read asks the panel for
        // this group's subscription, and a later sign-in reuses this key.
        groupId: '7',
      },
    })
    expect(record.saved).toEqual([(state as Extract<TFlowAuthState, { kind: 'authenticated' }>).credentials])
    expect(record.applied).toHaveLength(1)
    expect(record.catalogs).toEqual([['glm-5']])
  })

  it('keeps serving the advertised catalog across a refresh', async () => {
    const record = effects()
    const session = createTFlowSession({
      panelUrl: PANEL,
      effects: record,
      fetch: routed([
        ...successRoutes({ data: [{ id: 'glm-5' }, { id: 'qwen3' }] }),
        ['/api/v1/auth/refresh', panel({ access_token: 'next', refresh_token: 'next-refresh' })],
      ]),
      idempotencyKey: () => 'idem',
    })
    await session.start({ email: 'a@b.c', password: 'p', captchaProof: 'c' })
    await session.selectGroup('7')
    await session.refresh()
    expect(record.catalogs).toEqual([['glm-5', 'qwen3'], ['glm-5', 'qwen3']])
  })

  it('never reports an authenticated session for an empty gateway catalog', async () => {
    const record = effects()
    const session = createTFlowSession({
      panelUrl: PANEL,
      effects: record,
      fetch: routed([...successRoutes({ data: [] })]),
      idempotencyKey: () => 'idem',
    })
    await session.start({ email: 'a@b.c', password: 'p', captchaProof: 'c' })
    await expect(session.selectGroup('7')).resolves.toMatchObject({ kind: 'failed', message: expect.stringMatching(/未返回可用模型/u) })
    expect(record.saved).toEqual([])
  })

  it('refuses to authenticate when the account has no usable group', async () => {
    const session = createTFlowSession({
      panelUrl: PANEL,
      effects: effects(),
      fetch: routed([
        ['/api/v1/settings/public', panel(SETTINGS)],
        ['/api/v1/auth/login', panel({ access_token: 'access' })],
        ['/api/v1/groups/available', panel([])],
      ]),
    })
    await expect(session.start({ email: 'a@b.c', password: 'p', captchaProof: 'c' }))
      .resolves.toMatchObject({ kind: 'failed', message: expect.stringMatching(/没有可用的模型分组/u) })
  })

  it('asks for the second factor and then offers the groups', async () => {
    const session = createTFlowSession({
      panelUrl: PANEL,
      effects: effects(),
      fetch: routed([
        ['/api/v1/settings/public', panel(SETTINGS)],
        ['/api/v1/auth/login/2fa', panel({ access_token: 'access' })],
        ['/api/v1/auth/login', panel({ requires_2fa: true, temp_token: 'temp', user_email_masked: 'a***@b.c' })],
        ['/api/v1/groups/available', SIGNED_IN_GROUPS],
      ]),
    })
    await expect(session.start({ email: 'a@b.c', password: 'p', captchaProof: 'c' }))
      .resolves.toEqual({ kind: 'totp-required', maskedEmail: 'a***@b.c' })
    await expect(session.complete('123456')).resolves.toMatchObject({ kind: 'group-required' })
  })

  it('reports a challenge without a masked address', async () => {
    const session = createTFlowSession({
      panelUrl: PANEL,
      effects: effects(),
      fetch: routed([
        ['/api/v1/settings/public', panel(SETTINGS)],
        ['/api/v1/auth/login', panel({ requires_2fa: true, temp_token: 'temp' })],
      ]),
    })
    await expect(session.start({ email: 'a@b.c', password: 'p', captchaProof: 'c' })).resolves.toEqual({ kind: 'totp-required' })
  })

  it('refuses a second factor with no challenge outstanding', async () => {
    const session = createTFlowSession({ panelUrl: PANEL, effects: effects() })
    await expect(session.complete('123456')).resolves.toMatchObject({ kind: 'failed', retryable: true })
  })

  it('reports a failed second factor', async () => {
    const session = createTFlowSession({
      panelUrl: PANEL,
      effects: effects(),
      fetch: routed([
        ['/api/v1/settings/public', panel(SETTINGS)],
        ['/api/v1/auth/login/2fa', new Response(JSON.stringify({ code: 4001, message: '验证码错误' }), { status: 200 })],
        ['/api/v1/auth/login', panel({ requires_2fa: true, temp_token: 'temp' })],
      ]),
    })
    await session.start({ email: 'a@b.c', password: 'p', captchaProof: 'c' })
    await expect(session.complete('000000')).resolves.toMatchObject({ kind: 'failed', message: '验证码错误', retryable: true })
  })

  it('reports a second factor that leads to no usable group', async () => {
    const session = createTFlowSession({
      panelUrl: PANEL,
      effects: effects(),
      fetch: routed([
        ['/api/v1/settings/public', panel(SETTINGS)],
        ['/api/v1/auth/login/2fa', panel({ access_token: 'access' })],
        ['/api/v1/auth/login', panel({ requires_2fa: true, temp_token: 'temp' })],
        ['/api/v1/groups/available', panel([])],
      ]),
    })
    await session.start({ email: 'a@b.c', password: 'p', captchaProof: 'c' })
    await expect(session.complete('123456')).resolves.toMatchObject({ kind: 'failed', message: expect.stringMatching(/没有可用的模型分组/u) })
  })

  it('refuses a group selection when no sign-in is outstanding', async () => {
    const session = createTFlowSession({ panelUrl: PANEL, effects: effects() })
    await expect(session.selectGroup('7')).resolves.toMatchObject({ kind: 'failed', retryable: true })
  })

  it('refuses a group selection after a second-factor challenge', async () => {
    const session = createTFlowSession({
      panelUrl: PANEL,
      effects: effects(),
      fetch: routed([
        ['/api/v1/settings/public', panel(SETTINGS)],
        ['/api/v1/auth/login', panel({ requires_2fa: true, temp_token: 'temp' })],
      ]),
    })
    await session.start({ email: 'a@b.c', password: 'p', captchaProof: 'c' })
    await expect(session.selectGroup('7')).resolves.toMatchObject({ kind: 'failed', retryable: true })
  })

  it('reports a provisioning failure while keeping the flow retryable', async () => {
    const session = createTFlowSession({
      panelUrl: PANEL,
      effects: effects(),
      fetch: routed([
        ['/api/v1/settings/public', panel(SETTINGS)],
        ['/api/v1/auth/login', panel({ access_token: 'access' })],
        ['/api/v1/groups/available', SIGNED_IN_GROUPS],
        ['/api/v1/keys', panel({ items: [] })],
      ]),
      idempotencyKey: () => 'idem',
    })
    await session.start({ email: 'a@b.c', password: 'p', captchaProof: 'c' })
    // The create falls through to the unrouted transport, which rejects.
    await expect(session.selectGroup('7')).resolves.toMatchObject({ kind: 'failed', retryable: true })
  })

  it('classifies a refused credential as retryable and a suspended account as not', async () => {
    const refused = createTFlowSession({
      panelUrl: PANEL,
      effects: effects(),
      fetch: routed([
        ['/api/v1/settings/public', panel(SETTINGS)],
        ['/api/v1/auth/login', new Response(JSON.stringify({ code: 401, message: '邮箱或密码错误' }), { status: 401 })],
      ]),
    })
    await expect(refused.start({ email: 'a@b.c', password: 'p', captchaProof: 'c' }))
      .resolves.toMatchObject({ kind: 'failed', retryable: true })

    const suspended = createTFlowSession({
      panelUrl: PANEL,
      effects: effects(),
      fetch: routed([
        ['/api/v1/settings/public', panel(SETTINGS)],
        ['/api/v1/auth/login', new Response(JSON.stringify({ code: 403, message: '账号已停用', reason: 'suspended' }), { status: 403 })],
      ]),
    })
    await expect(suspended.start({ email: 'a@b.c', password: 'p', captchaProof: 'c' }))
      .resolves.toMatchObject({ kind: 'failed', retryable: false, reason: 'suspended' })
  })

  it('reports a non-protocol failure with its own message', async () => {
    const session = createTFlowSession({
      panelUrl: PANEL,
      effects: effects(),
      fetch: () => Promise.reject(new Error('boom')),
    })
    await expect(session.start({ email: 'a@b.c', password: 'p', captchaProof: 'c' }))
      .resolves.toMatchObject({ kind: 'failed', message: expect.stringMatching(/无法连接/u) })
  })

  it('names a failure that is not an Error', async () => {
    const session = createTFlowSession({
      panelUrl: PANEL,
      effects: effects(),
      fetch: () => Promise.reject('nope'),
    })
    await expect(session.start({ email: 'a@b.c', password: 'p', captchaProof: 'c' }))
      .resolves.toMatchObject({ kind: 'failed', message: expect.stringMatching(/无法连接/u) })
  })
})

describe('restore', () => {
  const stored: TFlowCredentials = {
    session: { accessToken: 'old-access', refreshToken: 'old-refresh' },
    panelUrl: PANEL,
    gatewayUrl: 'https://tflow.online/v1',
    modelKey: 'sk-model',
  }

  it('refreshes the stored grant and re-applies the refreshed session', async () => {
    const record = effects()
    const session = createTFlowSession({
      panelUrl: PANEL,
      effects: record,
      fetch: routed([['/api/v1/auth/refresh', panel({ access_token: 'new-access', refresh_token: 'new-refresh' })]]),
    })
    await expect(session.restore(stored)).resolves.toEqual({
      kind: 'authenticated',
      credentials: { ...stored, session: { accessToken: 'new-access', refreshToken: 'new-refresh' } },
    })
    expect(record.saved[0]?.session.accessToken).toBe('new-access')
    expect(record.applied).toHaveLength(1)
  })

  it('signs out a stored record that carries no refresh grant', async () => {
    const record = effects()
    const session = createTFlowSession({ panelUrl: PANEL, effects: record, fetch: routed([]) })
    await expect(session.restore({ ...stored, session: { accessToken: 'access' } })).resolves.toEqual({ kind: 'signed-out' })
    expect(record.cleared).toBe(1)
    expect(record.revoked).toBe(1)
  })

  it('signs out and stops serving when the panel refuses the grant', async () => {
    const record = effects()
    const session = createTFlowSession({
      panelUrl: PANEL,
      effects: record,
      fetch: routed([['/api/v1/auth/refresh', new Response(JSON.stringify({ code: 401, message: '登录已失效' }), { status: 401 })]]),
    })
    await expect(session.restore(stored)).resolves.toMatchObject({ kind: 'failed', retryable: true })
    expect(record.cleared).toBe(1)
    expect(record.revoked).toBe(1)
  })

  it('keeps the session when the panel is merely unreachable', async () => {
    const record = effects()
    const session = createTFlowSession({
      panelUrl: PANEL,
      effects: record,
      fetch: routed([['/api/v1/auth/refresh', () => { throw new Error('offline') }]]),
    })
    await expect(session.restore(stored)).resolves.toMatchObject({ kind: 'failed', retryable: true })
    expect(record.cleared).toBe(0)
  })
})

describe('refresh', () => {
  const signedIn: TFlowCredentials = {
    session: { accessToken: 'access', refreshToken: 'refresh' },
    panelUrl: PANEL,
    gatewayUrl: 'https://tflow.online/v1',
    modelKey: 'sk-model',
  }

  it('does nothing before a session exists', async () => {
    const session = createTFlowSession({ panelUrl: PANEL, effects: effects() })
    await expect(session.refresh()).resolves.toEqual({ kind: 'signed-out' })
  })

  it('does nothing when the session carries no refresh grant', async () => {
    const session = createTFlowSession({
      panelUrl: PANEL,
      effects: effects(),
      fetch: routed([['/api/v1/auth/refresh', panel({ access_token: 'next' })]]),
    })
    await session.restore({ ...signedIn, session: { accessToken: 'access' } })
    await expect(session.refresh()).resolves.toEqual({ kind: 'signed-out' })
  })

  it('republishes the refreshed credentials', async () => {
    const record = effects()
    const session = createTFlowSession({
      panelUrl: PANEL,
      effects: record,
      fetch: routed([['/api/v1/auth/refresh', panel({ access_token: 'next-access', refresh_token: 'next-refresh' })]]),
    })
    await session.restore(signedIn)
    await expect(session.refresh()).resolves.toMatchObject({
      credentials: { session: { accessToken: 'next-access', refreshToken: 'next-refresh' } },
    })
    expect(record.saved).toHaveLength(2)
  })

  it('keeps the stored refresh grant when the panel rotates only the access token', async () => {
    const session = createTFlowSession({
      panelUrl: PANEL,
      effects: effects(),
      fetch: routed([['/api/v1/auth/refresh', panel({ access_token: 'next-access' })]]),
    })
    await session.restore(signedIn)
    await expect(session.refresh()).resolves.toMatchObject({
      credentials: { session: { accessToken: 'next-access', refreshToken: 'refresh' } },
    })
  })

  it('reports an unreachable panel without clearing the session', async () => {
    const record = effects()
    const session = createTFlowSession({
      panelUrl: PANEL,
      effects: record,
      fetch: () => Promise.reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' })),
    })
    const restored = await session.restore(signedIn)
    expect(restored).toMatchObject({ kind: 'failed' })
    expect(record.cleared).toBe(0)
  })
})

describe('abandon', () => {
  const signedIn: TFlowCredentials = {
    session: { accessToken: 'access', refreshToken: 'refresh' },
    panelUrl: PANEL,
    gatewayUrl: 'https://tflow.online/v1',
    modelKey: 'sk-model',
  }

  it('reports a sign-out when no attempt or session exists', async () => {
    const session = createTFlowSession({ panelUrl: PANEL, effects: effects() })
    await expect(session.abandon()).resolves.toEqual({ kind: 'signed-out' })
  })

  it('returns to the session a second sign-in displaced, without clearing it', async () => {
    const record = effects()
    const session = createTFlowSession({
      panelUrl: PANEL,
      effects: record,
      fetch: routed([
        ['/api/v1/auth/refresh', panel({ access_token: 'next', refresh_token: 'next-refresh' })],
        ['/api/v1/settings/public', panel(SETTINGS)],
        ['/api/v1/auth/login', panel({ requires_2fa: true, temp_token: 'temp' })],
      ]),
    })
    await session.restore(signedIn)
    await session.start({ email: 'a@b.c', password: 'p', captchaProof: 'c' })
    await expect(session.abandon()).resolves.toEqual({
      kind: 'authenticated',
      credentials: { ...signedIn, session: { accessToken: 'next', refreshToken: 'next-refresh' } },
    })
    expect(record.cleared).toBe(0)
  })

  it('retires the displaced session once a new one is provisioned', async () => {
    const session = createTFlowSession({
      panelUrl: PANEL,
      effects: effects(),
      fetch: routed([
        ['/api/v1/auth/refresh', panel({ access_token: 'next', refresh_token: 'next-refresh' })],
        ...successRoutes(),
      ]),
      idempotencyKey: () => 'idem',
    })
    await session.restore(signedIn)
    await session.start({ email: 'a@b.c', password: 'p', captchaProof: 'c' })
    await session.selectGroup('7')
    await expect(session.abandon()).resolves.toEqual({ kind: 'signed-out' })
  })
})

describe('signOut', () => {
  it('clears the record, stops the provider, and reports a sign-out', async () => {
    const record = effects()
    const session = createTFlowSession({ panelUrl: PANEL, effects: record, fetch: routed(successRoutes()), idempotencyKey: () => 'idem' })
    await session.start({ email: 'a@b.c', password: 'p', captchaProof: 'c' })
    await session.selectGroup('7')
    await expect(session.signOut()).resolves.toEqual({ kind: 'signed-out' })
    expect(record.cleared).toBe(1)
    expect(record.revoked).toBe(1)
    expect(session.state()).toEqual({ kind: 'signed-out' })
  })

  it('leaves a later group selection unusable', async () => {
    const session = createTFlowSession({ panelUrl: PANEL, effects: effects(), fetch: routed(successRoutes()), idempotencyKey: () => 'idem' })
    await session.start({ email: 'a@b.c', password: 'p', captchaProof: 'c' })
    await session.signOut()
    await expect(session.selectGroup('7')).resolves.toMatchObject({ kind: 'failed', retryable: true })
  })
})

describe('idempotency keys', () => {
  it('mints a key for each provisioning create request by default', async () => {
    const keys: string[] = []
    const fetchImpl = routed([
      ['/api/v1/settings/public', panel(SETTINGS)],
      ['/api/v1/auth/login', panel({ access_token: 'access', refresh_token: 'refresh' })],
      ['/api/v1/groups/available', SIGNED_IN_GROUPS],
      ['/api/v1/keys?', panel({ items: [] })],
      ['/api/v1/keys', panel({ key: 'sk-new', group_id: 7 })],
      ['/v1/models', gateway({ data: [{ id: 'glm-5' }] })],
    ])
    const session = createTFlowSession({
      panelUrl: PANEL,
      effects: effects(),
      fetch: (url, init) => {
        const headers = init?.headers as Record<string, string> | undefined
        const minted = headers?.['Idempotency-Key']
        if (minted !== undefined) keys.push(minted)
        return fetchImpl(url, init)
      },
    })
    await session.start({ email: 'a@b.c', password: 'p', captchaProof: 'c' })
    await expect(session.selectGroup('7')).resolves.toMatchObject({ kind: 'authenticated' })
    expect(keys).toHaveLength(1)
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/u)
  })
})
