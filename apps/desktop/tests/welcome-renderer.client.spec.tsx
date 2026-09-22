// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Welcome } from '../src/client/WelcomePage.tsx'
import { resolveWelcomeLocale } from '../src/locale.ts'
import type { TFlowLoginBootstrap, TFlowLoginView } from '../src/tflow/login-api.ts'
import type { TFlowWelcomeApi } from '../src/preload-tflow.ts'

const html = readFileSync(join(import.meta.dirname, '../renderer/welcome.html'), 'utf8')
const messages = resolveWelcomeLocale().messages

/** A panel with the captcha enabled, as tflow.online serves it. */
const SETTINGS = { captchaEnabled: true, captchaSceneId: 'scene', captchaPrefix: 'prefix', captchaRegion: 'cn' }

afterEach(cleanup)

interface Mounted {
  api: TFlowWelcomeApi
  publish: (view: TFlowLoginView) => void
  button: (id: string) => HTMLButtonElement
  field: (id: string) => HTMLInputElement
  type: (id: string, value: string) => void
  visibleCopy: () => string
  enterWorkspace: ReturnType<typeof vi.fn>
}

/**
 * Mount the welcome page over a controllable API.
 * @param boot - state the shell reports at first paint.
 * @returns handles for driving and reading the rendered page.
 */
function mount(boot: TFlowLoginBootstrap = { state: { kind: 'signed-out' }, settings: SETTINGS }): Mounted {
  cleanup()
  let publish: (view: TFlowLoginView) => void = () => {}
  const enterWorkspace = vi.fn(() => Promise.resolve())
  const api: TFlowWelcomeApi = {
    messages,
    bootstrap: vi.fn(() => Promise.resolve(boot)),
    start: vi.fn(() => Promise.resolve<TFlowLoginView>({ kind: 'starting' })),
    complete: vi.fn(() => Promise.resolve<TFlowLoginView>({ kind: 'starting' })),
    selectGroup: vi.fn(() => Promise.resolve<TFlowLoginView>({ kind: 'starting' })),
    signOut: vi.fn(() => Promise.resolve<TFlowLoginView>({ kind: 'signed-out' })),
    cancel: vi.fn(() => Promise.resolve<TFlowLoginView>({ kind: 'signed-out' })),
    enterWorkspace,
    onView: (listener) => { publish = listener; return () => { publish = () => {} } },
  }
  render(<Welcome api={api} />)
  return {
    api,
    publish: (view) => { act(() => { publish(view) }) },
    button: id => document.querySelector<HTMLButtonElement>(id)!,
    field: id => document.querySelector<HTMLInputElement>(id)!,
    type: (id, value) => { fireEvent.change(document.querySelector(id)!, { target: { value } }) },
    visibleCopy: () => [
      document.title,
      document.querySelector('img')!.alt,
      ...[...document.querySelectorAll('h1, p, label')].filter(node => node.closest('[hidden]') === null)
        .map(node => node.textContent),
      ...[...document.querySelectorAll('button')].filter(node => node.closest('[hidden]') === null)
        .map(node => `${node.textContent}${node.disabled ? ' [disabled]' : ''}`),
      '',
    ].join('\n'),
    enterWorkspace,
  }
}

/** Wait for the first bootstrap reply to settle. */
async function settled(): Promise<void> {
  await act(async () => { await Promise.resolve() })
}

describe('desktop welcome presentation', () => {
  it('renders the credential step with the product copy', async () => {
    const view = mount()
    await settled()
    expect(view.visibleCopy()).toMatchFileSnapshot('./expected/welcome/zh-CN-credentials.expected.txt')
  })

  it('renders no credential, key, or panel payload into the document', async () => {
    const view = mount()
    await settled()
    act(() => { view.publish({ kind: 'failure', message: '邮箱或密码错误', retryable: true }) })
    expect(document.body.innerHTML).not.toMatch(/sk-|access_token|refresh_token/u)
  })

  it('blocks submission until the panel settings are known', async () => {
    const view = mount({ state: { kind: 'signed-out' } })
    await settled()
    expect(view.button('#sign-in').disabled).toBe(true)
    expect(document.body.textContent).toContain(messages.welcomeCredentialsConnecting)
  })

  it('requires an address and a password before submitting', async () => {
    const view = mount()
    await settled()
    expect(view.button('#sign-in').disabled).toBe(true)
    view.type('#tflow-email', 'alice@example.com')
    expect(view.button('#sign-in').disabled).toBe(true)
    view.type('#tflow-password', 'secret')
    expect(view.button('#sign-in').disabled).toBe(false)
  })

  it('submits the entered fields once and never submits twice', async () => {
    const view = mount()
    await settled()
    view.type('#tflow-email', '  alice@example.com  ')
    view.type('#tflow-password', 'secret')
    view.type('#tflow-captcha', ' proof ')
    view.api.start = vi.fn(() => new Promise<TFlowLoginView>(() => {}))
    fireEvent.click(view.button('#sign-in'))
    fireEvent.click(view.button('#sign-in'))
    expect(view.api.start).toHaveBeenCalledOnce()
    expect(view.api.start).toHaveBeenCalledWith({ email: 'alice@example.com', password: 'secret', captchaProof: 'proof' })
  })

  it('clears the password and captcha after a settled attempt', async () => {
    const view = mount()
    await settled()
    view.type('#tflow-email', 'alice@example.com')
    view.type('#tflow-password', 'secret')
    view.api.start = vi.fn(() => Promise.resolve<TFlowLoginView>({ kind: 'totp' }))
    await act(async () => { fireEvent.click(view.button('#sign-in')); await Promise.resolve() })
    expect(view.field('#tflow-password').value).toBe('')
    expect(view.field('#tflow-email').value).toBe('alice@example.com')
  })

  it('shows the second-factor step with the masked address and confirms a six-digit code', async () => {
    const view = mount()
    await settled()
    act(() => { view.publish({ kind: 'totp', maskedEmail: 'a***@b.c' }) })
    expect(document.body.textContent).toContain('a***@b.c')
    expect(view.button('#sign-in').textContent).toBe(messages.welcomeConfirm)
    expect(view.button('#sign-in').disabled).toBe(true)
    view.type('#tflow-code', '123456')
    expect(view.button('#sign-in').disabled).toBe(false)
    view.api.complete = vi.fn(() => Promise.resolve<TFlowLoginView>({ kind: 'signed-out' }))
    await act(async () => { fireEvent.click(view.button('#sign-in')); await Promise.resolve() })
    expect(view.api.complete).toHaveBeenCalledWith('123456')
  })

  it('offers every group the shell reported and provisions the chosen one', async () => {
    const view = mount()
    await settled()
    act(() => { view.publish({ kind: 'group', groups: [{ id: '7', name: '默认分组' }, { id: '9', name: '订阅套餐' }] }) })
    const groups = [...document.querySelectorAll<HTMLButtonElement>('.group-list button')]
    expect(groups.map(node => node.textContent)).toEqual(['默认分组', '订阅套餐'])
    view.api.selectGroup = vi.fn(() => Promise.resolve<TFlowLoginView>({ kind: 'authenticated' }))
    await act(async () => { fireEvent.click(groups[1]!); await Promise.resolve() })
    expect(view.api.selectGroup).toHaveBeenCalledWith('9')
  })

  it('asks the shell for the workspace once the flow authenticates', async () => {
    const view = mount()
    await settled()
    act(() => { view.publish({ kind: 'authenticated' }) })
    expect(document.body.textContent).toContain(messages.welcomeOpeningWorkspace)
    expect(view.enterWorkspace).toHaveBeenCalled()
  })

  it('offers a retry only for a recoverable failure and returns to the form', async () => {
    const view = mount()
    await settled()
    act(() => { view.publish({ kind: 'failure', message: '账号已停用', retryable: false }) })
    expect(view.button('#retry').hidden).toBe(true)

    act(() => { view.publish({ kind: 'failure', message: '邮箱或密码错误', retryable: true }) })
    expect(view.button('#retry').hidden).toBe(false)
    act(() => { fireEvent.click(view.button('#retry')) })
    expect(view.button('#retry').hidden).toBe(true)
    expect(document.body.textContent).toContain(messages.welcomeCredentialsTitle)
  })

  it('reports a bridge failure instead of leaving the form silent', async () => {
    const view = mount()
    await settled()
    view.api.start = vi.fn(() => Promise.reject(new Error('bridge gone')))
    await act(async () => {
      view.type('#tflow-email', 'alice@example.com')
      view.type('#tflow-password', 'secret')
      fireEvent.click(view.button('#sign-in'))
      await Promise.resolve()
    })
    expect(document.body.textContent).toContain(messages.welcomeActionFailed)
  })

  it('starts from the credential step when the first read fails', async () => {
    const view = mount()
    view.api.bootstrap = vi.fn(() => Promise.reject(new Error('no host yet')))
    await settled()
    expect(document.body.textContent).toContain(messages.welcomeCredentialsTitle)
  })

  it('keeps shell copy in the dictionaries and denies network access', () => {
    expect(html).toContain("default-src 'none'")
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/u)
  })
})
