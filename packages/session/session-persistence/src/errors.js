/** Stable failures exposed by the session-persistence service. */
/** Another Host holds this session's exclusive execution and recovery writer. */
export class SessionPersistenceBusyError extends Error {
    sessionId;
    /** @param sessionId - session currently owned by another writer. */
    constructor(sessionId) {
        super(`session "${sessionId}" is active in another Host`);
        this.sessionId = sessionId;
        this.name = 'SessionPersistenceBusyError';
    }
}
/** The requested Session identity has no materialized durable log. */
export class SessionPersistenceNotFoundError extends Error {
    sessionId;
    /** @param sessionId - absent durable Session identity. */
    constructor(sessionId) {
        super(`session "${sessionId}" not found`);
        this.sessionId = sessionId;
        this.name = 'SessionPersistenceNotFoundError';
    }
}
/** The local log is replicated from another device and admits no execution or repair. */
export class SessionPersistenceReadOnlyError extends Error {
    sessionId;
    /** @param sessionId - replicated session identity. */
    constructor(sessionId) {
        super(`session "${sessionId}" is replicated from another device; fork it to continue`);
        this.sessionId = sessionId;
        this.name = 'SessionPersistenceReadOnlyError';
    }
}
//# sourceMappingURL=errors.js.map