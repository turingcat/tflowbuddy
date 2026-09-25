import { describe, expect, it } from 'vitest'
import { createTFlowLoginBackend, type TFlowLoginBackendOptions } from '../src/tflow/login-backend.ts'
import { loginView } from '../src/tflow/login-api.ts'
import type { TFlowCredentialLoad, TFlowCredentialStore, TFlowCredentials } from '../src/tflow/credentials.ts'
import type { TFlowFetch } from '../src/tflow/protocol.ts'
import type { TFlowAuthState } from '../src/tflow/session.ts'

const PANEL = 'https://tflow.online'
const SETTINGS = {
  aliyun_captcha_enabled: true,
  aliyun_captcha_scene_id: 'scene',
  aliyun_captcha_prefix: 'prefix',
  aliyun_captcha_region: 'cn',
  api_base_url: 'https://tflow.online',
}

const CREDENTIALS: TFlowCredentials = {
  session: { accessToken: 'access', refreshToken: 'refresh' },
  panelUrl: PANEL,
  gatewayUrl: 'https://tflow.online/v1',
  modelKey: 'sk-model',
  groupId: '7',
}

/** Panel envelope. */
function panel(data: unknown): Response {
  return new Response(JSON.stringify({ code: 0, data }), { status: 200 })
}

/** Gateway body. */
function gateway(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status })
}

/** A routed transport that answers with a fresh response each time. */
function routed(routes: Array<[string, Response | (() => Response)]>): TFlowFetch {
  return (url: string) => {
    for (const [fragment, response] of routes) {
      if (!url.includes(fragment)) continue
      if (typeof response === 'function') return Promise.resolve(response())
      return response.clone().text().then(text => new Response(text, { status: response.status, headers: response.headers }))
    }
    return Promise.reject(new Error(`unrouted request: ${url}`))
  }
}

/** A credential store over one in-memory record. */
function store(initial: TFlowCredentialLoad = { kind: 'absent' }): TFlowCredentialStore & { current: TFlowCredentialLoad; clears: number } {
  const state = {
    current: initial,
    clears: 0,
    load: () => Promise.resolve(state.current),
    save: (credentials: TFlowCredentials) => { state.current = { kind: 'stored', credentials }; return Promise.resolve() },
    clear: () => { state.clears++; state.current = { kind: 'absent' }; return Promise.resolve() },
  }
  return state
}

/** Recording provider route. */
function route(): {
  applied: TFlowCredentials[]
  catalogs: Array<readonly string[]>
  revoked: number
  apply: TFlowLoginBackendOptions['route']['apply']
  revoke: () => Promise<void>
} {
  const state = {
    applied: [] as TFlowCredentials[],
    catalogs: [] as Array<readonly string[]>,
    revoked: 0,
    apply: (credentials: TFlowCredentials, modelIds: readonly string[]) => {
      state.applied.push(credentials)
      state.catalogs.push(modelIds)
      return Promise.resolve()
    },
    revoke: () => { state.revoked++; return Promise.resolve() },
  }
  return state
}

/** Routes a full successful sign-in walks. */
function signInRoutes(models: unknown = { data: [{ id: 'glm-5' }] }): Array<[string, Response | (() => Response)]> {
  return [
    ['/api/v1/settings/public', () => panel(SETTINGS)],
    ['/api/v1/auth/login', () => panel({ access_token: 'access', refresh_token: 'refresh' })],
    ['/api/v1/groups/available', () => panel([{ id: 7, name: '默认分组' }])],
    ['/api/v1/keys?', () => panel({ items: [{ name: 'TFlowBuddy', status: 'active', key: 'sk-model', group_id: 7 }] })],
    ['/v1/models', () => gateway(models)],
  ]
}

/** Build one backend over fresh collaborators. */
function backend(overrides: Partial<TFlowLoginBackendOptions> = {}): {
  backend: ReturnType<typeof createTFlowLoginBackend>
  credentials: ReturnType<typeof store>
  route: ReturnType<typeof route>
} {
  const credentials = store()
  const providerRoute = route()
  return {
    backend: createTFlowLoginBackend({
      panelUrl: PANEL,
      credentials,
      route: providerRoute,
      fetch: routed(signInRoutes()),
      idempotencyKey: () => 'idem',
      ...overrides,
    }),
    credentials,
    route: providerRoute,
  }
}

describe('loginView', () => {
  it('projects every orchestrator state onto a credential-free view', () => {
    expect(loginView({ kind: 'signed-out' })).toEqual({ kind: 'signed-out' })
    expect(loginView({ kind: 'totp-required', maskedEmail: 'a***@b.c' })).toEqual({ kind: 'totp', maskedEmail: 'a***@b.c' })
    expect(loginView({ kind: 'totp-required' })).toEqual({ kind: 'totp' })
    expect(loginView({ kind: 'group-required', groups: [{ id: '7', name: '默认分组' }] }))
      .toEqual({ kind: 'group', groups: [{ id: '7', name: '默认分组' }] })
    expect(loginView({ kind: 'authenticated', credentials: CREDENTIALS })).toEqual({ kind: 'authenticated' })
    expect(loginView({ kind: 'failed', message: '失败', retryable: false })).toEqual({ kind: 'failure', message: '失败', retryable: false })
  })

  it('carries no credential field on any branch', () => {
    const states: TFlowAuthState[] = [
      { kind: 'signed-out' },
      { kind: 'totp-required' },
      { kind: 'group-required', groups: [] },
      { kind: 'authenticated', credentials: CREDENTIALS },
      { kind: 'failed', message: 'x', retryable: true },
    ]
    for (const state of states) {
      expect(JSON.stringify(loginView(state))).not.toMatch(/sk-model|access-token|refresh/u)
    }
  })
})

describe('bootstrap', () => {
  it('reports a signed-out flow with the captcha facts the form needs', async () => {
    const context = backend()
    await expect(context.backend.bootstrap()).resolves.toEqual({
      state: { kind: 'signed-out' },
      settings: { captchaEnabled: true, captchaSceneId: 'scene', captchaPrefix: 'prefix', captchaRegion: 'cn' },
    })
  })

  it('loads the panel settings only once', async () => {
    let requests = 0
    const fetchImpl: TFlowFetch = (url) => {
      if (url.includes('/settings/public')) { requests++; return Promise.resolve(panel(SETTINGS)) }
      return Promise.reject(new Error('unexpected'))
    }
    const context = backend({ fetch: fetchImpl })
    await context.backend.bootstrap()
    await context.backend.bootstrap()
    expect(requests).toBe(1)
  })

  it('leaves the captcha facts absent when the panel cannot be reached yet', async () => {
    const context = backend({ fetch: () => Promise.reject(new Error('offline')) })
    await expect(context.backend.bootstrap()).resolves.toEqual({ state: { kind: 'signed-out' } })
  })

  it('adopts a stored record and reports the refreshed session', async () => {
    const fetchImpl = routed([
      ['/api/v1/settings/public', () => panel(SETTINGS)],
      ['/api/v1/auth/refresh', () => panel({ access_token: 'next', refresh_token: 'next-refresh' })],
      ['/v1/models', () => gateway({ data: [{ id: 'glm-5' }] })],
    ])
    const credentials = store({ kind: 'stored', credentials: CREDENTIALS })
    const providerRoute = route()
    const driver = createTFlowLoginBackend({ panelUrl: PANEL, credentials, route: providerRoute, fetch: fetchImpl })
    await expect(driver.bootstrap()).resolves.toMatchObject({ state: { kind: 'authenticated' } })
    expect(credentials.current).toMatchObject({ kind: 'stored', credentials: { session: { accessToken: 'next' } } })
  })

  it('removes an unusable record so the next launch asks for a sign-in', async () => {
    const credentials = store({ kind: 'unusable', reason: 'the stored record is not valid JSON' })
    const providerRoute = route()
    const driver = createTFlowLoginBackend({
      panelUrl: PANEL,
      credentials,
      route: providerRoute,
      fetch: routed([['/api/v1/settings/public', () => panel(SETTINGS)]]),
    })
    await expect(driver.bootstrap()).resolves.toMatchObject({ state: { kind: 'signed-out' } })
    expect(credentials.current).toEqual({ kind: 'absent' })
    expect(providerRoute.revoked).toBe(1)
  })
})

describe('start', () => {
  it('automatically applies a remembered group after a fresh sign-in', async () => {
    const remembered = { load: async () => '7', save: async () => {} }
    const context = backend({ groupPreference: remembered })
    await context.backend.bootstrap()
    await expect(context.backend.start({ email: 'a@b.c', password: 'p', captchaProof: 'c' })).resolves.toEqual({ kind: 'authenticated' })
    expect(context.route.applied).toHaveLength(1)
  })

  it('walks a successful sign-in through the group step', async () => {
    const context = backend()
    await context.backend.bootstrap()
    await expect(context.backend.start({ email: 'a@b.c', password: 'p', captchaProof: 'c' }))
      .resolves.toEqual({ kind: 'group', groups: [{ id: '7', name: '默认分组' }] })
    await expect(context.backend.selectGroup('7')).resolves.toEqual({ kind: 'authenticated' })
    expect(context.route.applied).toHaveLength(1)
  })

  it('notifies subscribers of every view', async () => {
    const context = backend()
    const seen: string[] = []
    const stop = context.backend.subscribe((view) => { seen.push(view.kind) })
    await context.backend.start({ email: 'a@b.c', password: 'p', captchaProof: 'c' })
    stop()
    await context.backend.selectGroup('7')
    expect(seen).toEqual(['group'])
  })

  it('reports the second factor and its masked address', async () => {
    const context = backend({
      fetch: routed([
        ['/api/v1/settings/public', () => panel(SETTINGS)],
        ['/api/v1/auth/login', () => panel({ requires_2fa: true, temp_token: 'temp', user_email_masked: 'a***@b.c' })],
      ]),
    })
    await expect(context.backend.start({ email: 'a@b.c', password: 'p', captchaProof: 'c' }))
      .resolves.toEqual({ kind: 'totp', maskedEmail: 'a***@b.c' })
  })

  it('reports a classified failure as a retryable view', async () => {
    const context = backend({
      fetch: routed([
        ['/api/v1/settings/public', () => panel(SETTINGS)],
        ['/api/v1/auth/login', () => new Response(JSON.stringify({ code: 401, message: '邮箱或密码错误' }), { status: 401 })],
      ]),
    })
    await expect(context.backend.start({ email: 'a@b.c', password: 'p', captchaProof: 'c' }))
      .resolves.toEqual({ kind: 'failure', message: '邮箱或密码错误', retryable: true })
  })

  it.each([
    ['a non-string address', { email: 7, password: 'p', captchaProof: '' }, /邮箱/u],
    ['a blank address', { email: '  ', password: 'p', captchaProof: '' }, /邮箱/u],
    ['a blank password', { email: 'a@b.c', password: '   ', captchaProof: '' }, /密码/u],
    ['a non-string password', { email: 'a@b.c', password: null, captchaProof: '' }, /密码/u],
    ['an overlong address', { email: `${'a'.repeat(600)}@b.c`, password: 'p', captchaProof: '' }, /过长/u],
    ['a non-string captcha proof', { email: 'a@b.c', password: 'p', captchaProof: 5 }, /验证码凭证/u],
    ['an overlong captcha proof', { email: 'a@b.c', password: 'p', captchaProof: 'c'.repeat(8193) }, /验证码凭证 过长/u],
  ])('refuses %s before reaching the panel', async (_label, input, expected) => {
    const context = backend({ fetch: () => Promise.reject(new Error('the panel must not be reached')) })
    await expect(context.backend.start(input as never)).rejects.toThrow(expected)
  })

  it('forwards an Aliyun slider proof longer than the other fields allow', async () => {
    // Aliyun popup proofs run past 512 characters; refusing them made every slider sign-in fail locally.
    const proof = 'c'.repeat(3000)
    const bodies: string[] = []
    const forward = routed(signInRoutes())
    const context = backend({
      fetch: (url, init) => {
        if (url.includes('/api/v1/auth/login') && typeof init?.body === 'string') bodies.push(init.body)
        return forward(url, init)
      },
    })
    await context.backend.bootstrap()
    await expect(context.backend.start({ email: 'a@b.c', password: 'p', captchaProof: proof }))
      .resolves.toMatchObject({ kind: 'group' })
    expect(JSON.parse(bodies[0]!)).toMatchObject({ turnstile_token: proof })
  })

  it('accepts an absent captcha proof', async () => {
    const context = backend()
    await context.backend.bootstrap()
    await expect(context.backend.start({ email: 'a@b.c', password: 'p', captchaProof: '' }))
      .resolves.toMatchObject({ kind: 'group' })
  })
})

describe('complete', () => {
  it('exchanges a code for the group step', async () => {
    const context = backend({
      fetch: routed([
        ['/api/v1/settings/public', () => panel(SETTINGS)],
        ['/api/v1/auth/login/2fa', () => panel({ access_token: 'access', refresh_token: 'refresh' })],
        ['/api/v1/auth/login', () => panel({ requires_2fa: true, temp_token: 'temp' })],
        ['/api/v1/groups/available', () => panel([{ id: 7, name: '默认分组' }])],
      ]),
    })
    await context.backend.start({ email: 'a@b.c', password: 'p', captchaProof: 'c' })
    await expect(context.backend.complete('123456')).resolves.toMatchObject({ kind: 'group' })
  })

  it.each([
    ['a blank code', '   ', /验证码/u],
    ['a non-string code', 7, /验证码/u],
  ])('refuses %s before reaching the panel', async (_label, code, expected) => {
    const context = backend()
    await expect(context.backend.complete(code as never)).rejects.toThrow(expected)
  })
})

describe('selectGroup', () => {
  it('refuses a blank selection', async () => {
    const context = backend()
    await expect(context.backend.selectGroup('  ')).rejects.toThrow(/分组/u)
  })

  it('refuses a non-string selection', async () => {
    const context = backend()
    await expect(context.backend.selectGroup(7 as never)).rejects.toThrow(/分组/u)
  })
})

describe('cancel', () => {
  it('returns to the stored session without clearing credentials', async () => {
    const fetchImpl = routed([
      ['/api/v1/settings/public', () => panel(SETTINGS)],
      ['/api/v1/auth/refresh', () => panel({ access_token: 'next', refresh_token: 'next-refresh' })],
      ['/v1/models', () => gateway({ data: [{ id: 'glm-5' }] })],
      ['/api/v1/auth/login', () => panel({ requires_2fa: true, temp_token: 'temp' })],
      ['/api/v1/groups/available', () => panel([{ id: 7, name: '默认分组' }])],
    ])
    const credentials = store({ kind: 'stored', credentials: CREDENTIALS })
    const providerRoute = route()
    const driver = createTFlowLoginBackend({ panelUrl: PANEL, credentials, route: providerRoute, fetch: fetchImpl })
    await driver.bootstrap()
    await driver.start({ email: 'a@b.c', password: 'p', captchaProof: 'c' })
    await expect(driver.cancel()).resolves.toEqual({ kind: 'authenticated' })
    expect(credentials.clears).toBe(0)
    expect(providerRoute.applied).toHaveLength(1)
  })

  it('reports a sign-out when no session was in place', async () => {
    const context = backend()
    await context.backend.start({ email: 'a@b.c', password: 'p', captchaProof: 'c' })
    await expect(context.backend.cancel()).resolves.toEqual({ kind: 'signed-out' })
    expect(context.credentials.clears).toBe(0)
  })
})

describe('account', () => {
  /** Routes a signed-in session plus one entitlement read. */
  function signedInRoutes(entitlement: unknown, account: unknown = { email: 'alice@example.com', balance: 12.34 }) {
    return [
      ['/api/v1/auth/me', () => panel(account)],
      ['/api/v1/subscriptions/progress', () => panel(entitlement)],
      ['/api/v1/settings/public', () => panel(SETTINGS)],
      ['/api/v1/auth/login', () => panel({ access_token: 'access', refresh_token: 'refresh' })],
      ['/api/v1/groups/available', () => panel([{ id: 7, name: '默认分组' }])],
      ['/api/v1/keys?', () => panel({ items: [{ name: 'TFlowBuddy', status: 'active', key: 'sk-model', group_id: 7 }] })],
      ['/v1/models', () => gateway({ data: [{ id: 'glm-5' }] })],
    ] as Array<[string, () => Response]>
  }

  /** Sign one backend in through the group step. */
  async function signedIn(fetchImpl: TFlowFetch) {
    const context = backend({ fetch: fetchImpl })
    await context.backend.bootstrap()
    await context.backend.start({ email: 'a@b.c', password: 'p', captchaProof: 'c' })
    await context.backend.selectGroup('7')
    return context
  }

  it('reports the balance when the selected group has no subscription', async () => {
    const context = await signedIn(routed(signedInRoutes([])))
    await expect(context.backend.account()).resolves.toEqual({ displayName: 'alice', balance: 12.34 })
  })

  it('reports the subscription the selected group is covered by', async () => {
    const context = await signedIn(routed(signedInRoutes([
      { subscription: { group_id: 7 }, progress: { group_name: '订阅套餐', daily: { remaining_usd: 1.5 }, monthly: { remaining_usd: 30 } } },
    ])))
    await expect(context.backend.account()).resolves.toEqual({
      displayName: 'alice',
      balance: 12.34,
      subscription: { groupName: '订阅套餐', remaining: { daily: 1.5, monthly: 30 } },
    })
  })

  it('reports nothing while no session is signed in', async () => {
    const context = backend()
    await expect(context.backend.account()).resolves.toBeUndefined()
  })

  it('surfaces a panel refusal so the caller can offer a retry', async () => {
    const context = await signedIn(routed([
      ['/api/v1/auth/me', () => new Response(JSON.stringify({ code: 401, message: '登录已失效' }), { status: 401 })],
      ...signedInRoutes([]),
    ]))
    await expect(context.backend.account()).rejects.toThrow('登录已失效')
  })

  it('reports the usage of the signed-in session', async () => {
    const context = await signedIn(routed([
      ['/api/v1/usage/dashboard/stats', () => panel({
        today_requests: 4, today_tokens: 1200, today_actual_cost: 0.4,
        total_requests: 90, total_tokens: 56000, total_actual_cost: 9.6,
      })],
      ...signedInRoutes([]),
    ]))
    await expect(context.backend.usage()).resolves.toEqual({
      today: { requests: 4, tokens: 1200, cost: 0.4 },
      total: { requests: 90, tokens: 56000, cost: 9.6 },
    })
  })

  it('reports no usage while no session is signed in', async () => {
    const context = backend()
    await expect(context.backend.usage()).resolves.toBeUndefined()
  })
})

describe('signOut', () => {
  it('clears the record and stops the provider route', async () => {
    const context = backend()
    await context.backend.bootstrap()
    await context.backend.start({ email: 'a@b.c', password: 'p', captchaProof: 'c' })
    await context.backend.selectGroup('7')
    await expect(context.backend.signOut()).resolves.toEqual({ kind: 'signed-out' })
    expect(context.credentials.current).toEqual({ kind: 'absent' })
    expect(context.route.revoked).toBe(1)
  })
})
