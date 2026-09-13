/**
 * Model selection plugin, browser half — TWO entries over ONE per-session
 * directory owned by ModelDirectoryResolver (`ctx.modelDirectories`) AND one
 * picker per list: the `/model` popupSelect contribution and the composer
 * seat's Model row both open the SAME `CommandUiSpec` through the SAME
 * popupSelect shell, so the slash line and the composer button show one
 * searchable model list rather than two lookalikes. The seat's Effort row opens
 * its own spec through that same shell, so the levels render and filter like
 * every other list instead of through a second picker implementation.
 *
 * The seat keeps its two-level entry — the Model/Effort chooser whose rows lead
 * to the lists. What it no longer owns is a list of its own.
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
import type {
  ModelProviderGroup, ModelSelection,
} from '@deepseek-ai/dsh-api-session-controller/types'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { CommandUiContract, CommandUiSpec, SelectOption } from '@deepseek-ai/dsh-client-ui-commands/client'
// Type-only: pulls the ui-conversation SlotMap merge (the input.model seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelDirectoryState } from './directory.ts'
import { ModelDirectoryResolver } from './service.ts'
import type { ModelSelectInjected } from './slots.ts'
import { ModelSelect } from './ModelSelect.tsx'
import { en, zh, type ModelKey } from './locales.ts'

export { ModelDirectory } from './directory.ts'
export type { ModelDirectoryState } from './directory.ts'
export { ModelDirectoryResolver } from './service.ts'
export type { ModelSelectInjected } from './slots.ts'
export type { ModelKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
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

/** One catalog model as the Host advertises it. */
type CatalogModel = ModelProviderGroup['models'][number]

/** One selectable row's id: an opaque row key (resolved by lookup, never parsed). */
function rowId(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`
}

/** Row-id namespace of the reasoning-effort rows; prefixed like the failure rows so they cannot read as models. */
const EFFORT_ROW_PREFIX = 'effort/'

/** Row key of the provider-default effort — the one effort row that submits no `reasoningEffort`. */
const PROVIDER_DEFAULT_EFFORT = 'provider-default'

/** One reasoning-effort choice of the current model. */
interface EffortLevel {
  /** Row key inside the effort namespace. */
  readonly id: string
  /** The effort submitted when picked; undefined is the provider default. */
  readonly effort: string | undefined
  /** Adapter-owned level name; null for the provider-default row, whose copy this plugin owns. */
  readonly name: string | null
}

/**
 * The current selection's catalog entry plus its effective effort (the
 * selection's own effort, else the adapter's default). Undefined while nothing
 * is selected or the selected route advertises no group — a route serving a
 * model it does not advertise stays usable, it just has no row.
 * @param directory - the session's directory snapshot.
 * @returns the current model and its effective effort, or undefined.
 */
function currentModelOf(
  directory: ModelDirectoryState,
): { readonly model: CatalogModel; readonly effectiveEffort: string | undefined } | undefined {
  const current = directory.current
  if (current === null) return undefined
  const model = directory.groups
    .find(group => group.id === current.provider)
    ?.models.find(entry => entry.id === current.model)
  if (model === undefined) return undefined
  return { model, effectiveEffort: current.reasoningEffort ?? model.reasoning?.defaultEffort }
}

/**
 * The current model's selectable efforts, derived from that exact model's
 * adapter metadata. It is the ONE source both the effort rows and the effort
 * lookup read, so a picked row can never resolve to an effort the adapter does
 * not serve. The provider-default row appears only when the adapter configures
 * no default; an adapter without reasoning metadata contributes nothing.
 * @param directory - the session's directory snapshot.
 * @returns the effort levels, in the adapter's advertised order.
 */
function effortLevelsOf(directory: ModelDirectoryState): readonly EffortLevel[] {
  const reasoning = currentModelOf(directory)?.model.reasoning
  if (reasoning === undefined) return []
  return [
    ...reasoning.defaultEffort === undefined
      ? [{ id: PROVIDER_DEFAULT_EFFORT, effort: undefined, name: null }]
      : [],
    ...reasoning.efforts.map(effort => ({ id: effort.id, effort: effort.id, name: effort.name })),
  ]
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
 * The effort picker's rows: the current model's adapter-ordered levels, each
 * carrying the model it belongs to as its detail, so a row says what it will
 * change and the shell's filter matches the model name too. Empty when no model
 * is selected or its adapter advertises no reasoning metadata — the seat hides
 * the Effort row in exactly that case.
 * @param directory - the session's directory snapshot.
 * @param t - the model-namespace translate.
 * @returns the rows the shared shell renders and filters.
 */
function effortOptionsOf(directory: ModelDirectoryState, t: TranslateNS<'model'>): SelectOption[] {
  const current = currentModelOf(directory)
  if (current === undefined) return []
  return effortLevelsOf(directory).map(level => ({
    id: `${EFFORT_ROW_PREFIX}${level.id}`,
    label: level.name ?? t('effort.providerDefault'),
    detail: current.model.name,
    ...(current.effectiveEffort === level.effort ? { active: true } : {}),
  }))
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

/**
 * Resolve a picked effort row: it keeps the current route and swaps only the
 * effort, so an effort never silently changes the model.
 * @param state - the session's directory snapshot.
 * @param id - the picked effort row id.
 * @returns the complete selection, or undefined for a stale id.
 */
function effortSelectionOf(state: ModelDirectoryState, id: string): ModelSelection | undefined {
  if (!id.startsWith(EFFORT_ROW_PREFIX)) return undefined
  const current = state.current
  if (current === null) return undefined
  const level = effortLevelsOf(state).find(entry => entry.id === id.slice(EFFORT_ROW_PREFIX.length))
  if (level === undefined) return undefined
  return {
    provider: current.provider,
    model: current.model,
    ...level.effort === undefined ? {} : { reasoningEffort: level.effort },
  }
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

/**
 * The effort spec behind the seat's Effort row. It is deliberately NOT
 * registered as a command: a session's levels only mean something next to the
 * model they belong to, so this list is reachable from the seat alone — but it
 * is still the shared shell, so it searches and renders like the model list.
 * @param models - the session directory resolver.
 * @param sessions - the session service, for the addressed-subagent refusal.
 * @param t - the model-namespace translate.
 * @returns the spec the seat's Effort row opens.
 */
function effortPopupSpec(
  models: ModelDirectoryResolver,
  sessions: ISessions,
  t: TranslateNS<'model'>,
): CommandUiSpec {
  return {
    kind: 'popupSelect',
    options: async (session) => {
      assertOrdinary(sessions, session.sessionId)
      return effortOptionsOf(await models.directoryFor(session.sessionId).load(), t)
    },
    onSelect: async (option, session) => {
      assertOrdinary(sessions, session.sessionId)
      const directory = models.directoryFor(session.sessionId)
      const selection = effortSelectionOf(directory.store.getSnapshot(), option.id)
      if (selection === undefined) {
        throw new Error('this model no longer advertises that reasoning effort — reopen the list')
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
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-model-selection: dictionaries')

  // Non-slot faces (the command description) read through the bound translate;
  // the seat component and the row builders read the live-bound `t` per call.
  const t = ctx.locale.bind(NS)

  // The composer-block reason is this plugin's own copy, read at raise time so
  // a locale change reaches the next publish.
  ctx.plugin(ModelDirectoryResolver, { blockReason: () => t('blocked.composer') })

  // Both entries resolve modelDirectories first; each spec is memoized so the
  // seat opens the exact object the command registered, never a second build.
  let modelSpec: CommandUiSpec | undefined
  let effortSpec: CommandUiSpec | undefined
  const specs = (models: ModelDirectoryResolver, sessions: ISessions) => ({
    model: (modelSpec ??= modelPopupSpec(models, sessions, t)),
    effort: (effortSpec ??= effortPopupSpec(models, sessions, t)),
  })

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
      ui: specs(models, sessions).model,
    }), 'ui-model-selection: /model contribution')
  })

  // Entry 2: the composer's named model seat — a two-row chooser whose rows open
  // the shared shell. It submits through the shared specs, so the seat owns no
  // list of its own.
  ctx.inject(['slots', 'commandUi', 'modelDirectories'], (scope: ClientContext) => {
    const command = scope.get('commandUi') as CommandUiContract
    const models = scope.modelDirectories
    const sessions = scope.sessions
    const shared = specs(models, sessions)
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
          openModel: () => {
            if (available) command.openSelect(sessionId, SHELL_COMMAND, shared.model)
          },
          openEffort: () => {
            if (available) command.openSelect(sessionId, SHELL_COMMAND, shared.effort)
          },
        }
      },
    }, ModelSelect))
  })
}
