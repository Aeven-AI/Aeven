/**
 * The reasoning-effort derivation the seat's effort pane and the selection it
 * submits both read. It lives on its own because two consumers need it — the
 * component that renders the levels and the plugin that resolves a picked one
 * back into a selection — and reading it twice from two places is how a row
 * stops matching what it submits.
 */
import type { ModelSelection, ModelProviderGroup } from '@aeven/api-remotes/client'
import type { ModelDirectoryState } from './directory.ts'

/** One catalog model as the Host advertises it. */
type CatalogModel = ModelProviderGroup['models'][number]

/** Row key of the provider-default effort — the one level that submits no `reasoningEffort`. */
export const PROVIDER_DEFAULT_EFFORT = 'provider-default'

/** One reasoning-effort choice of the current model. */
export interface EffortLevel {
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
 * adapter metadata. It is the ONE source both the rendered levels and the
 * lookup behind a pick read, so a picked level can never resolve to an effort
 * the adapter does not serve. The provider-default level appears only when the
 * adapter configures no default; an adapter without reasoning metadata
 * contributes nothing.
 * @param directory - the session's directory snapshot.
 * @returns the effort levels, in the adapter's advertised order.
 */
export function effortLevelsOf(directory: ModelDirectoryState): readonly EffortLevel[] {
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
 * The effort of the current route that is in force: the selection's own effort,
 * else the adapter's default. Undefined when no model (or no reasoning
 * metadata) is in play — which is also when the seat shows no Effort row.
 * @param directory - the session's directory snapshot.
 * @returns the effective effort id, or undefined.
 */
export function effectiveEffortOf(directory: ModelDirectoryState): string | undefined {
  return currentModelOf(directory)?.effectiveEffort
}

/**
 * Resolve a picked level: it keeps the current route and swaps only the effort,
 * so an effort never silently changes the model.
 * @param state - the session's directory snapshot.
 * @param levelId - the picked level's row key.
 * @returns the complete selection, or undefined for a stale id.
 */
export function effortSelectionOf(state: ModelDirectoryState, levelId: string): ModelSelection | undefined {
  const current = state.current
  if (current === null) return undefined
  const level = effortLevelsOf(state).find(entry => entry.id === levelId)
  if (level === undefined) return undefined
  return {
    provider: current.provider,
    model: current.model,
    ...level.effort === undefined ? {} : { reasoningEffort: level.effort },
  }
}
