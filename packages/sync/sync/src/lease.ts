/**
 * Keeps one device's claim on exclusive work of an account. A lease belongs to the device, so several Consumers
 * on one Host may hold the same name; on different devices only one holds it at a time.
 */
import type { Sync } from './index.ts'

/** Timing a Consumer configures. */
export interface LeaseHolderTiming {
  /** Lifetime requested on each renewal, in milliseconds. */
  ttlMs: number
  /** Interval between renewals, in milliseconds; shorter than {@link ttlMs}. */
  renewMs: number
}

/** Optional collaborators of a {@link LeaseHolder}. */
export interface LeaseHolderOptions {
  /** Clock the lease's local expiry is kept by; `Date.now` unless given. */
  now?: () => number
  /**
   * Called when whether this device holds the lease differs from the last state reported, including a lease
   * that expired between renewals.
   */
  changed?: (held: boolean) => void
}

/** One account's claim on one kind of exclusive work. */
export class LeaseHolder {
  private expiresAt = 0
  private timer: ReturnType<typeof setInterval> | undefined
  private renewing: Promise<void> | undefined
  private readonly now: () => number
  /** The state {@link LeaseHolderOptions.changed} last received. */
  private reported: boolean

  /**
   * @param sync - the account sync service.
   * @param owner - the account.
   * @param name - logical name of the work, hidden from the relay.
   * @param timing - requested lifetime and renewal interval.
   * @param options - clock and change listener.
   */
  constructor(
    private readonly sync: Sync,
    private readonly owner: string,
    private readonly name: string,
    private readonly timing: LeaseHolderTiming,
    private readonly options: LeaseHolderOptions = {},
  ) {
    this.now = options.now ?? Date.now
    this.reported = this.held()
  }

  /**
   * Whether this device may do the work now: always while sync does not serve the account, and otherwise only
   * while this device holds an unexpired lease.
   * @returns whether to run the work.
   */
  held(): boolean {
    const state = this.sync.status(this.owner).state
    if (state === 'disabled' || state === 'starting') return true
    return this.now() < this.expiresAt
  }

  /** Take the lease when free and keep renewing it until {@link dispose}. */
  start(): void {
    if (this.timer !== undefined) return
    this.timer = setInterval(() => { void this.renew() }, this.timing.renewMs)
    void this.renew()
  }

  /**
   * Try once to take or renew the lease. A failure keeps the previous local expiry, so the work stops when it
   * passes.
   * @returns when this attempt ends.
   */
  renew(): Promise<void> {
    this.renewing ??= (async () => {
      const requested = this.now()
      try {
        const lease = await this.sync.acquireLease(this.owner, this.name, this.timing.ttlMs)
        this.expiresAt = lease.granted ? requested + this.timing.ttlMs : 0
      } catch {
        // An unreachable relay keeps the previous expiry; held() turns false once it passes.
      }
      const after = this.held()
      if (after === this.reported) return
      this.reported = after
      this.options.changed?.(after)
    })().finally(() => { this.renewing = undefined })
    return this.renewing
  }

  /**
   * Stop renewing and give the lease up so another device can take it.
   * @returns when the release attempt ends.
   */
  async dispose(): Promise<void> {
    if (this.timer !== undefined) clearInterval(this.timer)
    this.timer = undefined
    await this.renewing
    if (this.expiresAt === 0) return
    this.expiresAt = 0
    await this.sync.releaseLease(this.owner, this.name).catch(() => {
      // The relay lets an unreleased lease expire on its own.
    })
  }
}
