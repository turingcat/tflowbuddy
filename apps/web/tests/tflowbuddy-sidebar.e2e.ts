/** Desktop account branding, menu geometry, and provider refresh in the real Web composition. */
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { initialShortcutConfig } from '@deepseek-ai/dsh-client-shortcuts/protocol'
import { applyTFlowRoute, connectHostRpc } from '../../desktop/src/host-rpc.ts'
import { launchWebScaffold, captureStableAria, compareOrRefreshGolden, webSnapshotMode, type WebScaffold } from './scaffold.ts'

describe('TFlowBuddy desktop sidebar', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      extraOverlayPath: [
        fileURLToPath(new URL('./pin-browse-picker.overlay.yml', import.meta.url)),
        fileURLToPath(new URL('../../desktop-host/edition.cordis.patch.yml', import.meta.url)),
      ],
    })
    await scaffold.ctx.settings.update('llm-pi-ai', {
      providers: {
        '9router': { api: 'openai-completions', baseURL: 'http://127.0.0.1:19999/v1', models: [{ id: 'legacy-model' }] },
        tflow: {
          api: 'openai-completions', baseURL: 'https://old.example/v1', models: [{ id: 'retired-model' }],
          defaultMaxTokens: 512,
        },
        independent: { api: 'openai-completions', baseURL: 'https://independent.example/v1', models: [{ id: 'independent-model' }] },
      },
    })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1200, height: 800 }, locale: 'zh-CN' })
    await page.addInitScript((shortcutConfig) => {
      document.addEventListener('DOMContentLoaded', () => { document.documentElement.dataset.platform = 'darwin' }, { once: true })
      Object.assign(window, { dshDesktop: {
        protocolVersion: 1,
        shortcuts: {
          get: async () => shortcutConfig, edit: async () => ({ status: 'saved', snapshot: shortcutConfig }),
          recording: async () => {}, subscribe: () => () => {},
        },
        keyboard: { subscribe: () => () => {}, closeWindow: async () => {} },
      }, dshDesktopAccount: {
        read: async () => ({ displayName: 'alice', balance: 12.34 }),
        usage: async () => ({ today: { requests: 0, tokens: 0, cost: 0 }, total: { requests: 0, tokens: 0, cost: 0 } }),
        signOut: async () => {},
      } })
    }, initialShortcutConfig())
    const invoke = await connectHostRpc(scaffold.authenticatedUrl, async (input, init) => {
      const response = await page.request.fetch(input, {
        method: init?.method ?? 'GET',
        ...typeof init?.body === 'string' ? { data: init.body, headers: { 'content-type': 'application/json' } } : {},
      })
      return new Response(await response.text(), { status: response.status() })
    })
    await applyTFlowRoute(invoke, { gatewayUrl: 'https://tflow.online/v1', modelKey: 'sk-test-only', panelUrl: 'https://tflow.online' }, ['current-model', 'second-model'])
    await page.goto(scaffold.authenticatedUrl)
    await page.getByRole('button', { name: '账号与余额', exact: true }).waitFor()
  })

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('replaces the old gateway routes without deleting independent providers', async () => {
    const catalog = await scaffold.ctx.sessionController.modelCatalog()
    expect(catalog.groups.find(group => group.id === '9router')).toBeUndefined()
    expect(catalog.groups.find(group => group.id === 'tflow')?.models.map(model => model.id)).toEqual(['current-model', 'second-model'])
    expect(catalog.groups.find(group => group.id === 'independent')?.models.map(model => model.id)).toEqual(['independent-model'])
    expect(scaffold.ctx.agentDefaultModel.currentSelection()).toMatchObject({ provider: 'tflow', model: 'current-model' })
  })

  it('renders the robot and heading-sized product name in both themes', async () => {
    const title = page.getByText('TFlowBuddy', { exact: true })
    await title.waitFor()
    for (const dark of [false, true]) {
      await page.evaluate((value) => { document.body.toggleAttribute('data-ds-dark-theme', value) }, dark)
      const result = await title.evaluate((node) => {
        const style = getComputedStyle(node)
        return { fontSize: style.fontSize, fontWeight: style.fontWeight }
      })
      expect(result).toEqual({ fontSize: '20px', fontWeight: '500' })
      const icon = page.locator('img[src^="data:image/webp;base64,"]').first()
      expect((await icon.boundingBox())!.width).toBe(32)
      await expect.poll(() => icon.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true)
    }
    await page.evaluate(() => { document.body.removeAttribute('data-ds-dark-theme') })
  })

  it('fits the account menu to the sidebar launcher and retains only settings and sign-out', async () => {
    const launcher = page.getByRole('button', { name: '账号与余额', exact: true })
    await expect.poll(() => launcher.textContent()).toBe('alice')
    await launcher.click()
    const menu = page.getByRole('menu')
    await menu.waitFor()
    const anchorBox = await launcher.boundingBox()
    const menuBox = await menu.boundingBox()
    expect(menuBox!.width).toBeCloseTo(anchorBox!.width)
    expect(menuBox!.x).toBeGreaterThanOrEqual(12)
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(1188)
    expect(await menu.getByRole('menuitem').allTextContents()).toEqual(['设置', '退出登录'])
    await compareOrRefreshGolden(
      fileURLToPath(new URL('./expected/tflowbuddy-sidebar/account-menu.expected.md', import.meta.url)),
      await captureStableAria(page, '[role="menu"]', scaffold.workspaceCwd), webSnapshotMode(),
    )
    await page.keyboard.press('Escape')
    expect(await menu.count()).toBe(0)
    await launcher.click()
    await page.mouse.click(1100, 700)
    expect(await menu.count()).toBe(0)
  })
})
