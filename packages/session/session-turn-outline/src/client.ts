/**
 * Client namespace of the turn-outline domain: the package's types outlet plus
 * the environment-neutral produced-file readers that the client's turn-scoped
 * `deliverables` Definition shares with the Host `turnDeliverables` fold, so
 * both list the same files. Client code imports only this namespace.
 *
 * @module @aeven/session-turn-outline/client
 */

export type * from './types.ts'
export * from './produced.ts'
