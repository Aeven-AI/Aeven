/**
 * Branded identifiers for the version-control seam: a provider id cannot be
 * passed where a checkout path or a revision belongs.
 * @module @aeven/vcs/brand
 */

import type { Branded } from '@aeven/brand'

/** Stable identity a provider reserves when it registers, e.g. `git`. */
export type VcsProviderId = Branded<'vcs-provider-id'>
