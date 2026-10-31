/** Staged nesting switch for subagent delegation. */

import type { SnapshotStore } from '@aeven/client-store'
import type { SettingsScope } from '@aeven/client-ui-settings/client'
import {
  CardForm,
  type CardFieldSpec,
  type CardFieldState,
  type CardShell,
} from './card-form.ts'

/** Settings namespace owned by the delegation tools' nesting switch. */
export const SUBAGENT_NESTING_NS = 'subagent-nesting'

/** User-owned subagent nesting settings. */
export interface SubagentNestingSettings {
  /** Whether a child agent may start subagents of its own. */
  enabled: boolean
}

// The form carries every field as staged text, so the switch round-trips
// through the same draft machinery as the numeric controls.
const enabledField: CardFieldSpec = {
  field: 'enabled',
  format: value => value === true ? 'true' : 'false',
  parse: text => text === 'true' || text === 'false'
    ? { kind: 'set', value: text === 'true' }
    : undefined,
}

/** State rendered by the subagent nesting card. */
export interface SubagentNestingCardState extends CardShell {
  /** Whether the staged policy lets subagents delegate in turn. */
  enabled: boolean
  /** Enablement field, including its override marker. */
  enabledField: CardFieldState
}

/** Registration-side face for the subagent nesting card. */
export interface SubagentNestingCardFace {
  hooks: {
    /** Card snapshot bound by the renderer as useSubagentNestingCard. */
    subagentNestingCard: SnapshotStore<SubagentNestingCardState>
  }
  /** Stage nesting as enabled or disabled. */
  toggleEnabled: () => void
  /** Restore the deployment's composed switch. */
  resetEnabled: () => void
  /** Persist the staged switch. */
  save: () => void
  /** Drop the staged switch. */
  discard: () => void
}

/** Bridges the `subagent-nesting` settings scope onto its staged card. */
export class SubagentNestingCardController {
  private readonly form: CardForm<SubagentNestingSettings>
  private readonly store: SnapshotStore<SubagentNestingCardState>

  /** @param scope - bound `subagent-nesting` settings scope. */
  constructor(scope: SettingsScope<SubagentNestingSettings>) {
    this.form = new CardForm(scope, [enabledField])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): SubagentNestingCardState {
    const enabledField = this.form.field('enabled')
    return {
      ...this.form.shell(),
      enabled: enabledField.text === 'true',
      enabledField,
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card snapshot and staged actions.
   */
  inject(): SubagentNestingCardFace {
    const actions = this.form.actions()
    return {
      hooks: { subagentNestingCard: this.store },
      toggleEnabled: () => { actions.edit('enabled', this.projection().enabled ? 'false' : 'true') },
      resetEnabled: () => { actions.resetField('enabled') },
      save: actions.save,
      discard: actions.discard,
    }
  }
}
