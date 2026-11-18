/** General Settings row turning the recall relevance judgment on or off. */

import type { SnapshotStore } from '@aeven/client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import { SettingsRow, Switch } from '@aeven/client-ui-primitives'

/** Registration-side recall-judgment face. */
export interface RecallJudgeRowInjected {
  hooks: {
    /** The account's stored choice, bound as useRecallJudge. */
    recallJudge: SnapshotStore<boolean>
  }
  /** Turn the relevance judgment on or off. */
  setRecallJudge: (enabled: boolean) => void
}

/** Full Settings-row props. */
export type RecallJudgeRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings'>
  & InjectFace<RecallJudgeRowInjected>

/**
 * Render the recall-judgment switch.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function RecallJudgeRow({ useRecallJudge, setRecallJudge, t }: RecallJudgeRowProps) {
  const enabled = useRecallJudge(value => value)
  return (
    <SettingsRow
      title={t('recall.title')}
      description={t('recall.description')}
      info={{ title: t('recall.title'), body: t('recall.info'), closeLabel: t('close') }}
      control={<Switch checked={enabled} onChange={setRecallJudge} label={t('recall.title')} />}
    />
  )
}
