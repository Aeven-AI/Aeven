const DOCUMENT = 'workspaces';
/** Mirror between the workspace registry and each account's synced document. */
export class WorkspaceSync {
    ctx;
    apply;
    warn;
    now;
    open = new Map();
    /**
     * @param ctx - the registry context; `sync` is read optionally.
     * @param apply - stores another device's workspaces on this device.
     * @param warn - receives failures to open the document.
     * @param now - clock for the tombstone timestamp.
     */
    constructor(ctx, apply, warn, now = () => new Date()) {
        this.ctx = ctx;
        this.apply = apply;
        this.warn = warn;
        this.now = now;
    }
    /**
     * Open the account's document once this device syncs it and apply what other devices wrote.
     * @param owner - the account.
     * @returns the open document, or undefined while sync does not serve the account.
     */
    attach(owner) {
        const existing = this.open.get(owner);
        if (existing !== undefined)
            return existing;
        const sync = this.ctx.get('sync');
        const state = sync?.status(owner).state;
        if (sync === undefined || state === 'disabled' || state === 'starting')
            return Promise.resolve(undefined);
        const opening = sync.openDocument(owner, DOCUMENT).then((handle) => {
            const records = handle.doc.getMap('records');
            const order = handle.doc.getArray('order');
            const take = () => { this.take(owner, records, order); };
            take();
            records.observe((_event, transaction) => {
                if (!transaction.local)
                    take();
            });
            order.observe((_event, transaction) => {
                if (!transaction.local)
                    take();
            });
            return handle;
        }, (error) => {
            this.open.delete(owner);
            this.warn(`workspace: opening the synced document failed: ${String(error)}`);
            return undefined;
        });
        this.open.set(owner, opening);
        return opening;
    }
    take(owner, records, order) {
        const projection = {
            records: [...records.entries()].map(([id, entry]) => ({ id: id, ...entry })),
            order: order.toArray(),
        };
        this.apply(owner, projection);
    }
    /**
     * Accounts this device has opened a document for.
     * @returns the account ids.
     */
    owners() {
        return [...this.open.keys()];
    }
    /**
     * Publish one account's workspaces after a local change. A workspace this device does not hold is left as the
     * document has it, since it may be one this device has not received yet; only {@link forget} removes one.
     * @param owner - the account.
     * @param projection - its workspaces and their order.
     */
    async publish(owner, projection) {
        const handle = await this.attach(owner);
        if (handle === undefined)
            return;
        const records = handle.doc.getMap('records');
        const order = handle.doc.getArray('order');
        handle.doc.transact(() => {
            for (const { id, ...entry } of projection.records) {
                if (JSON.stringify(records.get(id)) !== JSON.stringify(entry))
                    records.set(id, entry);
            }
            const held = new Set(projection.order);
            // Workspaces this device has not received yet keep their place after the ones it orders.
            const rest = order.toArray().filter(id => !held.has(id));
            order.delete(0, order.length);
            order.insert(0, [...projection.order, ...rest]);
        });
    }
    /**
     * Publish the removal of one workspace this device deleted.
     * @param owner - the account.
     * @param id - the removed workspace.
     * @param title - its last title, kept so a device that never received it can still name it.
     */
    async forget(owner, id, title) {
        const handle = await this.attach(owner);
        handle?.doc.getMap('records').set(id, { removed: true, title, updatedAt: this.now().toISOString() });
    }
    /** Close every open document. */
    async dispose() {
        for (const opening of this.open.values())
            (await opening)?.close();
        this.open.clear();
    }
}
//# sourceMappingURL=sync.js.map