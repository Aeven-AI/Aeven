/** User control for SQLite-backed search across session message content. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import { PluginCard } from './PluginCard.tsx'
import type { SessionSearchCardFace } from './session-search-card-controller.ts'
import { ToggleField } from './fields.tsx'
import type {} from './slot-contract.ts'

/** Props the renderer binds for the session-search card. */
export type SessionSearchCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<SessionSearchCardFace>

/**
 * Render the session-content search preference.
 * @param props - locale copy, the card snapshot, and its staged actions.
 * @returns the preference card, or nothing when the namespace is unavailable.
 */
export function SessionSearchCard(props: SessionSearchCardProps) {
  const { t } = props
  const state = props.useSessionSearchCard(snapshot => snapshot)
  const disabled = !state.writable || state.saving
  return (
    <PluginCard
      t={t}
      titleKey="sessionSearchTitle"
      descriptionKey="sessionSearchDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <ToggleField
        id="plugin-config-session-search-enabled"
        label={t('sessionSearchToggle')}
        hint={t(state.enabled ? 'sessionSearchEnabledHint' : 'sessionSearchDisabledHint')}
        checked={state.enabled}
        overridden={state.openAt.overridden}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        disabled={disabled}
        onToggle={props.toggleEnabled}
        onReset={props.resetOpenAt}
      />
    </PluginCard>
  )
}
