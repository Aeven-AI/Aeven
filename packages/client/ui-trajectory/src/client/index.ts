/**
 * Browser trajectory plugin contributing one entry to the conversation view
 * slot without defining a service.
 *
 * The ledger is a developer surface. Developer mode mounts its View, the
 * Conversation Definitions that feed it, and the Session hook that carries its
 * snapshot as one child plugin, so turning the setting off disposes all of
 * them: an ordinary Session's View roster never lists Trajectory, and no part
 * of the ledger stays mounted behind the hidden entry.
 */
import type { Context, Fiber } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@aeven/attachment'
import type { SessionBinding } from '@aeven/api-session-controller/client'
import type { ObservableSnapshot } from '@aeven/client-store'
import type { SessionId } from '@aeven/session/types'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@aeven/client-locale/client'
// Type-only: the 'conversation.view' SlotMap row (declared by the slot's
// owning package) must be in the program for the register calls to type.
import type {} from '@aeven/client-ui-conversation/client'
import type {} from '@aeven/client-ui-renderer/client'
import type {} from '@aeven/client-ui-session/client'
// Type-only: pulls the settings scope merge (ctx.settingsScope).
import type {} from '@aeven/client-ui-settings/client'
import type {
  DeveloperSettings, DeveloperSettingsNamespace,
} from '@aeven/client-ui-settings-general/client'
import { createTrajectoryDurationStore } from './duration-store.ts'
import { en, NS, zh } from './locales.ts'
import { registerTrajectoryAssistantDefinition } from './trajectory-assistant-definition.ts'
import { registerTrajectoryCompactionDefinitions } from './trajectory-compaction-definition.ts'
import { registerTrajectoryMessageDefinitions } from './trajectory-message-definitions.ts'
import { registerTrajectoryRequestHeaderDefinition } from './trajectory-request-header-definition.ts'
import {
  EMPTY_TRAJECTORY_SNAPSHOT, registerTrajectoryConversationView,
} from './trajectory-snapshot-builder.ts'
import type { TrajectorySnapshot } from './trajectory-contract.ts'
import { registerTrajectoryToolDefinition } from './trajectory-tool-definition.ts'
import { TrajectoryView, type TrajectoryViewInjected } from './TrajectoryView.tsx'

export type { TrajectoryKey } from './locales.ts'
export type {
  TrajectoryContribution,
  TrajectoryConversationViewNode,
  TrajectoryRequestHeaderState,
  TrajectorySnapshot,
  UseTrajectory,
} from './trajectory-contract.ts'

/**
 * Required services: the conversation slot, registries, ordinary Session
 * paging, the locale service, and the settings scope carrying Developer mode.
 */
export const inject = ['slots', 'sessions', 'uiSession', 'uiConversation', 'locale', 'settingsScope']

/**
 * The Developer mode namespace, owned by `ui-settings-general`; typed from its
 * declaration because plugins share types, never values.
 */
const DEVELOPER_SETTINGS_NAMESPACE: DeveloperSettingsNamespace = 'ui-developer'

/** Services the mounted ledger surface uses. */
const VIEW_INJECT = ['slots', 'sessions', 'uiSession', 'uiConversation', 'locale']

/**
 * Client plugin body: register the dictionaries, then mount the ledger's View
 * surface while Developer mode is on. The registration rides the slot service's
 * effect wrapper, so plugin unload or turning Developer mode off removes the
 * tab.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-trajectory: dictionaries')
  const developer = ctx.settingsScope.bind<DeveloperSettings>({ namespace: DEVELOPER_SETTINGS_NAMESPACE })
  ctx.effect(() => {
    let view: Fiber | undefined
    const sync = (): void => {
      const enabled = developer.getSnapshot().value?.enabled === true
      if (enabled === (view !== undefined)) return
      if (enabled) {
        view = ctx.plugin({ name: 'ui-trajectory: view', inject: VIEW_INJECT, apply: mountView })
        return
      }
      void view?.dispose()
      view = undefined
    }
    sync()
    const stop = developer.subscribe(sync)
    return () => {
      stop()
      void view?.dispose()
    }
  }, 'ui-trajectory: Developer mode gate')
}

/**
 * Mount the ledger View: its Conversation Definitions, the 'conversation.view'
 * entry, and the Session hook the entry's component reads.
 * @param ctx - context of the Developer mode child plugin.
 */
function mountView(ctx: Context): void {
  const trajectorySources = new WeakMap<SessionBinding, ObservableSnapshot<TrajectorySnapshot>>()
  const trajectorySource = (binding: SessionBinding): ObservableSnapshot<TrajectorySnapshot> => {
    let source = trajectorySources.get(binding)
    if (source === undefined) {
      const target = ctx.uiConversation.binding(binding).target('trajectory')
      source = {
        getSnapshot: () => target.getSnapshot() ?? EMPTY_TRAJECTORY_SNAPSHOT,
        subscribe: listener => target.subscribe(listener),
      }
      trajectorySources.set(binding, source)
    }
    return source
  }
  // Registration-time text (the view tab label) reads through the bound
  // translate as a thunk, so it follows the active locale without
  // re-registration.
  const t = ctx.locale.bind(NS)
  const duration = createTrajectoryDurationStore()
  registerTrajectoryMessageDefinitions(ctx)
  registerTrajectoryRequestHeaderDefinition(ctx)
  registerTrajectoryAssistantDefinition(ctx)
  registerTrajectoryToolDefinition(ctx)
  registerTrajectoryCompactionDefinitions(ctx)
  registerTrajectoryConversationView(ctx)
  ctx.uiSession.provide({
    hooks: ['trajectory'],
    resolve: binding => ({ hooks: { trajectory: trajectorySource(binding) } }),
  })
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'trajectory',
    order: 10,
    locale: NS,
    label: () => t('view.trajectory'),
    children: {
      'conversation.trajectory.images': { kind: 'single', scope: 'session' },
    },
    inject: (sessionId: SessionId): TrajectoryViewInjected => {
      const session = ctx.sessions.binding(sessionId)?.session
      if (session === undefined) {
        throw new Error(`ui-trajectory: session "${sessionId}" is unavailable`)
      }
      const trajectory = ctx.uiConversation.binding(sessionId).target('trajectory')
      return {
        hooks: { duration },
        loadOlder: async () => {
          const before = trajectory.getSnapshot()
          await session.loadOlder()
          return trajectory.getSnapshot() !== before
        },
        loadImage: Object.assign(
          (attachment: ImageAttachmentRef) => ctx.uiConversation.imageUrl(sessionId, attachment),
          { peek: (attachment: ImageAttachmentRef) => ctx.uiConversation.peekImageUrl(sessionId, attachment) },
        ),
        setActualDuration: (value) => { duration.set(value) },
      }
    },
  }, TrajectoryView))
}
