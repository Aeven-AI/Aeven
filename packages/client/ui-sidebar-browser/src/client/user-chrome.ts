/**
 * Whether the agent may use the reader's everyday Chrome: a mirror of the Host
 * user-settings section, so a change on the Settings page reaches the agent's
 * next tab command.
 */
import type { SnapshotStore } from '@aeven/client-store'
import type { SettingsScope } from '@aeven/client-ui-settings/client'
import { USER_CHROME_FIELD, type BrowserSettings } from '../browser-settings.ts'
import { SettingMirror } from './setting-mirror.ts'

/** Live opt-in for one browser plugin instance. */
export class UserChromePreference {
  readonly #mirror = new SettingMirror(USER_CHROME_FIELD, false)

  /** Reactive opt-in; off until the Host section arrives. */
  get allowed(): SnapshotStore<boolean> { return this.#mirror.value }

  /**
   * Follow one Host settings section.
   * @param host - the durable browser section.
   * @returns disposer that stops following it.
   */
  attach(host: SettingsScope<BrowserSettings>): () => void {
    return this.#mirror.attach(host)
  }

  /**
   * Publish and persist the reader's choice.
   * @param allowed - whether the agent may use their Chrome.
   */
  set(allowed: boolean): void {
    this.#mirror.set(allowed)
  }
}
