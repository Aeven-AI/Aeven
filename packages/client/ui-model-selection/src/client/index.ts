/**
 * Model selection plugin, browser half — TWO entries over ONE per-session
 * directory owned by ModelDirectoryResolver (`ctx.modelDirectories`), and two
 * lists with different shapes: the `/model` popupSelect contribution and the
 * composer seat's Model row both open the SAME `CommandUiSpec` through the SAME
 * popupSelect shell, so the slash line and the composer button show one
 * searchable model list rather than two lookalikes. The seat's Effort row opens
 * the seat's own pane over the current model's advertised levels — three or
 * four rows, picked by eye, with no search input to carry — while the level
 * derivation itself (`effort.ts`) is shared with the selection that resolves a
 * pick, so the pane cannot offer a level the adapter does not serve.
 *
 * Every entry combines one Host-generation `session/modelCatalog` catalog with
 * the Session's durable model-selection projection and submits through
 * `session.selectModel`, so a switch made in any entry is what the others show
 * next. Failures ride the shared shell's inline error strip with Retry.
 * Addressed subagent sessions expose neither entry because those Agent-bound
 * RPCs would activate persisted history outside the direct-parent continuation
 * path.
 */
// Type-only: the carrier types, the forwarded Host-event face and the ctx.remote merge.
import type { ModelSelection } from '@aeven/api-session-controller/types'
import type {} from '@aeven/api-session-controller/client'
import type { ISessions } from '@aeven/api-session-controller/client'
import type { SessionId } from '@aeven/session/types'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { CommandUiContract, CommandUiSpec, SelectOption } from '@aeven/client-ui-commands/client'
// Type-only: pulls the ui-conversation SlotMap merge (the input.model seat).
import type {} from '@aeven/client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@aeven/client-locale/client'
import type {} from '@aeven/client-ui-renderer/client'
import type {} from '@aeven/client-ui-session/client'
import type { TranslateNS } from '@aeven/client-ui-slots'
import type { ModelDirectoryState } from './directory.ts'
import { effortSelectionOf } from './effort.ts'
import { ModelDirectoryResolver } from './service.ts'
import type { ModelSelectInjected } from './slots.ts'
import { ModelSelect } from './ModelSelect.tsx'
import { en, es, zh, type ModelKey } from './locales.ts'

export { ModelDirectory } from './directory.ts'
export type { ModelDirectoryState } from './directory.ts'
export { ModelDirectoryResolver } from './service.ts'
export type { ModelSelectInjected } from './slots.ts'
export type { ModelKey } from './locales.ts'

declare module '@aeven/client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The model selection surfaces' copy (/model popup + composer seat). */
    model: ModelKey
  }
}

/**
 * Shell label both pickers open under. It names the model surface rather than
 * inventing a command: the effort list is that same feature's second list, and
 * the shell renders this value into its aria labels and its failure logs.
 */
const SHELL_COMMAND = 'model'

/** One selectable row's id: an opaque row key (resolved by lookup, never parsed). */
function rowId(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`
}

/**
 * The model picker's rows: every advertised model, then the provider-local
 * failures (listed for visibility but never selectable). This is the row set
 * the `/model` line and the seat's Model row share.
 * @param directory - the session's directory snapshot.
 * @param t - the model-namespace translate.
 * @returns the rows the shared shell renders and filters.
 */
function modelOptionsOf(directory: ModelDirectoryState, t: TranslateNS<'model'>): SelectOption[] {
  const rows: SelectOption[] = []
  for (const group of directory.groups) {
    for (const model of group.models) {
      rows.push({
        id: rowId(group.id, model.id),
        label: model.name,
        // The detail line names the provider, never the model's catalog blurb:
        // DeepSeek advertises a sentence per model and OpenRouter none, so a
        // rendered blurb makes the two lists read differently and pushes the
        // provider out of the row. The blurb stays findable through `keywords`,
        // which the shell searches but does not render.
        detail: group.name,
        ...(model.description === undefined ? {} : { keywords: model.description }),
        ...(directory.current !== null
          && directory.current.provider === group.id
          && directory.current.model === model.id
          ? { active: true } : {}),
      })
    }
  }
  for (const failure of directory.failures) {
    rows.push({
      id: `failure/${failure.id}`,
      label: failure.name,
      detail: t('option.loadError', { message: failure.message }),
    })
  }
  return rows
}

/**
 * Resolve a picked model row back to its model selection by matching against
 * the loaded data the rows were built from (the same directory snapshot — ids
 * stay opaque).
 * @param state - the session's directory snapshot.
 * @param id - the picked row id.
 * @returns the row's model selection, or undefined for failure rows / stale ids.
 */
function modelSelectionOf(state: ModelDirectoryState, id: string): ModelSelection | undefined {
  for (const group of state.groups) {
    for (const model of group.models) {
      if (rowId(group.id, model.id) !== id) continue
      const sameRoute = state.current?.provider === group.id && state.current.model === model.id
      const reasoningEffort = sameRoute
        ? state.current?.reasoningEffort ?? model.reasoning?.defaultEffort
        : model.reasoning?.defaultEffort
      return {
        provider: group.id,
        model: model.id,
        ...reasoningEffort === undefined ? {} : { reasoningEffort },
      }
    }
  }
  return undefined
}

/** Dictionary namespace owned by this plugin. */
const NS = 'model'

/**
 * Addressed subagent sessions must not run these Agent-bound RPCs: they would
 * activate persisted history outside the direct-parent continuation path.
 * @param sessions - the session service.
 * @param sessionId - the session the picker would address.
 */
function assertOrdinary(sessions: ISessions, sessionId: SessionId): void {
  if (sessions.subagentAddress(sessionId) !== undefined) {
    throw new Error('model selection is unavailable for addressed subagent sessions')
  }
}

/**
 * The ONE model-select spec behind both model entries: the `/model` command
 * registers it and the composer seat's Model row opens it through
 * `commandUi.openSelect`. Sharing the object (not a copy) is what keeps the two
 * surfaces from drifting — one row builder, one submission path, one shell.
 * @param models - the session directory resolver every entry reads.
 * @param sessions - the session service, for the addressed-subagent refusal.
 * @param t - the model-namespace translate (live: reads the active locale per call).
 * @returns the spec the `/model` line and the seat's Model row open.
 */
function modelPopupSpec(
  models: ModelDirectoryResolver,
  sessions: ISessions,
  t: TranslateNS<'model'>,
): CommandUiSpec {
  return {
    kind: 'popupSelect',
    options: async (session) => {
      assertOrdinary(sessions, session.sessionId)
      return modelOptionsOf(await models.directoryFor(session.sessionId).load(), t)
    },
    onSelect: async (option, session) => {
      assertOrdinary(sessions, session.sessionId)
      const directory = models.directoryFor(session.sessionId)
      const selection = modelSelectionOf(directory.store.getSnapshot(), option.id)
      if (selection === undefined) {
        throw new Error('this provider\'s catalog failed to load — pick a model from a loaded group')
      }
      await directory.select(selection)
    },
  }
}

/** Required services: the contribution registry, the seat's slot registry, locale, and the service's own faces. */
export const inject = ['commandUi', 'locale', 'sessions', 'slots', 'remote', 'remote.session']

/**
 * Client plugin body: mount ModelDirectoryResolver, register the `model` dictionaries,
 * then register the /model popup contribution and the composer model seat
 * over the service and the two shared specs.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, es }), 'ui-model-selection: dictionaries')

  // Non-slot faces (the command description) read through the bound translate;
  // the seat component and the row builders read the live-bound `t` per call.
  const t = ctx.locale.bind(NS)

  // The composer-block reason is this plugin's own copy, read at raise time so
  // a locale change reaches the next publish.
  ctx.plugin(ModelDirectoryResolver, { blockReason: () => t('blocked.composer') })

  // The seat's Model row and the /model line share one spec object: memoized so
  // the seat opens the exact object the command registered, never a second build.
  let modelSpec: CommandUiSpec | undefined
  const modelSpecOf = (models: ModelDirectoryResolver, sessions: ISessions): CommandUiSpec =>
    (modelSpec ??= modelPopupSpec(models, sessions, t))

  // Entry 1: the /model popupSelect over the shared directory. The command
  // description is registry-held text: it reads t() once at registration and
  // refreshes only on re-registration, not on locale change.
  ctx.inject(['commandUi', 'modelDirectories'], (scope: ClientContext) => {
    const command = scope.get('commandUi') as CommandUiContract
    const models = scope.modelDirectories
    const sessions = scope.sessions
    scope.effect(() => command.register({
      name: SHELL_COMMAND,
      description: t('command.description'),
      available: session => sessions.subagentAddress(session.sessionId) === undefined,
      ui: modelSpecOf(models, sessions),
    }), 'ui-model-selection: /model contribution')
  })

  // Entry 2: the composer's named model seat — a two-row chooser. Its Model row
  // opens the /model spec in the shared shell (one searchable list, one row
  // builder); its Effort row opens the seat's own pane over the current model's
  // advertised levels, which is a handful of rows that want no search input.
  ctx.inject(['slots', 'commandUi', 'modelDirectories'], (scope: ClientContext) => {
    const command = scope.get('commandUi') as CommandUiContract
    const models = scope.modelDirectories
    const sessions = scope.sessions
    const shared = modelSpecOf(models, sessions)
    scope.slots.inject('conversation.input.model', () => scope.slots.register({
      name: 'conversation.input.model',
      locale: NS,
      inject: (sessionId): ModelSelectInjected => {
        const directory = models.directoryFor(sessionId)
        const available = sessions.subagentAddress(sessionId) === undefined
        return {
          available,
          directory: directory.store,
          load: () => {
            if (available) directory.load().catch(() => { /* surfaced on the store */ })
          },
          openModel: (anchor: Element | null) => {
            // Beside, not under: the seat's own card stays open around the
            // list, so the row that asked keeps its place on screen.
            if (available) command.openSelect(sessionId, SHELL_COMMAND, shared, anchor, 'beside')
          },
          selectEffort: (levelId: string) => {
            if (!available) return Promise.resolve(false)
            // Resolve the picked level against the live snapshot: a level the
            // adapter no longer advertises resolves to nothing and is refused
            // rather than submitted as a stale effort.
            const selection = effortSelectionOf(directory.store.getSnapshot(), levelId)
            if (selection === undefined) return Promise.resolve(false)
            return directory.select(selection).then(() => true, () => false)
          },
        }
      },
    }, ModelSelect))
  })
}
