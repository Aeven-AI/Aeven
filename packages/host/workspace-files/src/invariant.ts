/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-host-workspace-files`.
 * @module @deepseek-ai/dsh-host-workspace-files/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-workspace-files'

/** Cordis companion plugin name. */
export const name = 'host-workspace-files-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: the only owned relation is this package's single
 * named route, and the webserver already rejects a duplicate (kind, path)
 * registration at `register()`. A teardown-stream probe would additionally
 * false-positive on correct disposal, because `internal/plugin` fires before
 * the disposing fiber's effects run and the legitimate owner still holds the
 * route at notification time. Register/release symmetry is covered by the
 * package's HMR-safety test instead.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
