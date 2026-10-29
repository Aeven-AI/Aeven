/** Stable failures exposed by the session-persistence service. */
import type { SessionId } from '@aeven/session';
/** Another Host holds this session's exclusive execution and recovery writer. */
export declare class SessionPersistenceBusyError extends Error {
    readonly sessionId: SessionId;
    /** @param sessionId - session currently owned by another writer. */
    constructor(sessionId: SessionId);
}
/** The requested Session identity has no materialized durable log. */
export declare class SessionPersistenceNotFoundError extends Error {
    readonly sessionId: SessionId;
    /** @param sessionId - absent durable Session identity. */
    constructor(sessionId: SessionId);
}
/** The local log is replicated from another device and admits no execution or repair. */
export declare class SessionPersistenceReadOnlyError extends Error {
    readonly sessionId: SessionId;
    /** @param sessionId - replicated session identity. */
    constructor(sessionId: SessionId);
}
//# sourceMappingURL=errors.d.ts.map