/**
 * Service Definition for account sync (`ctx.sync`): every device signed in to one account holds the same
 * documents. Consumers open a document by logical name in an owner's vault and edit its Yjs state; the
 * provider persists it locally, encrypts every change under the account key, and exchanges it with the
 * account's other devices.
 * @module @aeven/sync
 */
import { Service } from '@deepseek-ai/cordis';
/** Account sync capability. */
export class Sync extends Service {
    constructor(ctx) {
        super(ctx, 'sync');
    }
    /**
     * Count the account's devices this device is linked to directly, outside the relay.
     * @param _owner - an account whose documents this device can open.
     * @returns the number of directly linked devices; 0 when this provider has no direct path.
     */
    linked(_owner) {
        return Promise.resolve(0);
    }
    /**
     * Receive a stream's batches as another device of the account sends them, including over a local network while
     * the relay is unreachable. A provider without a direct path between devices yields nothing.
     * @param _owner - an account whose documents this device can open.
     * @param _name - the stream's logical name.
     * @param _listener - receives each batch payload once, in the order the writing device sent it.
     * @returns a disposer that stops the subscription.
     */
    watchStream(_owner, _name, _listener) {
        return () => { };
    }
    /**
     * Publish the local outbox and receive the relay's committed backlog before transferring exclusive work.
     * @param _owner - account whose vault must be online.
     * @returns when the outbox is acknowledged and the received documents are current.
     */
    synchronize(_owner) {
        return Promise.reject(new Error('this sync provider cannot synchronize an ownership transfer'));
    }
    /**
     * Publish a status change to `sync/status` listeners.
     * @param owner - the account whose status changed.
     */
    notifyStatus(owner) {
        this.ctx.emit('sync/status', owner);
    }
    /**
     * Publish a stored remote document change to `sync/document` listeners.
     * @param owner - the account.
     * @param id - the document's opaque id.
     */
    notifyDocument(owner, id) {
        this.ctx.emit('sync/document', owner, id);
    }
}
export default Sync;
export { LeaseHolder } from "./lease.js";
//# sourceMappingURL=index.js.map