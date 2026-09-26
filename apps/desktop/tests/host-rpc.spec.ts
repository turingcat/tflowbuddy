import { describe, expect, it, vi } from 'vitest'
import {
  applyTFlowRoute,
  connectHostRpc,
  readLocalePreference,
  revokeTFlowRoute,
  type HostInvoke,
} from '../src/host-rpc.ts'

const CREDENTIALS = {
  gatewayUrl: 'https://tflow.online/v1',
  modelKey: 'sk-model',
  panelUrl: 'https://tflow.online',
}

/**
 * A `session/modelCatalog` reply whose TFlow group lists these models.
 * @param models - TFlow group entries.
 * @returns a catalog that also carries an unrelated provider group.
 */
function catalog(models: unknown[]): unknown {
  return {
    groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-chat' }] }, { id: 'tflow', name: 'TFlow', models }],
    failures: [],
  }
}

/** One recorded Host call. */
interface RecordedCall { namespace: string; method: string; args: Record<string, unknown> }

/** The JSON text one request carried; the client always sends a string body. */
function requestBody(init: RequestInit | undefined): string {
  if (typeof init?.body !== 'string') throw new Error('expected a JSON string body')
  return init.body
}

/** Record one call and answer what the named namespace should answer. */
function invoke(answers: Record<string, unknown> = {}): HostInvoke & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  const call = (request: { namespace: string; method: string; args: Record<string, unknown> }): Promise<unknown> => {
    calls.push(request)
    const key = `${request.namespace}/${request.method}`
    if (key in answers) return Promise.resolve(answers[key])
    return Promise.resolve(undefined)
  }
  return Object.assign(call, { calls })
}

describe('applyTFlowRoute', () => {
  it('declares the gateway route, then stores the key, then points the default model at the first model', async () => {
    const host = invoke({ 'session/modelCatalog': catalog([{ id: 'glm-5' }, { id: 'qwen3' }]) })
    await applyTFlowRoute(host, CREDENTIALS, ['glm-5', 'qwen3'])

    const [route, key, directory, selection] = host.calls
    // The Host exposes settings namespaces only through the `settings` Remote; `/api/llm-pi-ai/update` answers 404.
    expect(route).toMatchObject({ namespace: 'settings', method: 'update', args: { ns: 'llm-pi-ai' } })
    expect(route!.args['patch']).toEqual({
      providers: {
        tflow: {
          displayName: 'TFlow',
          api: 'openai-completions',
          baseURL: 'https://tflow.online/v1',
          apiKeyEnv: 'TFLOW_MODEL_KEY',
          models: [{ id: 'glm-5' }, { id: 'qwen3' }],
        },
      },
    })
    expect(key).toMatchObject({ namespace: 'credentials', method: 'set', args: { ref: 'TFLOW_MODEL_KEY', value: 'sk-model' } })
    // The Host exposes no `llm` Remote; `session/modelCatalog` is its model directory.
    expect(directory).toEqual({ namespace: 'session', method: 'modelCatalog', args: {} })
    expect(selection).toMatchObject({
      namespace: 'settings', method: 'update',
      args: { ns: 'agent-default-model', patch: { provider: 'tflow', model: 'glm-5' } },
    })
  })

  it('selects the first model the registered route serves, not the first advertised one', async () => {
    const host = invoke({
      // The adapter may drop a model the gateway advertised; the default must
      // name one the route actually serves.
      'session/modelCatalog': catalog([{ id: 'served-first' }]),
    })
    await applyTFlowRoute(host, CREDENTIALS, ['advertised-first', 'served-first'])
    const selection = host.calls.at(-1)!
    expect(selection.args['patch']).toEqual({ provider: 'tflow', model: 'served-first' })
  })

  it('skips directory entries without a usable identifier', async () => {
    const host = invoke({ 'session/modelCatalog': catalog([{ name: 'no id' }, { id: '' }, { id: 'usable' }]) })
    await applyTFlowRoute(host, CREDENTIALS, ['usable'])
    expect(host.calls.at(-1)!.args['patch']).toEqual({ provider: 'tflow', model: 'usable' })
  })

  it('refuses to leave a default selection behind when the route serves nothing', async () => {
    // The catalog omits provider groups with no models.
    const host = invoke({ 'session/modelCatalog': { groups: [], failures: [] } })
    await expect(applyTFlowRoute(host, CREDENTIALS, [])).rejects.toThrow(/serves no model/u)
    expect(host.calls.some(call => call.args['ns'] === 'agent-default-model')).toBe(false)
  })

  it('reports why the TFlow route could not list its models', async () => {
    const host = invoke({
      'session/modelCatalog': { groups: [], failures: [{ id: 'tflow', name: 'TFlow', message: 'HTTP 401' }] },
    })
    await expect(applyTFlowRoute(host, CREDENTIALS, ['glm-5'])).rejects.toThrow(/TFlow route failed to list models: HTTP 401/u)
    expect(host.calls.some(call => call.args['ns'] === 'agent-default-model')).toBe(false)
  })

  it('refuses a catalog without provider groups', async () => {
    const host = invoke({ 'session/modelCatalog': [] })
    await expect(applyTFlowRoute(host, CREDENTIALS, ['glm-5'])).rejects.toThrow(/invalid model directory/u)
  })

  it('never writes the model key into the settings document', async () => {
    const host = invoke({ 'session/modelCatalog': catalog([{ id: 'glm-5' }]) })
    await applyTFlowRoute(host, CREDENTIALS, ['glm-5'])
    for (const call of host.calls.filter(entry => entry.namespace !== 'credentials')) {
      expect(JSON.stringify(call.args)).not.toContain('sk-model')
    }
  })
})

describe('revokeTFlowRoute', () => {
  it('removes the key and the route before clearing the default selection', async () => {
    const host = invoke()
    await revokeTFlowRoute(host)
    expect(host.calls).toEqual([
      { namespace: 'credentials', method: 'unset', args: { ref: 'TFLOW_MODEL_KEY' } },
      { namespace: 'settings', method: 'mutate', args: { ns: 'llm-pi-ai', ops: [{ op: 'unset', path: ['providers', 'tflow'] }], expectedRevision: undefined } },
      { namespace: 'settings', method: 'update', args: { ns: 'agent-default-model', patch: { provider: '', model: '' }, expectedRevision: undefined } },
    ])
  })
})

describe('readLocalePreference', () => {
  it('returns the stored language preference', async () => {
    const host = invoke({ 'settings/describe': { namespaces: [{ ns: 'locale', value: { preference: 'zh' } }] } })
    await expect(readLocalePreference(host)).resolves.toBe('zh')
  })

  it('reports no preference when the namespace carries none', async () => {
    const host = invoke({ 'settings/describe': { namespaces: [{ ns: 'locale', value: {} }] } })
    await expect(readLocalePreference(host)).resolves.toBeNull()
  })

  it('accepts an explicit null preference', async () => {
    const host = invoke({ 'settings/describe': { namespaces: [{ ns: 'locale', value: { preference: null } }] } })
    await expect(readLocalePreference(host)).resolves.toBeNull()
  })

  it.each([
    ['a missing namespace list', {}, /missing settings namespaces/u],
    ['a missing locale namespace', { namespaces: [] }, /invalid locale preference/u],
    ['a non-object namespace value', { namespaces: [{ ns: 'locale', value: 'zh' }] }, /invalid locale preference/u],
    ['a non-string preference', { namespaces: [{ ns: 'locale', value: { preference: 7 } }] }, /invalid locale preference/u],
  ])('rejects %s', async (_label, described, expected) => {
    const host = invoke({ 'settings/describe': described })
    await expect(readLocalePreference(host)).rejects.toThrow(expected)
  })
})

describe('connectHostRpc', () => {
  /** An authenticated Host stub that echoes the request id, as the real Host does. */
  function transport(craft: (rpcId: string) => unknown, status = 200): (input: string, init?: RequestInit) => Promise<Response> {
    return vi.fn((input: string, init?: RequestInit) => {
      if (!input.includes('/api/')) return Promise.resolve(new Response('index', { status: 200 }))
      const body = JSON.parse(requestBody(init)) as { rpcId: string }
      return Promise.resolve(Response.json(craft(body.rpcId), { status }))
    })
  }

  /** A stub answering every call with one result value. */
  const succeeding = (value: unknown) => transport(rpcId => ({ type: 'server-response', rpcId, result: { ok: true, value } }))

  it('authenticates the entry point before any call', async () => {
    const send = succeeding({ namespaces: [] })
    await expect(connectHostRpc('http://127.0.0.1:3080/?token=t', send)).resolves.toBeTypeOf('function')
    expect(send).toHaveBeenCalledWith('http://127.0.0.1:3080/?token=t', { credentials: 'include' })
  })

  it('refuses a Host that does not answer its own entry point', async () => {
    const send = vi.fn(() => Promise.resolve(new Response('nope', { status: 401 })))
    await expect(connectHostRpc('http://127.0.0.1:3080/?token=t', send)).rejects.toThrow(/authentication failed/u)
  })

  it('posts the documented envelope and returns the result value', async () => {
    const send = succeeding('value')
    const call = await connectHostRpc('http://127.0.0.1:3080/?token=t', send)
    await expect(call({ namespace: 'llm', method: 'listModels', args: { provider: 'tflow' } })).resolves.toBe('value')

    const request = (send as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls.at(-1)!
    expect(request[0]).toBe('http://127.0.0.1:3080/api/llm/listModels')
    expect(request[1]).toMatchObject({ method: 'POST', credentials: 'include', redirect: 'error' })
    expect(JSON.parse(requestBody(request[1]))).toMatchObject({
      type: 'client-request', method: 'llm/listModels', payload: { args: { provider: 'tflow' } },
    })
  })

  it.each([
    ['a failed status', () => ({ type: 'server-response', rpcId: null, result: { ok: true, value: 1 } }), 500, /Web request settings\/describe failed with HTTP 500/u],
    ['a non-envelope body', () => 'plain', 200, /Web RPC failed/u],
    ['a mismatched rpcId', () => ({ type: 'server-response', rpcId: 'other', result: { ok: true, value: 1 } }), 200, /Web RPC failed/u],
    ['a failed result', (rpcId: string) => ({ type: 'server-response', rpcId, result: { ok: false } }), 200, /Web RPC failed/u],
  ])('classifies %s', async (_label, craft, status, expected) => {
    const call = await connectHostRpc('http://127.0.0.1:3080/?token=t', transport(craft, status))
    await expect(call({ namespace: 'settings', method: 'describe', args: {} })).rejects.toThrow(expected)
  })
})
