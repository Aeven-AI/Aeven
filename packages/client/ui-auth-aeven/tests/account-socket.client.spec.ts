/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openAccountSocket } from '../src/client/auth/services/account-socket.ts'

/** A socket the test drives: it records what was offered and raises the events a server would. */
class FakeSocket extends EventTarget {
  static opened: FakeSocket[] = []
  readonly closedWith: number[] = []

  constructor(readonly url: string, readonly protocols: string[]) {
    super()
    FakeSocket.opened.push(this)
  }

  /** The handshake succeeded. */
  accept(): void {
    this.dispatchEvent(new Event('open'))
  }

  /**
   * The server sent a frame.
   * @param data - the frame's text.
   */
  receive(data: string): void {
    this.dispatchEvent(new MessageEvent('message', { data }))
  }

  /**
   * The socket closed with a code.
   * @param code - the close code.
   */
  drop(code: number): void {
    this.dispatchEvent(new CloseEvent('close', { code }))
  }

  close(code: number): void {
    this.closedWith.push(code)
  }
}

/** Let the asynchronous token lookup and socket construction run. */
const settle = async (): Promise<void> => { await vi.advanceTimersByTimeAsync(0) }

const scope = globalThis as { __AVN_AEVEN__?: Record<string, string> }

describe('the account socket', () => {
  beforeEach(() => {
    FakeSocket.opened = []
    vi.stubGlobal('WebSocket', FakeSocket)
    vi.useFakeTimers()
    scope.__AVN_AEVEN__ = { apiUrl: 'https://api.test', socketUrl: 'wss://api.test/socket' }
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    delete scope.__AVN_AEVEN__
  })

  const events = () => ({ sessionEnded: vi.fn(), locale: vi.fn() })

  it('opens nothing when the deployment names no socket', async () => {
    scope.__AVN_AEVEN__ = { apiUrl: 'https://api.test' }
    const bearer = vi.fn(async () => 'token-1')

    openAccountSocket(bearer, events())()
    await settle()

    expect(bearer).not.toHaveBeenCalled()
    expect(FakeSocket.opened).toEqual([])
  })

  it('presents the page token as a subprotocol beside the account protocol', async () => {
    openAccountSocket(async () => 'token-1', events())
    await settle()

    expect(FakeSocket.opened).toHaveLength(1)
    expect(FakeSocket.opened[0]?.url).toBe('wss://api.test/socket')
    expect(FakeSocket.opened[0]?.protocols).toEqual(['aeven.account', 'aeven.bearer.token-1'])
  })

  it('opens nothing while the page holds no session', async () => {
    openAccountSocket(async () => undefined, events())
    await settle()

    expect(FakeSocket.opened).toEqual([])
  })

  it('reports a session that ended on another page, and the account language', async () => {
    const seen = events()
    openAccountSocket(async () => 'token-1', seen)
    await settle()
    const socket = FakeSocket.opened[0]!
    socket.accept()

    socket.receive(JSON.stringify({ type: 'account.locale', locale: 'es' }))
    socket.receive(JSON.stringify({ type: 'session.ended' }))

    expect(seen.locale).toHaveBeenCalledWith('es')
    expect(seen.sessionEnded).toHaveBeenCalledOnce()
  })

  it('ignores frames it does not act on', async () => {
    const seen = events()
    openAccountSocket(async () => 'token-1', seen)
    await settle()
    const socket = FakeSocket.opened[0]!
    socket.accept()

    socket.receive('not json')
    socket.receive(JSON.stringify({ type: 'auth.ok', userId: 'u-1' }))
    socket.receive(JSON.stringify({ type: 'account.locale', locale: 7 }))

    expect(seen.locale).not.toHaveBeenCalled()
    expect(seen.sessionEnded).not.toHaveBeenCalled()
  })

  it('reopens a dropped socket with the token the page holds then', async () => {
    const bearer = vi.fn(async () => 'token-1')
    openAccountSocket(bearer, events())
    await settle()
    FakeSocket.opened[0]!.accept()

    FakeSocket.opened[0]!.drop(1006)
    await vi.advanceTimersByTimeAsync(5_000)

    expect(FakeSocket.opened).toHaveLength(2)
    expect(bearer).toHaveBeenLastCalledWith(undefined)
  })

  it('renews the token before reopening a socket whose handshake was refused', async () => {
    const bearer = vi.fn(async (rejected?: string) => (rejected === undefined ? 'token-1' : 'token-2'))
    openAccountSocket(bearer, events())
    await settle()

    // Refused before it opened: the token no longer names a live session here.
    FakeSocket.opened[0]!.drop(1006)
    await vi.advanceTimersByTimeAsync(5_000)

    expect(bearer).toHaveBeenLastCalledWith('token-1')
    expect(FakeSocket.opened[1]?.protocols).toEqual(['aeven.account', 'aeven.bearer.token-2'])
  })

  it('does not reopen a socket the API ended with the session', async () => {
    openAccountSocket(async () => 'token-1', events())
    await settle()
    FakeSocket.opened[0]!.accept()

    FakeSocket.opened[0]!.drop(1000)
    await vi.advanceTimersByTimeAsync(5_000)

    expect(FakeSocket.opened).toHaveLength(1)
  })

  it('closes the socket and cancels a pending reopen when disposed', async () => {
    const stop = openAccountSocket(async () => 'token-1', events())
    await settle()
    const socket = FakeSocket.opened[0]!
    socket.accept()

    socket.drop(1006)
    stop()
    await vi.advanceTimersByTimeAsync(5_000)

    expect(socket.closedWith).toEqual([1000])
    expect(FakeSocket.opened).toHaveLength(1)
  })
})
