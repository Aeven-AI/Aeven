/** Host-backed Developer mode preference. */

import { createSnapshotStore, type SnapshotStore } from '@aeven/client-store'
import type { SettingsScope } from '@aeven/client-ui-settings/client'
import { DEVELOPER_ENABLED_FIELD, type DeveloperSettings } from '../developer-settings.ts'

/** Live Developer mode consumed by its Settings row. */
export class DeveloperModePolicy {
  /** Reactive current preference; off before Host settings arrive. */
  readonly enabled: SnapshotStore<boolean> = createSnapshotStore(false)

  /* jscpd:ignore-start -- mirrors TextAnimationPolicy in @aeven/client-ui-chat: one boolean preference per Host settings namespace. */
  /**
   * @param host - durable Developer mode scope.
   */
  constructor(private readonly host: SettingsScope<DeveloperSettings>) {
    host.subscribe(() => { this.adopt() })
    this.adopt()
  }

  /**
   * Publish and persist one explicit user choice.
   * @param enabled - whether developer surfaces are mounted.
   */
  setEnabled(enabled: boolean): void {
    if (this.enabled.getSnapshot() === enabled) return
    this.enabled.set(enabled)
    void this.host.set(DEVELOPER_ENABLED_FIELD, enabled)
  }

  /** Adopt the latest accepted Host section without writing it back. */
  private adopt(): void {
    const section = this.host.getSnapshot().value
    if (section === undefined || this.enabled.getSnapshot() === section.enabled) return
    this.enabled.set(section.enabled)
  }
/* jscpd:ignore-end */
}
