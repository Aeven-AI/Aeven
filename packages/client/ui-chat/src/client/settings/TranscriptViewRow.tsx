/** Appearance Settings row for completed-Turn transcript presentation. */

import type { SnapshotStore } from '@aeven/client-store'
import { SettingsRow, SettingsSelect } from '@aeven/client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import type { TranscriptViewMode } from '../../chat-settings.ts'
import type { ChatKey } from '../locale.ts'

/** Registration-side transcript preference face. */
export interface TranscriptViewRowInjected {
  hooks: {
    /** Persisted transcript preference bound as useTranscriptView. */
    transcriptView: SnapshotStore<TranscriptViewMode>
  }
  /** Change the completed-Turn transcript presentation. */
  setTranscriptView: (mode: TranscriptViewMode) => void
}

/** Full Settings-row props. */
export type TranscriptViewRowProps =
  PropsRuntime<'settings.appearance.item'>
  & PropsLocale<'chat'>
  & InjectFace<TranscriptViewRowInjected>

const OPTIONS: readonly { id: TranscriptViewMode; label: ChatKey }[] = [
  { id: 'normal', label: 'settings.transcript.normal' },
  { id: 'extended', label: 'settings.transcript.extended' },
]

/**
 * Render the completed-Turn transcript mode selector.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function TranscriptViewRow({ useTranscriptView, setTranscriptView, t }: TranscriptViewRowProps) {
  const mode = useTranscriptView(value => value)

  return (
    <SettingsRow
      title={t('settings.transcript.title')}
      description={t('settings.transcript.description')}
      control={(
        <SettingsSelect
          items={OPTIONS.map(option => ({ id: option.id, label: t(option.label) }))}
          selectedId={mode}
          onSelect={(id) => { setTranscriptView(id as TranscriptViewMode) }}
        />
      )}
    />
  )
}
