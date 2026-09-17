/**
 * @vitest-environment happy-dom
 *
 * What a refused plugin route reports to its caller, and which clipboard
 * mechanism actually performs the copy when the browser offers one.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText, isRecord, jsonRequest } from '../src/client/api.ts'
import type { PluginRequestError } from '../src/client/types.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  delete (document as unknown as Record<string, unknown>)['execCommand']
  // A copy that failed halfway can leave its stand-in textarea behind.
  for (const area of document.body.querySelectorAll('textarea')) area.remove()
})

/** The one request a call makes, so its payload is asserted rather than assumed. */
interface CapturedRequest {
  path: string
  init: RequestInit | undefined
}

function stubFetch(answer: Response): CapturedRequest[] {
  const calls: CapturedRequest[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      calls.push({ path, init })
      return answer
    }),
  )
  return calls
}

/** happy-dom ships no `execCommand`; the fallback is exercised against this stand-in. */
function stubExecCommand(ok: boolean): ReturnType<typeof vi.fn> {
  const execCommand = vi.fn(() => ok)
  Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true, writable: true })
  return execCommand
}

describe('plugin JSON requests', () => {
  it('reads an accepted route without inventing a payload to send', async () => {
    const calls = stubFetch(Response.json({ accessMode: 'loopback' }))

    await expect(jsonRequest('/plugins/avn-grok-build/status')).resolves.toEqual({ accessMode: 'loopback' })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.path).toBe('/plugins/avn-grok-build/status')
    expect(calls[0]?.init?.method).toBe('GET')
    expect(calls[0]?.init?.credentials).toBe('same-origin')
    expect(calls[0]?.init?.body).toBeUndefined()
    expect(new Headers(calls[0]?.init?.headers).has('content-type')).toBe(false)
    expect(new Headers(calls[0]?.init?.headers).get('accept')).toBe('application/json')
  })

  it('sends a JSON body with the content type that describes it', async () => {
    const calls = stubFetch(Response.json({ ok: true }))

    await jsonRequest('/login', 'POST', { provider: 'codex', method: 'device' })

    expect(calls[0]?.init?.method).toBe('POST')
    expect(calls[0]?.init?.body).toBe('{"provider":"codex","method":"device"}')
    expect(new Headers(calls[0]?.init?.headers).get('content-type')).toBe('application/json')
  })

  it("reports the Host's own error text with its status and machine code", async () => {
    stubFetch(Response.json({ error: 'no sign-in is waiting', code: 'no-pending-login' }, { status: 409 }))

    const error = await jsonRequest<never>('/login/code', 'POST', {}).catch(
      (thrown: unknown) => thrown as PluginRequestError,
    )

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('PluginRequestError')
    expect(error.message).toBe('no sign-in is waiting')
    expect(error.status).toBe(409)
    expect(error.code).toBe('no-pending-login')
  })

  it('falls back to the Host message, then to the bare HTTP status line', async () => {
    stubFetch(Response.json({ message: 'try again later' }, { status: 400, statusText: 'Bad Request' }))
    await expect(jsonRequest('/x')).rejects.toThrow('try again later')

    stubFetch(Response.json({ ok: false }, { status: 500, statusText: 'Internal Server Error' }))
    const error = await jsonRequest<never>('/x').catch((thrown: unknown) => thrown as PluginRequestError)

    expect(error.message).toBe('500 Internal Server Error')
    expect(error.status).toBe(500)
    expect(error.code).toBeUndefined()
  })

  it('reads a refusal body it cannot parse as no body at all', async () => {
    stubFetch(new Response('<html>gateway</html>', { status: 502, statusText: 'Bad Gateway' }))

    const error = await jsonRequest<never>('/x').catch((thrown: unknown) => thrown as Error)

    expect(error.message).toBe('502 Bad Gateway')
  })

  it('does not leave a dangling space when the response states no reason', async () => {
    stubFetch(new Response('', { status: 503 }))

    const error = await jsonRequest<never>('/x').catch((thrown: unknown) => thrown as Error)

    expect(error.message).toBe('503')
  })
})

describe('record narrowing', () => {
  it('accepts a plain object and refuses arrays, null, and primitives', () => {
    expect(isRecord({ a: 1 })).toBe(true)
    expect(isRecord([1])).toBe(false)
    expect(isRecord(null)).toBe(false)
    expect(isRecord('plugin')).toBe(false)
  })
})

describe('clipboard copy', () => {
  it('uses the async clipboard when the browser offers one', async () => {
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    await expect(copyText('ABCD-1234')).resolves.toBe(true)

    expect(writeText).toHaveBeenCalledWith('ABCD-1234')
  })

  it('falls back to a hidden textarea when the async clipboard refuses', async () => {
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn(async () => {
          throw new Error('clipboard denied')
        }),
      },
    })
    const execCommand = stubExecCommand(true)

    await expect(copyText('ABCD-1234')).resolves.toBe(true)

    expect(execCommand).toHaveBeenCalledWith('copy')
    // The stand-in textarea is taken back out of the page.
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('falls back when the browser exposes no async clipboard at all', async () => {
    vi.stubGlobal('navigator', {})
    const execCommand = stubExecCommand(false)

    await expect(copyText('ABCD-1234')).resolves.toBe(false)

    expect(execCommand).toHaveBeenCalledOnce()
  })

  it('falls back when there is no navigator to ask', async () => {
    vi.stubGlobal('navigator', undefined)
    const execCommand = stubExecCommand(true)

    await expect(copyText('ABCD-1234')).resolves.toBe(true)

    expect(execCommand).toHaveBeenCalledOnce()
  })

  it('reports a failed copy rather than claiming success', async () => {
    vi.stubGlobal('navigator', {})

    await expect(copyText('ABCD-1234')).resolves.toBe(false)
  })
})
