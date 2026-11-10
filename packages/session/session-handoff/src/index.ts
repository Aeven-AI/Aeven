/**
 * Service Definition for session handoff (`ctx.sessionHandoff`): a session of a synced account has one device
 * writing it at a time, and every other device that holds a copy still takes the user's input for it. Such a
 * device forwards each input to the device writing the session, which applies it as if it were typed there, and
 * the session's events reach every device as they commit. The input vocabulary belongs to the Consumer that
 * forwards and applies it; the provider carries it unchanged.
 * @module @aeven/session-handoff
 */
import { Context, Service } from '@deepseek-ai/cordis'
import type { SessionHeader, SessionId } from '@aeven/session'

/** One input for a session another device writes, in the forwarding Consumer's own vocabulary. */
export interface SessionHandoffInput {
  /** What the input does, such as `prompt` or `cancel`. */
  readonly operation: string
  /** The operation's request, as JSON. */
  readonly request: unknown
  /**
   * The forwarding user's session credentials by reference, such as the Aeven access token: the device that applies
   * the input has no client of that user connected and makes the turn's model requests with them. It holds them in
   * memory only, as it would hold a connected client's; absent on input from older builds.
   */
  readonly credentials?: Readonly<Record<string, string>>
}

/** Where a synced session runs, as the asking device sees it. */
export interface HandoffPlacement {
  /** The asking device's id in the account's vault. */
  readonly device: string
  /** The name the asking device gave itself; empty until it wrote one. */
  readonly name: string
  /** Whether the asking device keeps its relay connection without a client, such as Aeven Cloud. */
  readonly alwaysOnHere: boolean
  /**
   * The device that ran the session's latest turn, or the device it was moved to, when one is recorded and it is not
   * the asking device. `pinned` marks a desktop it was moved to, which keeps it while that desktop is present.
   */
  readonly home?: SessionRunner & { readonly alwaysOn: boolean; readonly pinned: boolean }
  /** The account's desktops other than the asking device, which the session can move to: present ones first, then most recently seen. */
  readonly desktops: readonly HandoffDesktop[]
}

/** A desktop of the account, as the asking device sees it. */
export interface HandoffDesktop extends SessionRunner {
  /** Whether it stamped its open relay connection within the presence window, so it takes forwarded input now. */
  readonly present: boolean
  /** When it last stamped its open relay connection, in milliseconds since the Unix epoch; absent when it never did. */
  readonly seenAt?: number
}

/** Conversation metadata available before this device downloads the log body. */
export interface SharedSession {
  readonly header: SessionHeader
  readonly next: number
  readonly title?: string
  readonly updatedAt: number
}

/** The outcome of claiming a session for this device. */
export type SessionClaim =
  /** This device writes the session now. */
  | { readonly claimed: true }
  /** Another device keeps writing it, such as while it runs a turn; input goes there. */
  | { readonly claimed: false }

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
     * An input some device of the account submitted is to be applied on this device. Listeners apply it as the
     * session's owner and reject when this device cannot apply it, such as when it cannot serve the session's
     * model; a rejected input stays in the account's inbox for another device.
     * @mode parallel
     * @param owner - the account the session belongs to.
     * @param sessionId - the session.
     * @param input - the submitted input.
     */
    'session-handoff/input'(owner: string, sessionId: SessionId, input: SessionHandoffInput): Promise<void>
    /**
     * The live state another device publishes for a session it writes changed; read it with
     * {@link SessionHandoff.liveOf}.
     * @mode emit
     * @param owner - the account the session belongs to.
     * @param sessionId - the session.
     */
    'session-handoff/live'(owner: string, sessionId: SessionId): void
    /**
     * The account's conversation metadata changed, including histories not downloaded here.
     * @mode emit
     * @param owner - account whose catalog changed.
     */
    'session-handoff/catalog'(owner: string): void
    /**
     * Events another device published for a session were stored on this device; one import pass emits once.
     * @mode emit
     * @param owner - the account the session belongs to.
     * @param sessionId - the session whose stored log grew.
     */
    'session-handoff/imported'(owner: string, sessionId: SessionId): void

    /**
     * Another device of the account took over writing a session this device wrote. Listeners stop running it
     * here; its new events arrive like any other device's.
     * @mode parallel
     * @param owner - the account the session belongs to.
     * @param sessionId - the session.
     */
    'session-handoff/released'(owner: string, sessionId: SessionId): void | Promise<void>
  }
}

/** Session handoff capability. */
export abstract class SessionHandoff extends Service {
  constructor(ctx: Context) {
    super(ctx, 'sessionHandoff')
  }

  /**
   * List the account's conversation metadata without downloading bodies.
   * @param owner - account.
   * @returns shared metadata currently received by this device.
   */
  abstract catalog(owner: string): readonly SharedSession[]

  /**
   * Download a shared conversation before it is opened or continued locally.
   * @param owner - account.
   * @param sessionId - conversation to read.
   * @param signal - cancellation of the opening operation.
   * @returns when its published event prefix is stored locally.
   */
  abstract fetch(owner: string, sessionId: SessionId, signal?: AbortSignal): Promise<void>

  /**
   * Whether a session belongs to the account's device-independent conversation index.
   * @param owner - account.
   * @param sessionId - session.
   * @returns whether workspace membership is independent of the header's device-local path.
   */
  abstract shared(owner: string, sessionId: SessionId): boolean

  /**
   * The device writing a session when it is not this device.
   * @param owner - the account.
   * @param sessionId - the session.
   * @returns the writing device, or undefined when this device writes the session or it is not synced.
   */
  abstract runnerOf(owner: string, sessionId: SessionId): SessionRunner | undefined

  /**
   * The always-on device, such as Aeven Cloud, that ran a session's latest turn, when it is another device.
   * A session stays on that device, where its files and background jobs live: this device forwards a turn-starting
   * input to it instead of claiming the session, and it gets the first chance to run the input.
   * @param owner - the account.
   * @param sessionId - the session.
   * @returns that device, or undefined when this device ran the latest turn, that device is not always on, or an
   *   older build published the session without recording it.
   */
  abstract homeOf(owner: string, sessionId: SessionId): SessionRunner | undefined

  /**
   * Forward one input to the device writing a session. Input reaches it in the order it was forwarded and waits
   * while that device is unreachable.
   * @param owner - the account.
   * @param sessionId - the session.
   * @param input - the input.
   */
  abstract forward(owner: string, sessionId: SessionId, input: SessionHandoffInput): Promise<void>

  /**
   * Make this device the one writing a session another device writes, when no device runs a turn of it. This
   * device's copy must hold everything the writing device published; it becomes writable here, and the other
   * device stops writing it.
   * @param owner - the account.
   * @param sessionId - the session.
   * @returns whether this device writes the session now.
   */
  abstract claim(owner: string, sessionId: SessionId): Promise<SessionClaim>

  /**
   * Hold a session for this device while it runs a turn, so no other device claims it meanwhile.
   * @param owner - the account.
   * @param sessionId - the session.
   * @param running - whether a turn runs; false lets other devices claim it again.
   */
  abstract holdRunner(owner: string, sessionId: SessionId, running: boolean): Promise<void>

  /**
   * Where a synced session runs, for offering the user to move it.
   * @param owner - the account.
   * @param sessionId - the session.
   * @returns the placement, or undefined when the session is not synced or account sync has not started.
   */
  abstract placementOf(owner: string, sessionId: SessionId): HandoffPlacement | undefined

  /**
   * Make a device of the account the session's home, so its next turn runs there: this device, or an always-on device
   * a later input is forwarded to. The session's log does not change.
   * @param owner - the account.
   * @param sessionId - the session.
   * @param device - the device id, this device's or an always-on device's.
   * @throws when another device runs a turn of the session now, or the device is neither.
   */
  abstract moveTo(owner: string, sessionId: SessionId, device: string): Promise<void>

  /**
   * Give back the hold a claim for a change took, such as a rename or a model selection, once the change is applied
   * and no turn runs here; the session stays writable here, and another device may take its next turn at once.
   * @param owner - the account.
   * @param sessionId - the session.
   */
  abstract endChange(owner: string, sessionId: SessionId): Promise<void>

  /**
   * Download an attachment another device of the account published, such as an image, video, or file a synced
   * conversation cites, when this device does not hold it yet.
   * @param _attachmentId - the attachment's content address.
   * @param _owner - restrict retrieval to this account; omission searches the Host's synced accounts.
   * @returns whether this device holds the attachment now.
   */
  fetchAttachment(_attachmentId: string, _owner?: string): Promise<boolean> {
    return Promise.resolve(false)
  }

  /**
   * Publish that another device took over a session this device wrote to `session-handoff/released` listeners.
   * @param owner - the account.
   * @param sessionId - the session.
   */
  protected async released(owner: string, sessionId: SessionId): Promise<void> {
    await this.ctx.parallel('session-handoff/released', owner, sessionId)
  }

  /**
   * Publish the live state of a session this device writes, such as whether a turn runs and what waits in its
   * queue, to the account's other devices. The state is the publishing Consumer's JSON; undefined clears it.
   * @param owner - the account.
   * @param sessionId - the session.
   * @param live - the state, or undefined once nothing is live.
   */
  abstract publishLive(owner: string, sessionId: SessionId, live: unknown): void

  /**
   * The live state the device writing a session published for it.
   * @param owner - the account.
   * @param sessionId - the session.
   * @returns the state, or undefined when the writing device published none.
   */
  abstract liveOf(owner: string, sessionId: SessionId): unknown

  /**
   * Publish a change of another device's live state to `session-handoff/live` listeners.
   * @param owner - the account.
   * @param sessionId - the session.
   */
  protected liveChanged(owner: string, sessionId: SessionId): void {
    this.ctx.emit('session-handoff/live', owner, sessionId)
  }

  /**
   * Publish an input that arrived for a session this device writes to `session-handoff/input` listeners.
   * @param owner - the account.
   * @param sessionId - the session.
   * @param input - the input.
   */
  protected async deliver(owner: string, sessionId: SessionId, input: SessionHandoffInput): Promise<void> {
    await this.ctx.parallel('session-handoff/input', owner, sessionId, input)
  }
}

export default SessionHandoff
