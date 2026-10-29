/** One account's claim on one kind of exclusive work. */
export class LeaseHolder {
    sync;
    owner;
    name;
    timing;
    options;
    expiresAt = 0;
    timer;
    renewing;
    now;
    /** The state {@link LeaseHolderOptions.changed} last received. */
    reported;
    /** Whether the relay's last answer gave the lease to another device. */
    lostToOther = false;
    /**
     * @param sync - the account sync service.
     * @param owner - the account.
     * @param name - logical name of the work, hidden from the relay.
     * @param timing - requested lifetime and renewal interval.
     * @param options - clock and change listener.
     */
    constructor(sync, owner, name, timing, options = {}) {
        this.sync = sync;
        this.owner = owner;
        this.name = name;
        this.timing = timing;
        this.options = options;
        this.now = options.now ?? Date.now;
        this.reported = this.held();
    }
    /**
     * Whether this device may do the work now: always while sync does not serve the account, and otherwise only
     * while this device holds an unexpired lease.
     * @returns whether to run the work.
     */
    held() {
        const state = this.sync.status(this.owner).state;
        if (state === 'disabled' || state === 'starting')
            return true;
        return this.now() < this.expiresAt;
    }
    /**
     * Whether the relay's last answer gave the lease to another device. An unreachable relay leaves the answer
     * before it in place, so a lease that only expired between failed renewals reads false.
     * @returns whether another device holds the lease.
     */
    refused() {
        return this.lostToOther;
    }
    /** Take the lease when free and keep renewing it until {@link dispose}. */
    start() {
        if (this.timer !== undefined)
            return;
        this.timer = setInterval(() => { void this.renew(); }, this.timing.renewMs);
        void this.renew();
    }
    /**
     * Try once to take or renew the lease. A failure keeps the previous local expiry, so the work stops when it
     * passes.
     * @returns when this attempt ends.
     */
    renew() {
        this.renewing ??= (async () => {
            const requested = this.now();
            try {
                const lease = await this.sync.acquireLease(this.owner, this.name, this.timing.ttlMs);
                this.expiresAt = lease.granted ? requested + this.timing.ttlMs : 0;
                this.lostToOther = !lease.granted;
            }
            catch {
                // An unreachable relay keeps the previous expiry; held() turns false once it passes.
            }
            const after = this.held();
            if (after === this.reported)
                return;
            this.reported = after;
            this.options.changed?.(after);
        })().finally(() => { this.renewing = undefined; });
        return this.renewing;
    }
    /**
     * Stop renewing and give the lease up so another device can take it.
     * @returns when the release attempt ends.
     */
    async dispose() {
        if (this.timer !== undefined)
            clearInterval(this.timer);
        this.timer = undefined;
        await this.renewing;
        this.lostToOther = false;
        if (this.expiresAt === 0)
            return;
        this.expiresAt = 0;
        await this.sync.releaseLease(this.owner, this.name).catch(() => {
            // The relay lets an unreleased lease expire on its own.
        });
    }
}
//# sourceMappingURL=lease.js.map