import { expect, it } from 'vitest'
import { macOSDownloadEnvironment, resolveMacOSPackageSettings } from '../scripts/macos-package-settings.mjs'

it('defaults to four workers and keeps download and Apple proxies independent', () => {
  expect(resolveMacOSPackageSettings({})).toEqual({ packConcurrency: 4 })
  expect(resolveMacOSPackageSettings({ DSH_DESKTOP_MACOS_PACK_CONCURRENCY: '2',
    DSH_DESKTOP_MACOS_DOWNLOAD_PROXY: 'https://download.example:8080',
    DSH_DESKTOP_MACOS_NOTARIZATION_PROXY: 'http://apple.example:8081',
  })).toEqual({ packConcurrency: 2, downloadProxy: 'https://download.example:8080', notarizationProxy: 'http://apple.example:8081' })
  expect(resolveMacOSPackageSettings({ DSH_DESKTOP_MACOS_DOWNLOAD_PROXY: ' ', DSH_DESKTOP_MACOS_NOTARIZATION_PROXY: '' })).toEqual({ packConcurrency: 4 })
})

it.each(['', '0', '-1', '1.5', '1e2', 'Infinity', '9007199254740992'])('rejects invalid concurrency %j', (value) => {
  expect(() => resolveMacOSPackageSettings({ DSH_DESKTOP_MACOS_PACK_CONCURRENCY: value })).toThrow('PACK_CONCURRENCY')
})

it.each(['socks5://host:8080', 'http://user:secret@host', 'http://host/path', 'http://host?query', 'http://host#fragment', 'invalid'])
('rejects unsupported proxy input without echoing it: %s', (value) => {
  expect(() => resolveMacOSPackageSettings({ DSH_DESKTOP_MACOS_NOTARIZATION_PROXY: value })).toThrow('NOTARIZATION_PROXY')
  expect(() => resolveMacOSPackageSettings({ DSH_DESKTOP_MACOS_NOTARIZATION_PROXY: value })).not.toThrow(value)
})

it('overrides conflicting child proxy variables while preserving the parent and unrelated settings', () => {
  const parent = { PATH: 'tools', HTTPS_PROXY: 'http://old', http_proxy: 'http://lower', ALL_PROXY: 'socks5://old',
    NO_PROXY: '*', npm_config_proxy: 'http://npm', ELECTRON_GET_USE_PROXY: '0' }
  expect(macOSDownloadEnvironment(parent)).toEqual(parent)
  const child = macOSDownloadEnvironment(parent, 'http://new:8080')
  expect(child).toMatchObject({ PATH: 'tools', HTTP_PROXY: 'http://new:8080', HTTPS_PROXY: 'http://new:8080',
    http_proxy: 'http://new:8080', https_proxy: 'http://new:8080', ELECTRON_GET_USE_PROXY: '1', NO_PROXY: 'localhost,127.0.0.1,::1' })
  expect(child).not.toHaveProperty('ALL_PROXY')
  expect(child).not.toHaveProperty('npm_config_proxy')
  expect(parent.HTTPS_PROXY).toBe('http://old')
  expect(parent.NO_PROXY).toBe('*')
})

it('routes configured mirrors around the download proxy and hands Electron its mirror', () => {
  const parent = {
    DSH_DESKTOP_ELECTRON_MIRROR: 'https://electron.example/binary/',
    DSH_DESKTOP_NODE_MIRROR: 'https://node.example/binary/',
    DSH_DESKTOP_PYTHON_MIRROR: 'https://python.example/releases/',
  }
  const child = macOSDownloadEnvironment(parent, 'http://proxy:8080')
  // A mirror is reachable directly, so the proxy must not carry its transfer.
  expect(child.NO_PROXY).toBe('localhost,127.0.0.1,::1,electron.example,node.example,python.example')
  expect(child.no_proxy).toBe(child.NO_PROXY)
  expect(child.ELECTRON_MIRROR).toBe('https://electron.example/binary/')
})

it('leaves the Electron mirror unset when none is configured', () => {
  const child = macOSDownloadEnvironment({ PATH: 'tools' }, 'http://proxy:8080')
  expect(child).not.toHaveProperty('ELECTRON_MIRROR')
  expect(child.NO_PROXY).toBe('localhost,127.0.0.1,::1')
})

it('ignores a mirror value that is not a URL when building the bypass list', () => {
  const child = macOSDownloadEnvironment({ DSH_DESKTOP_NODE_MIRROR: 'not a url', PATH: 'tools' }, 'http://proxy:8080')
  expect(child.NO_PROXY).toBe('localhost,127.0.0.1,::1')
})
