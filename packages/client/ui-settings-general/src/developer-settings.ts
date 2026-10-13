/**
 * Developer mode, stored in the Host user-settings document. Surfaces meant
 * for people building Æven itself — the agent-preset roster and picker — mount
 * only while it is on; the everyday product shows none of them.
 */

/** Settings namespace carrying Developer mode. */
export const DEVELOPER_SETTINGS_NAMESPACE = 'ui-developer'

/** Literal type of {@link DEVELOPER_SETTINGS_NAMESPACE}, for consumers that may import types only. */
export type DeveloperSettingsNamespace = typeof DEVELOPER_SETTINGS_NAMESPACE

/** Field carrying whether Developer mode is on. */
export const DEVELOPER_ENABLED_FIELD = 'enabled'

/** Durable Developer mode section. */
export interface DeveloperSettings {
  /** Whether developer surfaces are mounted. */
  enabled: boolean
}
