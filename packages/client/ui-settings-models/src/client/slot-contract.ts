/**
 * Model providers page extension slots — the two seats through which another
 * plugin adds UI to the section without editing it.
 *
 * `settings.models.provider-card` is keyed by the row's owning settings
 * namespace (`ProviderDirectoryEntry.settingsNs`): an adapter family's
 * companion plugin registers one entry under the family's namespace and
 * receives the card of an expanded row of that family — shipped, added, and
 * hand-declared rows alike — while the section never learns what the namespace
 * means. Keying on
 * the namespace follows `settings.plugin.item`, and the key domain stays the
 * open string space because hand-declared route ids are user-chosen at
 * runtime.
 *
 * TYPE HOME RATIONALE: the Models section declares these slots at runtime,
 * and a plugin registering an extension already depends on this package for
 * the declaration. The types therefore live with their declarer.
 */

import type {} from '@aeven/client-ui-slots'
import type { ProviderDirectoryEntry } from './store.ts'

declare module '@aeven/client-ui-slots' {
  interface SlotMap {
    /**
     * One provider card's adapter extension area, dispatched with
     * `entryKey = settingsNs` on the card of a saved row while that row is
     * expanded, and on the add-provider draft card. The hand-declared draft card
     * has no directory row yet, so it dispatches nothing until saved. Without a
     * registrant the area renders nothing.
     */
    'settings.models.provider-card': { kind: 'keyed'; scope: 'root'; owner: ProviderCardExtrasOwnerProps }
    /**
     * Ordered extension area after the provider rows and the add controls,
     * where provider groups without an API key (such as coding subscriptions)
     * render. Without a registrant the area renders nothing.
     */
    'settings.models.footer': { kind: 'list'; scope: 'root'; owner: ModelsFooterOwnerProps }
  }
}

/** Owner share of one provider-card extension occurrence. */
export interface ProviderCardExtrasOwnerProps {
  /** The card's directory row (route id, display name, settings address, live state). */
  provider: ProviderDirectoryEntry
  /** Whether any layer configures this provider (its profile resolves); `false` while the add-provider draft edits a dormant row. */
  configured: boolean
  /** Whether the row's referenced api-key credential is confirmed configured (the page's credential join). */
  keyConfigured: boolean
}

/** Owner share of the footer area (the section supplies nothing). */
export interface ModelsFooterOwnerProps {
  /** Marker field: footer owner props are intentionally empty. */
  children?: never
}
