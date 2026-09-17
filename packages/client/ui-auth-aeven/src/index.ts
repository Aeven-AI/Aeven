/**
 * The Aeven authentication surface for the AVN web client.
 *
 * A library rather than a plugin: the gate runs before the plugin graph, so
 * its code cannot arrive through the module system that delivers plugins. The
 * Host-side authority that verifies credentials is `avn-identity-user-aeven`.
 * @module @aeven/client-ui-auth-aeven
 */

export * from './client/index.ts'
