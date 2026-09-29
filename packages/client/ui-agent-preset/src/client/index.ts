/**
 * Agent-preset surface plugin, browser half — two surfaces over one roster: a
 * chip on the new-session screen for the session about to start, and a settings
 * section that manages the roster (copy, delete, default, and the way into a
 * preset's own files).
 *
 * Both are developer surfaces: every session runs the deployment's default
 * composition, and the roster is shown only while Developer mode is on. They
 * mount as one child plugin, so turning Developer mode off disposes every
 * registration and subscription they made.
 *
 * A running session keeps the composition it began with (the host refuses to
 * adopt an existing session under a different preset), so the choice belongs to
 * the screen that starts one. The default preset is edited where the roster is
 * visible — the settings section's "make default" — so General settings carries
 * no duplicate control for the same field.
 */

// Type-only: pulls the Session Controller service merge (ctx.sessions).
import type {} from '@aeven/api-session-controller/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@aeven/client-locale/client'
// Type-only: pulls the ctx.remote merge and the forwarded-event key face
// (the settings invalidation rides the allowlist) into this program.
import type {} from '@aeven/api-remotes/client'
// Type-only: pulls the settings shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@aeven/client-ui-settings/client'
import type {} from '@aeven/client-ui-renderer/client'
// Type-only: pulls the Workspace UI navigation service merge (ctx.uiWorkspace).
import type {} from '@aeven/client-ui-workspace/client'
import type { Context as ClientContext, Fiber } from '@deepseek-ai/cordis'
import type {
  DeveloperSettings, DeveloperSettingsNamespace,
} from '@aeven/client-ui-settings-general/client'
import { AgentPresetSeat } from './AgentPresetSeat.tsx'
import type { AgentPresetSeatInjected } from './AgentPresetSeat.tsx'
import { AgentPresetSection } from './AgentPresetSection.tsx'
import type { AgentPresetSectionInjected } from './AgentPresetSection.tsx'
import { AgentPresetSeatController } from './seat-store.ts'
import { AgentPresetSectionController } from './section-store.ts'
import { en, zh, type AgentPresetSettingsKey } from './locales.ts'
import {
  AGENT_PRESET_SETTINGS_NS, AgentPresetRosterHolder, AgentPresetSettingsController,
} from './settings-store.ts'

declare module '@aeven/client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Agent-preset surface copy. */
    'settings.agentPreset': AgentPresetSettingsKey
  }
}

export type { AgentPresetSeatInjected, AgentPresetSeatProps } from './AgentPresetSeat.tsx'
export type { AgentPresetSectionInjected, AgentPresetSectionProps } from './AgentPresetSection.tsx'
export type { AgentPresetSeatState } from './seat-store.ts'
export {
  draftBlocker, type AgentPresetSectionState, type CopyDraft, type PresetRow, type PresetView,
} from './section-store.ts'
export type { AgentPresetOption, AgentPresetSettingsState } from './settings-store.ts'
export { AGENT_PRESET_SETTINGS_NS, writeDefaultPreset } from './settings-store.ts'

/** Services the developer surfaces use. */
const SURFACE_INJECT = ['slots', 'locale', 'remote', 'remote.agentPresets', 'remote.settings']

/** Required services (cordis fiber inject). */
export const inject = [...SURFACE_INJECT, 'settingsScope']

/**
 * The Developer mode namespace, owned by `ui-settings-general`; typed from its
 * declaration because plugins share types, never values.
 */
const DEVELOPER_SETTINGS_NAMESPACE: DeveloperSettingsNamespace = 'ui-developer'

/**
 * Register the dictionaries, and mount the roster surfaces while Developer mode is on.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register('settings.agentPreset', { zh, en }), 'ui-agent-preset: settings row dictionaries')

  const developer = ctx.settingsScope.bind<DeveloperSettings>({ namespace: DEVELOPER_SETTINGS_NAMESPACE })
  ctx.effect(() => {
    let surfaces: Fiber | undefined
    const sync = (): void => {
      const enabled = developer.getSnapshot().value?.enabled === true
      if (enabled === (surfaces !== undefined)) return
      if (enabled) {
        surfaces = ctx.plugin({ name: 'ui-agent-preset: developer surfaces', inject: SURFACE_INJECT, apply: mountSurfaces })
        return
      }
      void surfaces?.dispose()
      surfaces = undefined
    }
    sync()
    const stop = developer.subscribe(sync)
    return () => {
      stop()
      void surfaces?.dispose()
    }
  }, 'ui-agent-preset: developer mode gate')
}

/**
 * Mount the roster surfaces: hero chip, session-header label, settings section.
 * @param ctx - the developer-surfaces child plugin context.
 */
function mountSurfaces(ctx: ClientContext): void {
  // One roster for every surface: created here, passed to each, never looked
  // up from the context.
  const roster = new AgentPresetRosterHolder(ctx)
  const controller = new AgentPresetSettingsController(roster)
  // One roster, three surfaces. The chip is registered in a later scope, so it
  // subscribes here rather than being reached from this one.
  const rosterReaders = new Set<() => void>()
  const section = new AgentPresetSectionController(ctx, roster, () => {
    roster.invalidate()
    void controller.load()
    for (const read of rosterReaders) read()
  })

  ctx.effect(() => {
    // The roster is a live directory and the default is a settings field, so
    // both an external settings edit and a reconnect can move this row.
    const refresh = (): void => {
      roster.invalidate()
      void controller.load()
      // The section reads the same roster and marks the same default, so a
      // change made from either surface converges both.
      if (section.store.getSnapshot().status !== 'idle') void section.load()
    }
    const disposers = [
      ctx.remote.$on('settings/document-updated', (ns) => {
        if (ns !== AGENT_PRESET_SETTINGS_NS) return
        refresh()
      }),
      ctx.on('connection/reset', () => { refresh() }),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'ui-agent-preset: settings refresh')

  // The settings section's conversational authoring entry: stage the
  // self-referential preset and land a new session on it. Bound inside the
  // conversation scope below (the seat and the session flow live there) and
  // unbound with it, so the section's face reads the current binding per
  // render and simply hides the button while no flow exists.
  let creatorDraft: (() => void) | undefined

  // The new-session chip and the header label: one controller, because the
  // staged choice belongs to the flow rather than to any one session.
  ctx.inject(['slots', 'conversation', 'sessions', 'uiWorkspace'], (scope: ClientContext) => {
    const seat = new AgentPresetSeatController(scope, roster, () => {
      const state = scope.sessions.list.getSnapshot()
      return state.current === undefined ? undefined : state.byId[state.current]
    })

    const seatInjected = (): AgentPresetSeatInjected => ({
      hooks: { agentPresetSeat: seat.store },
      load: () => seat.load(),
      select: (id: string) => seat.select(id),
      introduced: () => { seat.introduced() },
    })

    scope.effect(() => {
      // Connecting a workspace either creates a blank session or reuses one,
      // and either way the chip's pick predates it — so the stage is applied
      // when the session arrives, not when it was made.
      const stop = scope.sessions.list.subscribe(() => { void seat.apply() })
      // The chip opens on the deployment default, so a default changed from
      // the settings surface moves it too — otherwise the screen that starts
      // the next session keeps offering the previous default until a reload,
      // which is exactly the session the setting claims to govern. A staged
      // pick survives: `load()` prefers it over the refreshed fallback.
      const settingsMoved = scope.remote.$on('settings/document-updated', (ns) => {
        if (ns !== AGENT_PRESET_SETTINGS_NS) return
        void seat.load()
      })
      // Authoring writes a FILE, not a setting, so nothing on the wire
      // announces it — without this the screen that starts the next session
      // keeps offering the roster as it stood when the chip first loaded, and
      // a preset authored to be used is missing from the one place it is used.
      const readRoster = (): void => { void seat.load() }
      rosterReaders.add(readRoster)
      // Stage WITHOUT applying — the still-current running session would
      // refuse the swap and drop the stage — then start the session it lands
      // on: the chip's list-change applier composes the blank session the
      // workspace connect produces or reuses.
      creatorDraft = () => {
        // The introduce cue makes the chip announce the pick the user never
        // made on this screen — the stage happened back in settings.
        seat.stage('aeven', true)
        scope.uiWorkspace.startSession()
      }
      const chip = scope.slots.register({
        name: 'conversation.hero.agentPreset',
        locale: 'settings.agentPreset',
        inject: seatInjected,
      }, AgentPresetSeat)
      return () => {
        stop()
        settingsMoved()
        rosterReaders.delete(readRoster)
        creatorDraft = undefined
        chip()
      }
    }, 'ui-agent-preset: new-session chip and header label')
  })

  const sectionInjected = (): AgentPresetSectionInjected => ({
    hooks: { agentPresetSection: section.store },
    load: () => section.load(),
    view: (id: string) => section.view(id),
    closeView: () => { section.closeView() },
    beginCopy: (from: string) => { section.beginCopy(from) },
    cancelCopy: () => { section.cancelCopy() },
    setCopyId: (id: string) => { section.setCopyId(id) },
    setCopyName: (name: string) => { section.setCopyName(name) },
    confirmCopy: () => section.confirmCopy(),
    openLocation: (id: string) => section.openLocation(id),
    ...creatorDraft === undefined ? {} : { startCreatorDraft: creatorDraft },
    confirmDelete: (id: string | null) => { section.confirmDelete(id) },
    remove: () => section.remove(),
    makeDefault: (id: string) => section.makeDefault(id),
  })

  // Ordered after Models: choosing a model is routine, and composing an
  // agent is the deployment-shaping act behind it.
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'agent-presets',
    order: 80,
    label: () => ctx.locale.bind('settings.agentPreset')('nav'),
    locale: 'settings.agentPreset',
    inject: sectionInjected,
  }, AgentPresetSection))
}
