/**
 * The Aeven API's account socket: how a booted page learns at once that its
 * session ended on another page, or that the account's language changed.
 *
 * Every page of a session — this client's tabs and the Aeven website alike —
 * holds one. Signing out anywhere ends the session at the API, which tells each
 * of its sockets before closing them; a language set anywhere is told to every
 * socket of the account.
 * @module
 */

import { socketUrl } from './config.ts'

/** The subprotocol the API answers an account socket with. */
export const ACCOUNT_SOCKET_PROTOCOL = 'aeven.account'

/**
 * Prefix of the offered subprotocol carrying the access token. A browser cannot
 * set `Authorization` on a WebSocket, so the token travels as a second offered
 * subprotocol; the API never echoes it back.
 */
export const ACCOUNT_SOCKET_BEARER_PREFIX = 'aeven.bearer.'

/** Delay before reopening a socket that closed while its session still stands. */
const REOPEN_MILLISECONDS = 5_000

/**
 * Close codes after which reopening cannot help: the API ended the socket because
 * the session ended (1000, after `session.ended`) or names no live session (1008).
 */
const FINAL_CLOSE_CODES: ReadonlySet<number> = new Set([1000, 1008])

/** What the account socket reports. */
export interface AccountSocketEvents {
  /** The API ended this page's session: signed out on another page, or revoked. */
  readonly sessionEnded: () => void
  /**
   * The account's language changed, on this page or another.
   * @param locale - the language id the API stored.
   */
  readonly locale: (locale: string) => void
}

/**
 * The token to open the socket with.
 * @param rejected - a token the last handshake was refused with, forcing a renewal.
 * @returns the token, or undefined when the page holds no session to present.
 */
export type AccountSocketBearer = (rejected?: string) => Promise<string | undefined>

/**
 * Act on one frame the API sent. The frame crosses the wire, so its shape is
 * checked here; a frame this client does not act on is ignored.
 * @param data - the message data.
 * @param events - receives what the frame reports.
 */
function deliverFrame(data: unknown, events: AccountSocketEvents): void {
  let parsed: unknown
  if (typeof data !== 'string') return
  try {
    parsed = JSON.parse(data)
  } catch {
    // A frame that is not JSON carries nothing this page acts on.
    return
  }
  if (typeof parsed !== 'object' || parsed === null) return
  const frame = parsed as { type?: unknown; locale?: unknown }
  if (frame.type === 'session.ended') events.sessionEnded()
  else if (frame.type === 'account.locale' && typeof frame.locale === 'string') events.locale(frame.locale)
}

/**
 * Hold the account socket open for as long as the page's session stands.
 *
 * A socket that closes on its own is reopened, with the token the page holds
 * then. One whose handshake was refused before it opened is reopened with a
 * renewed token, so a token the API no longer matches to a session is not
 * offered again: a session that truly ended surfaces as the renewal's refusal.
 * @param bearer - supplies the token to present, renewing it when asked.
 * @param events - receives what the socket reports.
 * @returns disposer closing the socket and cancelling any reopen.
 */
export function openAccountSocket(bearer: AccountSocketBearer, events: AccountSocketEvents): () => void {
  const url = socketUrl()
  let stopped = false
  let socket: WebSocket | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let refused: string | undefined

  if (url === undefined) return () => {}

  const open = async (): Promise<void> => {
    const token = await bearer(refused)
    if (stopped || token === undefined) return
    let opened = false
    const current = new WebSocket(url, [ACCOUNT_SOCKET_PROTOCOL, `${ACCOUNT_SOCKET_BEARER_PREFIX}${token}`])
    socket = current
    current.addEventListener('open', () => {
      opened = true
      refused = undefined
    })
    current.addEventListener('message', (event: MessageEvent) => { deliverFrame(event.data, events) })
    current.addEventListener('close', (event: CloseEvent) => {
      if (stopped || socket !== current || FINAL_CLOSE_CODES.has(event.code)) return
      refused = opened ? undefined : token
      timer = setTimeout(() => { void open() }, REOPEN_MILLISECONDS)
    })
  }

  void open()

  return () => {
    stopped = true
    clearTimeout(timer)
    socket?.close(1000)
  }
}
