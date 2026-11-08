/**
 * One field of the Host's browser settings section, mirrored for the client: a
 * change made on the Settings page reaches every reader of the mirror, and a
 * choice made here is persisted to the Host.
 */
import { createSnapshotStore, type SnapshotStore } from '@aeven/client-store'
import type { SettingsScope } from '@aeven/client-ui-settings/client'
import type { BrowserSettings } from '../browser-settings.ts'

/** Live value of one browser setting for one browser plugin instance. */
export class SettingMirror<K extends keyof BrowserSettings> {
  /** Reactive value; the initial value until the Host section arrives. */
  readonly value: SnapshotStore<BrowserSettings[K]>

  private host: SettingsScope<BrowserSettings> | undefined

  /**
   * @param field - the settings field mirrored.
   * @param initial - the value before the Host section arrives, the field's default.
   */
  constructor(private readonly field: K, initial: BrowserSettings[K]) {
    this.value = createSnapshotStore(initial)
  }

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
   * Publish and persist one explicit choice.
   * @param value - the value chosen.
   */
  set(value: BrowserSettings[K]): void {
    if (this.value.getSnapshot() === value) return
    this.value.set(value)
    void this.host?.set(this.field, value)
  }

  /** Adopt the latest accepted Host section without writing it back. */
  private adopt(): void {
    const section = this.host?.getSnapshot().value
    if (section === undefined || this.value.getSnapshot() === section[this.field]) return
    this.value.set(section[this.field])
  }
}
