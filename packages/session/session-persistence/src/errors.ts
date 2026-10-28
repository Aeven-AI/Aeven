/** Stable failures exposed by the session-persistence service. */

import type { SessionId } from '@aeven/session'

/** Another Host holds this session's exclusive execution and recovery writer. */
export class SessionPersistenceBusyError extends Error {
  /** @param sessionId - session currently owned by another writer. */
  constructor(readonly sessionId: SessionId) {
    super(`session "${sessionId}" is active in another Host`)
    this.name = 'SessionPersistenceBusyError'
  }
}

/** The requested Session identity has no materialized durable log. */
export class SessionPersistenceNotFoundError extends Error {
  /** @param sessionId - absent durable Session identity. */
  constructor(readonly sessionId: SessionId) {
    super(`session "${sessionId}" not found`)
    this.name = 'SessionPersistenceNotFoundError'
  }
}

/** The local log is replicated from another device and admits no execution or repair. */
export class SessionPersistenceReadOnlyError extends Error {
  /** @param sessionId - replicated session identity. */
  constructor(readonly sessionId: SessionId) {
    super(`session "${sessionId}" is replicated from another device; fork it to continue`)
    this.name = 'SessionPersistenceReadOnlyError'
  }
}
