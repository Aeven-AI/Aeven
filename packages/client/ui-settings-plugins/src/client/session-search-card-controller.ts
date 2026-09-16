/** Staged availability control for SQLite-backed session-content search. */

import type { SnapshotStore } from '@aeven/client-store'
import type { SettingsScope } from '@aeven/client-ui-settings/client'
import {
  CardForm,
  type CardFieldSpec,
  type CardFieldState,
  type CardShell,
} from './card-form.ts'

/** Settings namespace owned by the SQLite session-query provider. */
export const SESSION_SEARCH_NS = 'session-query-sqlite'

/** SQLite index opening policies exposed by this card. */
export type SessionSearchOpenAt = 'startup' | 'first-search' | 'never'

/** User-owned session-search settings. */
export interface SessionSearchSettings {
  /** Whether SQLite opens at activation, on first search, or remains disabled. */
  openAt: SessionSearchOpenAt
}

const openAtField: CardFieldSpec = {
  field: 'openAt',
  format: value => typeof value === 'string' ? value : '',
  parse: text => ['startup', 'first-search', 'never'].includes(text)
    ? { kind: 'set', value: text }
    : undefined,
}

/** State rendered by the session-search card. */
export interface SessionSearchCardState extends CardShell {
  /** Whether full-content search is enabled in the staged policy. */
  enabled: boolean
  /** Opening-policy field, including its override marker. */
  openAt: CardFieldState
}

/** Registration-side face for the session-search card. */
export interface SessionSearchCardFace {
  hooks: {
    /** Card snapshot bound by the renderer as useSessionSearchCard. */
    sessionSearchCard: SnapshotStore<SessionSearchCardState>
  }
  /** Stage content search as enabled or disabled. */
  toggleEnabled: () => void
  /** Restore the deployment's opening policy. */
  resetOpenAt: () => void
  /** Persist the staged policy. */
  save: () => void
  /** Drop the staged policy. */
  discard: () => void
}

/** Bridges the SQLite session-query settings scope onto its staged card. */
export class SessionSearchCardController {
  private readonly form: CardForm<SessionSearchSettings>
  private readonly store: SnapshotStore<SessionSearchCardState>

  /** @param scope - bound `session-query-sqlite` settings scope. */
  constructor(scope: SettingsScope<SessionSearchSettings>) {
    this.form = new CardForm(scope, [openAtField])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): SessionSearchCardState {
    const openAt = this.form.field('openAt')
    return {
      ...this.form.shell(),
      enabled: openAt.text !== 'never',
      openAt,
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card snapshot and staged actions.
   */
  inject(): SessionSearchCardFace {
    const actions = this.form.actions()
    return {
      hooks: { sessionSearchCard: this.store },
      toggleEnabled: () => {
        actions.edit('openAt', this.projection().enabled ? 'never' : 'first-search')
      },
      resetOpenAt: () => { actions.resetField('openAt') },
      save: actions.save,
      discard: actions.discard,
    }
  }
}
