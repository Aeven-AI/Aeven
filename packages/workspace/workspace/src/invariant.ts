/**
 * Package-owned invariant companion for `@aeven/workspace`.
 * @module @aeven/workspace/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@aeven/invariants'
import type { DomainChanged } from '@aeven/storage-domain'
import { kindPathAgrees, WorkspaceId } from '@aeven/workspace'

const PACKAGE_NAME = '@aeven/workspace'

/** Cordis companion plugin name. */
export const name = 'workspace-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Owned relationship: the registry's entity cache mirrors the workspace
 * domain's durable table. Every `domain/changed` for the `workspaces` table
 * must name a record the cache already holds an entity for (the registry
 * caches before the durable put and mutates only through cached entities).
 * A delete is valid only after the registry has removed the entity from its
 * cache, whether for create rollback or an explicit registration deletion;
 * deleting while the cache still publishes the entity proves a bypass.
 *
 * The second owned relationship is internal to a record: its `kind` and its
 * `path` must agree, because a folder workspace is only identifiable through
 * its directory while every other kind must stay portable by having none.
 * `validateStoredState` enforces this at startup over the whole table; checking
 * it here too is what catches a *runtime* writer that bypassed the registry's
 * pairing, which a restart-only check would not surface until much later.
 */
const install: InvariantInstaller = Object.assign(
  (ctx: Context, fail: (message: string) => never) => {
    ctx.on('domain/changed', (change: DomainChanged) => {
      if (change.domain !== 'workspace' || change.table !== 'workspaces') return
      if (change.operation === 'deleted') {
        if (ctx.workspaceRegistry.get(WorkspaceId(change.key)) !== undefined) {
          fail(
            `workspace record '${change.key}' was deleted while the registry cache still `
            + 'publishes it — some write path bypassed ctx.workspaceRegistry',
          )
        }
        return
      }
      const entity = ctx.workspaceRegistry.get(WorkspaceId(change.key))
      if (entity === undefined) {
        fail(
          `workspace record '${change.key}' landed durably but the registry cache holds `
          + 'no entity for it — the cache and the domain table have diverged',
        )
      }
      if (!kindPathAgrees(entity.kind, entity.path)) {
        fail(
          `workspace '${change.key}' is kind '${entity.kind}' but `
          + (entity.path === undefined
            ? 'records no path'
            : `records path '${entity.path}'`)
          + ' — some write path produced a record whose kind and path disagree',
        )
      }
    })
  },
  { inject: ['workspaceRegistry'] },
)

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
