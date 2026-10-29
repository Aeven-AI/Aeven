/**
 * Keeps one device's claim on exclusive work of an account. A lease belongs to the device, so several Consumers
 * on one Host may hold the same name; on different devices only one holds it at a time.
 */
import type { Sync } from './index.ts';
/** Timing a Consumer configures. */
export interface LeaseHolderTiming {
    /** Lifetime requested on each renewal, in milliseconds. */
    ttlMs: number;
    /** Interval between renewals, in milliseconds; shorter than {@link ttlMs}. */
    renewMs: number;
}
/** Optional collaborators of a {@link LeaseHolder}. */
export interface LeaseHolderOptions {
    /** Clock the lease's local expiry is kept by; `Date.now` unless given. */
    now?: () => number;
    /**
     * Called when whether this device holds the lease differs from the last state reported, including a lease
     * that expired between renewals.
     */
    changed?: (held: boolean) => void;
}
/** One account's claim on one kind of exclusive work. */
export declare class LeaseHolder {
    private readonly sync;
    private readonly owner;
    private readonly name;
    private readonly timing;
    private readonly options;
    private expiresAt;
    private timer;
    private renewing;
    private readonly now;
    /** The state {@link LeaseHolderOptions.changed} last received. */
    private reported;
    /** Whether the relay's last answer gave the lease to another device. */
    private lostToOther;
    /**
     * @param sync - the account sync service.
     * @param owner - the account.
     * @param name - logical name of the work, hidden from the relay.
     * @param timing - requested lifetime and renewal interval.
     * @param options - clock and change listener.
     */
    constructor(sync: Sync, owner: string, name: string, timing: LeaseHolderTiming, options?: LeaseHolderOptions);
    /**
     * Whether this device may do the work now: always while sync does not serve the account, and otherwise only
     * while this device holds an unexpired lease.
     * @returns whether to run the work.
     */
    held(): boolean;
    /**
     * Whether the relay's last answer gave the lease to another device. An unreachable relay leaves the answer
     * before it in place, so a lease that only expired between failed renewals reads false.
     * @returns whether another device holds the lease.
     */
    refused(): boolean;
    /** Take the lease when free and keep renewing it until {@link dispose}. */
    start(): void;
    /**
     * Try once to take or renew the lease. A failure keeps the previous local expiry, so the work stops when it
     * passes.
     * @returns when this attempt ends.
     */
    renew(): Promise<void>;
    /**
     * Stop renewing and give the lease up so another device can take it.
     * @returns when the release attempt ends.
     */
    dispose(): Promise<void>;
}
//# sourceMappingURL=lease.d.ts.map