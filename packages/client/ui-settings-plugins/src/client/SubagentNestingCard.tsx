/** User control deciding whether a subagent may start subagents of its own. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import { PluginCard } from './PluginCard.tsx'
import type { SubagentNestingCardFace } from './subagent-nesting-card-controller.ts'
import { ToggleField } from './fields.tsx'
import type {} from './slot-contract.ts'

/** Props the renderer binds for the subagent nesting card. */
export type SubagentNestingCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<SubagentNestingCardFace>

/**
 * Render the subagent nesting switch.
 * @param props - locale copy, the card snapshot, and its staged actions.
 * @returns the nesting card, or nothing when the namespace is unavailable.
 */
export function SubagentNestingCard(props: SubagentNestingCardProps) {
  const { t } = props
  const state = props.useSubagentNestingCard(snapshot => snapshot)
  const disabled = !state.writable || state.saving
  return (
    <PluginCard
      t={t}
      titleKey="subagentNestingTitle"
      descriptionKey="subagentNestingDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <ToggleField
        id="plugin-config-subagent-nesting-enabled"
        label={t('subagentNestingToggle')}
        hint={t(state.enabled ? 'subagentNestingEnabledHint' : 'subagentNestingDisabledHint')}
        checked={state.enabled}
        overridden={state.enabledField.overridden}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        disabled={disabled}
        onToggle={props.toggleEnabled}
        onReset={props.resetEnabled}
      />
    </PluginCard>
  )
}
