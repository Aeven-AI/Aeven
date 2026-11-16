import { describe, expect, it, vi } from 'vitest'
import { hostProxyRoutesFor, proxyRoutesFromPacResult } from '../src/system-proxy.ts'

describe('system proxy routes for the Host', () => {
  it('connects directly when the system chooses no proxy', () => {
    expect(proxyRoutesFromPacResult('DIRECT')).toEqual([null])
    expect(proxyRoutesFromPacResult('')).toEqual([null])
    expect(proxyRoutesFromPacResult('  direct  ')).toEqual([null])
  })

  it('maps PROXY and HTTPS entries to http: and https: proxy URLs', () => {
    expect(proxyRoutesFromPacResult('PROXY proxy.corp:8080')).toEqual(['http://proxy.corp:8080'])
    expect(proxyRoutesFromPacResult('HTTPS secure.corp:443')).toEqual(['https://secure.corp'])
    expect(proxyRoutesFromPacResult('proxy 10.1.2.3:3128')).toEqual(['http://10.1.2.3:3128'])
    expect(proxyRoutesFromPacResult('PROXY [2001:db8::5]:8080')).toEqual(['http://[2001:db8::5]:8080'])
    expect(proxyRoutesFromPacResult('PROXY proxy.corp')).toEqual(['http://proxy.corp'])
  })

  it('keeps the usable entries in order and ends the list at DIRECT', () => {
    expect(proxyRoutesFromPacResult('PROXY first:1;PROXY second:2')).toEqual(['http://first:1', 'http://second:2'])
    expect(proxyRoutesFromPacResult('PROXY corp:8080; DIRECT')).toEqual(['http://corp:8080', null])
    expect(proxyRoutesFromPacResult('DIRECT; PROXY never:1')).toEqual([null])
    expect(proxyRoutesFromPacResult('SOCKS5 socks:1080; PROXY fallback:8080; DIRECT')).toEqual(['http://fallback:8080', null])
    expect(proxyRoutesFromPacResult('QUIC quic:443;HTTPS secure:8443')).toEqual(['https://secure:8443'])
    expect(proxyRoutesFromPacResult('PROXY same:1; PROXY same:1; DIRECT')).toEqual(['http://same:1', null])
  })

  it('connects directly when no entry is usable by the Host transport', () => {
    expect(proxyRoutesFromPacResult('SOCKS socks:1080')).toEqual([null])
    expect(proxyRoutesFromPacResult('SOCKS5 socks:1080;SOCKS4 other:1080')).toEqual([null])
    expect(proxyRoutesFromPacResult('PROXY')).toEqual([null])
    expect(proxyRoutesFromPacResult('PROXY a:1 extra')).toEqual([null])
    expect(proxyRoutesFromPacResult('PROXY user:secret@proxy:8080')).toEqual([null])
    expect(proxyRoutesFromPacResult('PROXY proxy:8080/path')).toEqual([null])
    expect(proxyRoutesFromPacResult('PROXY bad host:1')).toEqual([null])
  })

  it('answers with the routes for the asked URL', async () => {
    const resolve = vi.fn(() => Promise.resolve('PROXY proxy.corp:8080; DIRECT'))
    await expect(hostProxyRoutesFor(resolve, 'https://aeven.io/api/v1/chat/completions')).resolves.toEqual(['http://proxy.corp:8080', null])
    expect(resolve).toHaveBeenCalledWith('https://aeven.io/api/v1/chat/completions')
  })

  it('connects directly when Chromium cannot resolve', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      await expect(hostProxyRoutesFor(() => Promise.reject(new Error('session destroyed')), 'https://aeven.io/')).resolves.toEqual([null])
      expect(warn).toHaveBeenCalledOnce()
    } finally {
      warn.mockRestore()
    }
  })
})
