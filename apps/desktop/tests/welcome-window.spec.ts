import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveDesktopLocale, resolveWelcomeLocale } from '../src/locale.ts'
import { TFLOW_IPC } from '../src/tflow/login-api.ts'
import type { TFlowLoginBackend } from '../src/tflow/login-backend.ts'

const electron = vi.hoisted(() => ({
  create: vi.fn<(options: unknown) => ReturnType<typeof createWindow>>(),
  root: '/desktop-app',
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
}))

vi.mock('electron', () => ({
  app: { getAppPath: () => electron.root },
  BrowserWindow: vi.fn(function (this: unknown, options: unknown) { return electron.create(options) }),
  ipcMain: {
    handle: (name: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) => {
      if (electron.handlers.has(name)) throw new Error(`duplicate IPC handler: ${name}`)
      electron.handlers.set(name, handler)
    },
    removeHandler: (name: string) => { electron.handlers.delete(name) },
  },
}))

const { openWelcomeWindow, welcomeWindowOptions } = await import('../src/welcome-window.ts')

function createWindow() {
  return {
    webContents: {
      mainFrame: {},
      send: vi.fn<(channel: string, payload: unknown) => void>(),
      setWindowOpenHandler: vi.fn<(handler: () => { action: string }) => void>(),
      on: vi.fn<(name: string, handler: (event: unknown) => void) => void>(),
    },
    loadFile: vi.fn<(path: string) => Promise<undefined>>().mockResolvedValue(undefined),
    isDestroyed: vi.fn().mockReturnValue(false),
    destroy: vi.fn(),
    show: vi.fn(),
    once: vi.fn<(name: string, callback: () => void) => void>(),
  }
}

/** A minimal sign-in driver: the bridge only forwards to it. */
function backend(overrides: Partial<TFlowLoginBackend> = {}): TFlowLoginBackend {
  return {
    state: () => ({ kind: 'signed-out' }),
    bootstrap: () => Promise.resolve({ state: { kind: 'signed-out' } }),
    start: () => Promise.resolve({ kind: 'signed-out' }),
    complete: () => Promise.resolve({ kind: 'signed-out' }),
    selectGroup: () => Promise.resolve({ kind: 'signed-out' }),
    signOut: () => Promise.resolve({ kind: 'signed-out' }),
    cancel: () => Promise.resolve({ kind: 'signed-out' }),
    account: () => Promise.resolve(undefined),
    subscribe: () => () => {},
    ...overrides,
  }
}

const operations = { enterWorkspace: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) }

beforeEach(() => {
  electron.create.mockReset()
  electron.handlers.clear()
  operations.enterWorkspace.mockClear()
})

describe('welcomeWindowOptions', () => {
  it.each(['darwin', 'win32'] as const)('builds the fixed-size %s window', (platform) => {
    const options = welcomeWindowOptions(platform, resolveDesktopLocale('zh-CN'))
    expect(options.width).toBe(600)
    expect(options.height).toBe(700)
    // The sign-in surface opens in the product's challenge language.
    expect(options.webPreferences?.additionalArguments).toEqual([`--dsh-welcome-locale=${resolveWelcomeLocale().id}`])
    expect(options.webPreferences?.preload).toMatch(/preload-tflow\.cjs$/u)
    expect(options.webPreferences?.contextIsolation).toBe(true)
    expect(options.webPreferences?.sandbox).toBe(true)
  })

  it('keeps the native material per platform', () => {
    const mac = welcomeWindowOptions('darwin', resolveDesktopLocale('zh-CN'))
    expect(mac.vibrancy).toBe('menu')
    expect(mac.visualEffectState).toBe('active')
    expect(mac.trafficLightPosition).toEqual({ x: 21, y: 21 })

    const windows = welcomeWindowOptions('win32', resolveDesktopLocale('zh-CN'))
    expect(windows.backgroundMaterial).toBe('acrylic')
    expect(windows.titleBarOverlay).toMatchObject({ height: 42 })

    const other = welcomeWindowOptions('linux', resolveDesktopLocale('zh-CN'))
    expect(other.backgroundColor).toBe('#FFFFFF')
    expect(other.vibrancy).toBeUndefined()
    expect(other.backgroundMaterial).toBeUndefined()
  })
})

describe('openWelcomeWindow', () => {
  it('installs the sign-in channels, shows the window once loaded, and denies navigation', async () => {
    const window = createWindow()
    const loaded = Promise.withResolvers<undefined>()
    window.loadFile.mockReturnValue(loaded.promise)
    electron.create.mockReturnValue(window)

    const opening = openWelcomeWindow(resolveDesktopLocale('en'), backend(), operations)
    expect(window.show).not.toHaveBeenCalled()
    expect(window.loadFile).toHaveBeenCalledWith(join(electron.root, 'renderer', 'welcome.html'))
    expect(window.webContents.setWindowOpenHandler.mock.calls[0]![0]()).toEqual({ action: 'deny' })
    const event = { preventDefault: vi.fn() }
    window.webContents.on.mock.calls[0]![1](event)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect([...electron.handlers.keys()]).toContain(TFLOW_IPC.start)

    loaded.resolve(undefined)
    expect(await opening).toBe(window)
    expect(window.show).toHaveBeenCalledOnce()
  })

  it('destroys a window whose document fails to load and releases its handlers', async () => {
    const window = createWindow()
    window.loadFile.mockRejectedValue(new Error('missing welcome document'))
    electron.create.mockReturnValue(window)

    await expect(openWelcomeWindow(resolveDesktopLocale('en'), backend(), operations)).rejects.toThrow('missing welcome document')
    expect(window.destroy).toHaveBeenCalledOnce()
    expect(electron.handlers.size).toBe(0)
    expect(window.show).not.toHaveBeenCalled()
  })

  it('does not show a window closed while its document was loading', async () => {
    const window = createWindow()
    window.isDestroyed.mockReturnValue(true)
    electron.create.mockReturnValue(window)

    await openWelcomeWindow(resolveDesktopLocale('en'), backend(), operations)
    expect(window.show).not.toHaveBeenCalled()
    expect(window.destroy).not.toHaveBeenCalled()
  })

  it('accepts flow actions only from its own top frame and removes handlers on close', async () => {
    const window = createWindow()
    electron.create.mockReturnValue(window)
    const start = vi.fn(() => Promise.resolve({ kind: 'signed-out' as const }))
    const driver = backend({ start })

    await openWelcomeWindow(resolveDesktopLocale('en'), driver, operations)
    const own = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
    const foreign = { sender: {}, senderFrame: {} }

    const handler = electron.handlers.get(TFLOW_IPC.start)!
    await expect(handler(foreign, { email: 'a@b.c', password: 'p', captchaProof: '' })).rejects.toThrow('unowned')
    expect(start).not.toHaveBeenCalled()

    const input = { email: 'a@b.c', password: 'p', captchaProof: '' }
    await expect(handler(own, input)).resolves.toEqual({ kind: 'signed-out' })
    expect(start).toHaveBeenCalledWith(input)

    const enter = electron.handlers.get(TFLOW_IPC.enterWorkspace)!
    await expect(enter(own)).resolves.toBeUndefined()
    expect(operations.enterWorkspace).toHaveBeenCalledOnce()

    window.once.mock.calls[0]![1]()
    expect(electron.handlers.size).toBe(0)
  })

  it('forwards every state the driver publishes to the window', async () => {
    const window = createWindow()
    electron.create.mockReturnValue(window)
    let publish: ((view: { kind: string }) => void) | undefined
    const driver = backend({
      subscribe: (listener) => { publish = listener as (view: { kind: string }) => void; return () => { publish = undefined } },
    })

    await openWelcomeWindow(resolveDesktopLocale('en'), driver, operations)
    publish?.({ kind: 'totp' })
    expect(window.webContents.send).toHaveBeenCalledWith(TFLOW_IPC.state, { kind: 'totp' })

    window.once.mock.calls[0]![1]()
    window.webContents.send.mockClear()
    publish?.({ kind: 'group' })
    expect(window.webContents.send).not.toHaveBeenCalled()
  })

  it('hands flow ownership to the newest window', async () => {
    const previous = createWindow()
    const current = createWindow()
    const previousStart = vi.fn(() => Promise.resolve({ kind: 'signed-out' as const }))
    const currentStart = vi.fn(() => Promise.resolve({ kind: 'group' as const, groups: [] }))
    electron.create.mockReturnValueOnce(previous).mockReturnValueOnce(current)

    await openWelcomeWindow(resolveDesktopLocale('en'), backend({ start: previousStart }), operations)
    const previousHandler = electron.handlers.get(TFLOW_IPC.start)!
    await openWelcomeWindow(resolveDesktopLocale('en'), backend({ start: currentStart }), operations)
    const currentHandler = electron.handlers.get(TFLOW_IPC.start)!

    // The first window's registration is gone, so its frame can no longer act.
    expect(currentHandler).not.toBe(previousHandler)
    const previousSender = { sender: previous.webContents, senderFrame: previous.webContents.mainFrame }
    await expect(previousHandler(previousSender)).rejects.toThrow('unowned')
    expect(previousStart).not.toHaveBeenCalled()

    const currentSender = { sender: current.webContents, senderFrame: current.webContents.mainFrame }
    await expect(currentHandler(currentSender, { email: 'a@b.c', password: 'p', captchaProof: '' }))
      .resolves.toEqual({ kind: 'group', groups: [] })
    expect(currentStart).toHaveBeenCalledOnce()
  })
})
