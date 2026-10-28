/**
 * Service Definition for session handoff (`ctx.sessionHandoff`): a session of a synced account has one device
 * writing it at a time, and every other device that holds a copy still takes the user's input for it. Such a
 * device forwards each input to the device writing the session, which applies it as if it were typed there, and
 * the session's events reach every device as they commit. The input vocabulary belongs to the Consumer that
 * forwards and applies it; the provider carries it unchanged.
 * @module @aeven/session-handoff
 */
import { Context, Service } from '@deepseek-ai/cordis'
import type { SessionId } from '@aeven/session'

/** One input for a session another device writes, in the forwarding Consumer's own vocabulary. */
export interface SessionHandoffInput {
  /** What the input does, such as `prompt` or `cancel`. */
  readonly operation: string
  /** The operation's request, as JSON. */
  readonly request: unknown
}

/** The device that writes a session right now. */
export interface SessionRunner {
  /** Its device id in the account's vault. */
  readonly device: string
  /** The name it gave itself, such as its host name; empty until it wrote one. */
  readonly name: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionHandoff: SessionHandoff
  }

  interface Events {
    /**
     * Another device forwarded an input for a session this device writes. Listeners apply it as the session's
     * owner; it is delivered once.
     * @mode emit
     * @param owner - the account the session belongs to.
     * @param sessionId - the session.
     * @param input - the forwarded input.
     * @avnScopeScan unsupported
     */
    'session-handoff/input'(owner: string, sessionId: SessionId, input: SessionHandoffInput): void
  }
}

/** Session handoff capability. */
export abstract class SessionHandoff extends Service {
  constructor(ctx: Context) {
    super(ctx, 'sessionHandoff')
  }

  /**
   * The device writing a session when it is not this device.
   * @param owner - the account.
   * @param sessionId - the session.
   * @returns the writing device, or undefined when this device writes the session or it is not synced.
   */
  abstract runnerOf(owner: string, sessionId: SessionId): SessionRunner | undefined

  /**
   * Forward one input to the device writing a session. Input reaches it in the order it was forwarded and waits
   * while that device is unreachable.
   * @param owner - the account.
   * @param sessionId - the session.
   * @param input - the input.
   */
  abstract forward(owner: string, sessionId: SessionId, input: SessionHandoffInput): Promise<void>

  /**
   * Publish an input that arrived for a session this device writes to `session-handoff/input` listeners.
   * @param owner - the account.
   * @param sessionId - the session.
   * @param input - the input.
   */
  protected deliver(owner: string, sessionId: SessionId, input: SessionHandoffInput): void {
    this.ctx.emit('session-handoff/input', owner, sessionId, input)
  }
}

export default SessionHandoff
