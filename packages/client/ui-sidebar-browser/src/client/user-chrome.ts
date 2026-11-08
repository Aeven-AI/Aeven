/**
 * Whether the agent may use the reader's everyday Chrome: a mirror of the Host
 * user-settings section, so a change on the Settings page reaches the agent's
 * next tab command.
 */
import { createSnapshotStore, type SnapshotStore } from '@aeven/client-store'
import type { SettingsScope } from '@aeven/client-ui-settings/client'
import { USER_CHROME_FIELD, type BrowserSettings } from '../browser-settings.ts'

/** Live opt-in for one browser plugin instance. */
export class UserChromePreference {
  /** Reactive opt-in; off until the Host section arrives. */
  readonly allowed: SnapshotStore<boolean> = createSnapshotStore(false)

  private host: SettingsScope<BrowserSettings> | undefined

  /**
   * Follow one Host settings section.
   * @param host - the durable browser section.
   * @returns disposer that stops following it.
   */
  attach(host: SettingsScope<BrowserSettings>): () => void {
    this.host = host
    const off = host.subscribe(() => { this.adopt() })
    this.adopt()
    return () => {
      off()
      this.host = undefined
    }
  }

  /**
   * Publish and persist the reader's choice.
   * @param allowed - whether the agent may use their Chrome.
   */
  set(allowed: boolean): void {
    if (this.allowed.getSnapshot() === allowed) return
    this.allowed.set(allowed)
    void this.host?.set(USER_CHROME_FIELD, allowed)
  }

  /** Adopt the latest accepted Host section without writing it back. */
  private adopt(): void {
    const section = this.host?.getSnapshot().value
    if (section === undefined || this.allowed.getSnapshot() === section.userChrome) return
    this.allowed.set(section.userChrome)
  }
}
