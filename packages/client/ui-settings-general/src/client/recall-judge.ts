/** Host-backed preference for the recall relevance judgment. */

import { createSnapshotStore, type SnapshotStore } from '@aeven/client-store'
import type { SettingsScope } from '@aeven/client-ui-settings/client'
import { MEMORY_RECALL_JUDGE_FIELD, type MemoryRecallSettings } from '../recall-settings.ts'

/** Live recall-judgment preference consumed by its Settings row. */
export class RecallJudgePolicy {
  /** Reactive current preference; off before Host settings arrive. */
  readonly enabled: SnapshotStore<boolean> = createSnapshotStore(false)

  /* jscpd:ignore-start -- mirrors DeveloperModePolicy: one boolean preference per Host settings namespace. */
  /**
   * @param host - the account's durable recall scope.
   */
  constructor(private readonly host: SettingsScope<MemoryRecallSettings>) {
    host.subscribe(() => { this.adopt() })
    this.adopt()
  }

  /**
   * Publish and persist one explicit user choice.
   * @param enabled - whether a relevance judgment selects the recalled memories.
   */
  setEnabled(enabled: boolean): void {
    if (this.enabled.getSnapshot() === enabled) return
    this.enabled.set(enabled)
    void this.host.set(MEMORY_RECALL_JUDGE_FIELD, enabled)
  }

  /** Adopt the latest accepted Host section without writing it back. */
  private adopt(): void {
    const section = this.host.getSnapshot().value
    if (section === undefined || this.enabled.getSnapshot() === section.judge) return
    this.enabled.set(section.judge)
  }
  /* jscpd:ignore-end */
}
