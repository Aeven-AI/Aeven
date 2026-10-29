/**
 * Service Definition for session handoff (`ctx.sessionHandoff`): a session of a synced account has one device
 * writing it at a time, and every other device that holds a copy still takes the user's input for it. Such a
 * device forwards each input to the device writing the session, which applies it as if it were typed there, and
 * the session's events reach every device as they commit. The input vocabulary belongs to the Consumer that
 * forwards and applies it; the provider carries it unchanged.
 * @module @aeven/session-handoff
 */
import { Service } from '@deepseek-ai/cordis';
/** Session handoff capability. */
export class SessionHandoff extends Service {
    constructor(ctx) {
        super(ctx, 'sessionHandoff');
    }
    /**
     * Publish that another device took over a session this device wrote to `session-handoff/released` listeners.
     * @param owner - the account.
     * @param sessionId - the session.
     */
    async released(owner, sessionId) {
        await this.ctx.parallel('session-handoff/released', owner, sessionId);
    }
    /**
     * Publish a change of another device's live state to `session-handoff/live` listeners.
     * @param owner - the account.
     * @param sessionId - the session.
     */
    liveChanged(owner, sessionId) {
        this.ctx.emit('session-handoff/live', owner, sessionId);
    }
    /**
     * Publish an input that arrived for a session this device writes to `session-handoff/input` listeners.
     * @param owner - the account.
     * @param sessionId - the session.
     * @param input - the input.
     */
    deliver(owner, sessionId, input) {
        this.ctx.emit('session-handoff/input', owner, sessionId, input);
    }
}
export default SessionHandoff;
//# sourceMappingURL=index.js.map