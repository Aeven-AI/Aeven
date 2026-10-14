/**
 * Settings shell and ownerless-copy plugin, browser half: renders the
 * `sidebar.settings` occupant — panel chrome, section navigation, and the
 * onboarding stage — and registers everything on the Settings pages that
 * belongs to no single feature: the trigger/header chrome content,
 * local-document action, General section, and `settings` dictionaries.
 * Feature-owned rows and sections stay with their features.
 * Export discipline: packages/client/AGENTS.md.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote merge and its fixed Host facts.
import type {} from '@aeven/api-remotes/client'
import type { ConnectionHandle } from '@aeven/client-connection/client'
import { createSnapshotStore } from '@aeven/client-store'
import { resolveSlotLabel } from '@aeven/client-ui-slots'
// Type-only: the settings slot declarations plus the ctx.settingsScope Context
// merge. Cross-plugin collaboration goes through the service, never a value
// import (client bundle purity gate).
import type {} from '@aeven/client-ui-settings/client'
// Type-only: pulls ctx.locale into this program.
import type {} from '@aeven/client-locale/client'
import type {} from '@aeven/client-ui-renderer/client'
import type {} from '@aeven/client-ui-session/client'
import type {
  SettingsOnboardingStep, SettingsRootInjected, SettingsSectionRow,
} from './shell-contract.ts'
import { SettingsRoot } from './SettingsRoot.tsx'
import { CloseLabel, HeaderContent, TriggerContent } from './chrome.tsx'
import { GeneralSection } from './GeneralSection.tsx'
import { DeveloperModeRow, type DeveloperModeRowInjected } from './DeveloperModeRow.tsx'
import { BackgroundModeRow, type BackgroundModeRowInjected } from './BackgroundModeRow.tsx'
import { DeveloperModePolicy } from './developer-mode.ts'
import { BrowserSettingsAddressRoute } from './settings-url.ts'
import { en, zh, type SettingsKey } from './locales.ts'
import { DEVELOPER_SETTINGS_NAMESPACE, type DeveloperSettings } from '../developer-settings.ts'

export type {
  CloseLabelProps, HeaderContentProps, TriggerContentProps,
} from './chrome.tsx'
export type {
  GeneralSectionComponentProps,
} from './GeneralSection.tsx'
export type { SettingsKey } from './locales.ts'
export type { DeveloperModeRowInjected, DeveloperModeRowProps } from './DeveloperModeRow.tsx'
export type { BackgroundModeRowInjected, BackgroundModeRowProps } from './BackgroundModeRow.tsx'
export type { OnOffRowProps } from './OnOffRow.tsx'
export type { DeveloperSettings, DeveloperSettingsNamespace } from '../developer-settings.ts'

declare module '@aeven/client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Shell chrome + shell-owned General section copy. */
    settings: SettingsKey
  }
}

/** Dictionary namespace owned by this plugin (shell chrome + General copy). */
const NS = 'settings'

/**
 * Required services (cordis fiber inject). The target slots are declared by
 * ui-settings' apply, whose activation order relative to this one is NOT
 * constrained; registrations depend on their slots through `slots.inject()`.
 */
export const inject = ['slots', 'locale', 'connection', 'remote', 'remote.settings', 'settingsScope']

/**
 * The Electron shell's preload carrier, as this client needs it. Structural and
 * optional: the browser build has no `window.avnDesktop` and never calls it.
 */
interface DesktopShellCarrier {
  /** @param listener - called with each application-menu command. @returns disposer removing the listener. */
  onCommand?(listener: (command: string) => void): () => void
  /** Whether the application keeps running in the menu bar after its last window closes. */
  background?: {
    /** @returns the stored choice. */
    get(): Promise<boolean>
    /** @param enabled - the new choice. @returns resolution after the shell stores it. */
    set(enabled: boolean): Promise<void>
    /** @param listener - called with each change from any window. @returns disposer removing the listener. */
    onChange(listener: (enabled: boolean) => void): () => void
  }
}

/**
 * Register the `settings` dictionaries, the chrome content, and the General
 * section, each once its slot declaration is on the ledger.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-general: dictionaries')
  // The panel's open state and active section are the address bar's, so a
  // `settings/open` request — from the account menu, a settings section, or the
  // Desktop shell's menu — is an address write and lands in history like any
  // other tab the reader picks.
  const route = new BrowserSettingsAddressRoute(() => window)
  ctx.effect(
    () => ctx.on('settings/open', (section, detail) => { route.show(section, detail) }),
    'ui-settings-general: settings address',
  )
  // The Desktop shell's menu has no other route into this surface, so it asks
  // through the carrier its preload exposes. The same client served over HTTP
  // has no carrier, and nothing here runs.
  const carrier = typeof window === 'undefined' ? undefined : (window as { avnDesktop?: DesktopShellCarrier }).avnDesktop
  const onCommand = carrier?.onCommand?.bind(carrier)
  if (onCommand !== undefined) {
    ctx.effect(
      () => onCommand((command) => { if (command === 'open-settings') ctx.emit('settings/open') }),
      'ui-settings-general: desktop settings command',
    )
  }
  const connection = ctx.get('connection') as ConnectionHandle

  // Copy freshness is framework-owned: components read the standard `t`
  // seat, and the nav label is a thunk the owner resolves per render — no
  // locale/change re-registration wiring.
  const t = ctx.locale.bind(NS)
  // The settings shell: this package occupies the sidebar-owned hole and
  // declares the settings slots. Ledger → nav-row projection as an observable
  // source (uSES contract: getSnapshot returns the cached rows until the
  // ledger version moves). Labels may be locale-following thunks, so the cache
  // key includes the locale revision and subscribers ride both sources.
  let rowsVersion = -1
  let rowsRevision = -1
  let rows: readonly SettingsSectionRow[] = []
  let onboardingVersion = -1
  let onboardingSteps: readonly SettingsOnboardingStep[] = []
  const shellInjected = (): SettingsRootInjected => ({
    reconnect: () => { connection.reconnect() },
    show: (section, detail) => { route.show(section, detail) },
    close: () => { route.close() },
    hooks: {
      connectionState: connection.state,
      settingsAddress: route.current,
      sections: {
        getSnapshot: () => {
          const version = ctx.slots.getVersion('settings.section')
          const revision = ctx.locale.getSnapshot().revision
          if (version !== rowsVersion || revision !== rowsRevision) {
            rowsVersion = version
            rowsRevision = revision
            rows = ctx.slots.entries('settings.section')
              .map(e => ({
                /* v8 ignore next -- list-slot registration requires id (SlotCore rejects an entry without one) */
                id: e.options.id ?? '',
                order: e.options.order ?? 0,
                label: resolveSlotLabel(e.options.label) ?? '',
              }))
              .sort((a, b) => a.order - b.order)
          }
          return rows
        },
        subscribe: (listener) => {
          const offLedger = ctx.slots.subscribe('settings.section', listener)
          const offLocale = ctx.locale.subscribe(listener)
          return () => {
            offLedger()
            offLocale()
          }
        },
      },
      onboardingSteps: {
        getSnapshot: () => {
          const version = ctx.slots.getVersion('settings.onboarding')
          if (version !== onboardingVersion) {
            onboardingVersion = version
            onboardingSteps = ctx.slots.entries('settings.onboarding')
              .map(e => ({
                /* v8 ignore next -- list-slot registration requires id */
                id: e.options.id ?? '',
                order: e.options.order ?? 0,
              }))
              .sort((a, b) => a.order - b.order)
          }
          return onboardingSteps
        },
        subscribe: listener => ctx.slots.subscribe('settings.onboarding', listener),
      },
    },
  })
  ctx.slots.inject('sidebar.settings', () => ctx.slots.register({
    name: 'sidebar.settings',
    locale: NS,
    children: {
      'settings.trigger': { kind: 'single', scope: 'root' },
      'settings.header': { kind: 'single', scope: 'root' },
      'settings.action': { kind: 'list', scope: 'root' },
      'settings.close': { kind: 'single', scope: 'root' },
      'settings.section': { kind: 'list', scope: 'root' },
      'settings.onboarding': { kind: 'list', scope: 'root' },
    },
    inject: shellInjected,
  }, SettingsRoot))

  ctx.slots.inject('settings.trigger', () =>
    ctx.slots.register({ name: 'settings.trigger', locale: NS }, TriggerContent))
  ctx.slots.inject('settings.header', () =>
    ctx.slots.register({ name: 'settings.header', locale: NS }, HeaderContent))
  ctx.slots.inject('settings.close', () =>
    ctx.slots.register({ name: 'settings.close', locale: NS }, CloseLabel))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'general',
    order: 20,
    label: () => t('general.nav'),
    locale: NS,
    children: { 'settings.general.item': { kind: 'list', scope: 'root' } },
  }, GeneralSection))

  // Last in General: it changes which Settings pages exist, not how a
  // session behaves.
  const developerMode = new DeveloperModePolicy(
    ctx.settingsScope.bind<DeveloperSettings>({ namespace: DEVELOPER_SETTINGS_NAMESPACE }),
  )
  // Only the desktop shell can keep running without a window; the browser
  // build has no carrier and shows no row.
  const backgroundCarrier = carrier?.background
  if (backgroundCarrier !== undefined) {
    const backgroundMode = createSnapshotStore(false)
    ctx.effect(
      () => backgroundCarrier.onChange((enabled) => { backgroundMode.set(enabled) }),
      'ui-settings-general: desktop background mode',
    )
    backgroundCarrier.get().then((enabled) => { backgroundMode.set(enabled) }, (error: unknown) => {
      console.error('ui-settings-general: could not read the desktop background mode', error)
    })
    ctx.slots.inject('settings.general.item', () => ctx.slots.register({
      name: 'settings.general.item',
      id: 'background-mode',
      order: 90,
      locale: NS,
      inject: (): BackgroundModeRowInjected => ({
        hooks: { backgroundMode },
        setBackgroundMode: (enabled) => {
          backgroundCarrier.set(enabled).catch((error: unknown) => {
            console.error('ui-settings-general: could not store the desktop background mode', error)
          })
        },
      }),
    }, BackgroundModeRow))
  }
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'developer-mode',
    order: 100,
    locale: NS,
    inject: (): DeveloperModeRowInjected => ({
      hooks: { developerMode: developerMode.enabled },
      setDeveloperMode: (enabled) => { developerMode.setEnabled(enabled) },
    }),
  }, DeveloperModeRow))
}
