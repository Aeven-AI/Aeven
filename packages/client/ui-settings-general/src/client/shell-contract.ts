/**
 * Settings shell contract — the types of the `sidebar.settings` occupant this
 * package renders. They live here rather than in ui-settings because they
 * reference the sidebar's own slot type: ui-settings is the settings domain's
 * base layer and must not depend on any `ui-*` presentation package, or the
 * reference graph closes a cycle through ui-sidebar → ui-layout → ui-theme.
 * The settings SLOT types (what registrants contribute) stay in ui-settings.
 */
import type { ConnectionState } from '@aeven/client-connection/client'
import type {
  HostObservable, InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime,
} from '@aeven/client-ui-slots'
// Type-only: pulls ui-sidebar's SlotMap merge (the 'sidebar.settings' entry)
// into every program that sees this contract.
import type {} from '@aeven/client-ui-sidebar/client'
// Type-only: pulls the settings slot declarations the shell renders into.
import type {} from '@aeven/client-ui-settings/client'
import type { SettingsAddress } from './settings-url.ts'

/** One nav row projected from a settings.section registration's options. */
export interface SettingsSectionRow {
  id: string
  order: number
  label: string
}

/** One ordered onboarding step projected from a slot registration. */
export interface SettingsOnboardingStep {
  id: string
  order: number
}

/**
 * Registrant-private injected share of the settings shell (assembled in
 * apply): connection state, ledger projections, and the panel's address arrive
 * as hook-compartment sources, while the reconnect command and the two address
 * navigations remain plain callbacks.
 */
export type SettingsRootInjected = {
  /** Request a fresh logical generation and physical WebSocket immediately. */
  reconnect: () => void
  /**
   * Address the panel at a section, or a page inside it, opening it when it was closed.
   * @param section - section id; absent addresses the panel's first section.
   * @param detail - page inside the section; absent addresses the section itself.
   */
  show: (section?: string, detail?: string) => void
  /** Drop the panel's address, closing it. */
  close: () => void
  hooks: {
    /** Connection-owned state for the current Host connection. */
    connectionState: HostObservable<ConnectionState | undefined>
    /** settings.section ledger projected into ordered nav rows. */
    sections: HostObservable<readonly SettingsSectionRow[]>
    /** settings.onboarding ledger projected into coordinator order. */
    onboardingSteps: HostObservable<readonly SettingsOnboardingStep[]>
    /** Address of the open settings panel; undefined while the panel is closed. */
    settingsAddress: HostObservable<SettingsAddress | undefined>
  }
}

/**
 * Full component props of the settings shell root: the sidebar owner share
 * (expanded/closed state) plus the declared render shares and the injected face
 * (hooks compartment bound to useSections and useSettingsAddress). No store is
 * registered: whether the panel is open, and which section it shows, is the
 * address bar's state, read through the bound hook.
 */
export type SettingsRootComponentProps =
  PropsRuntime<'sidebar.settings'>
  & PropsRenderSlots<
    | 'settings.trigger'
    | 'settings.header'
    | 'settings.action'
    | 'settings.close'
    | 'settings.section'
    | 'settings.onboarding'
  >
  & InjectFace<SettingsRootInjected>
  & PropsLocale<'settings'>
