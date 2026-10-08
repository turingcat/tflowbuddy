/** Web bundle wiring for the vendored dsh-pocket companion. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'

const packageRoot = fileURLToPath(new URL('../../../../vendor/dsh-pocket/', import.meta.url))

it('mounts dsh-pocket after the web transport and declares it as a runtime bundle dependency', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    dependencies?: Record<string, string>
  }
  expect(manifest.dependencies?.['dsh-pocket']).toBe('workspace:~')

  const rows = loadOverlayPatches('dsh-pocket-composition', fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)))
    .flatMap(patch => patch.insert ?? [])
  const connection = rows.findIndex(row => row.id === 'connection')
  const pocket = rows.find(row => row.id === 'dsh-pocket')
  expect(connection).toBeGreaterThanOrEqual(0)
  expect(pocket).toMatchObject({ id: 'dsh-pocket', name: 'dsh-pocket', inject: ['connection', 'webServer'] })
  expect(rows.findIndex(row => row.id === 'dsh-pocket')).toBeGreaterThan(connection)

  const pocketManifest = JSON.parse(readFileSync(`${packageRoot}/package.json`, 'utf8')) as {
    dsh?: { client?: { platform?: string; inject?: string[] } }
    exports?: Record<string, unknown>
  }
  expect(pocketManifest.exports?.['./client']).toBe('./client/client.js')
  expect(pocketManifest.dsh?.client?.platform).toBe('web')
  expect(pocketManifest.dsh?.client?.inject).toContain('@deepseek-ai/dsh-client-connection')
})

it('disables update and restart RPC actions when the Desktop marker is supplied', async () => {
  const { installPocketRpc } = await import(`${packageRoot}/lib/web-rpc.js`) as {
    installPocketRpc: (ctx: object, options: object) => (() => void) | undefined
  }
  const { POCKET_ENDPOINTS } = await import(`${packageRoot}/client/api.js`) as {
    POCKET_ENDPOINTS: { update: string; restart: string }
  }
  const handler = vi.fn<(endpoint: string, payload: object) => Promise<unknown>>()
  const service = { status: vi.fn(async () => ({ dshPort: 3080 })), stopTunnel: vi.fn() }
  const runUpdate = { perform: vi.fn(async () => ({ ok: true })) }
  const restart = vi.fn(() => ({ helperPid: 123 }))
  const ctx = {
    connection: {
      rpc: {
        handle: (_channel: string, fn: typeof handler) => {
          handler.mockImplementation(fn)
          return () => {}
        },
      },
    },
  }
  const dispose = installPocketRpc(ctx, {
    service,
    desktop: true,
    runUpdate,
    restart,
    log: { error: vi.fn() },
  })
  try {
    const update = await handler(POCKET_ENDPOINTS.update, { profile: 'desktop' })
    const reboot = await handler(POCKET_ENDPOINTS.restart, {})
    expect(update).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(reboot).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(runUpdate.perform).not.toHaveBeenCalled()
    expect(restart).not.toHaveBeenCalled()
  } finally {
    dispose?.()
  }
})
