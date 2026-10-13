/** Host-backed word fade-in preference for streamed text. */

import { createSnapshotStore, type SnapshotStore } from '@aeven/client-store'
import type { SettingsScope } from '@aeven/client-ui-settings/client'
import { DEFAULT_TEXT_ANIMATION, TEXT_ANIMATION_FIELD, type ChatSettings } from '../chat-settings.ts'

/** Live fade-in preference consumed by Chat and its Settings row. */
export class TextAnimationPolicy {
  /** Reactive current preference; defaults to on before Host settings arrive. */
  readonly enabled: SnapshotStore<boolean> = createSnapshotStore(DEFAULT_TEXT_ANIMATION)

  /**
   * @param host - durable Chat settings scope.
   */
  constructor(private readonly host: SettingsScope<ChatSettings>) {
    host.subscribe(() => { this.adopt() })
    this.adopt()
  }

  /**
   * Publish and persist one explicit user choice.
   * @param enabled - whether streamed words fade in.
   */
  setEnabled(enabled: boolean): void {
    if (this.enabled.getSnapshot() === enabled) return
    this.enabled.set(enabled)
    void this.host.set(TEXT_ANIMATION_FIELD, enabled)
  }

  /** Adopt the latest accepted Host section without writing it back. */
  private adopt(): void {
    const section = this.host.getSnapshot().value
    if (section === undefined || this.enabled.getSnapshot() === section.textAnimation) return
    this.enabled.set(section.textAnimation)
  }
}
