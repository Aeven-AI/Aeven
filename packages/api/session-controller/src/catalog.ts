/** Shared projection of the live LLM registry into the browser model catalog. */

import type { Context } from '@deepseek-ai/cordis'
import type {
  ModelCatalog,
  ModelReasoning,
  ModelSelection,
} from './types.ts'

/**
 * Order two catalog entries by the label the browser actually shows, falling
 * back to the id so entries sharing a name keep a stable order between calls.
 * `numeric` makes version-bearing names read naturally — `GLM 5.2` before
 * `GLM 5.3` before `GLM 5.10` — which a plain code-unit sort would not.
 * @param left - first entry.
 * @param right - second entry.
 * @returns negative, zero, or positive in the usual comparator sense.
 */
function byDisplayName(
  left: { id: string; name: string },
  right: { id: string; name: string },
): number {
  return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
    || left.id.localeCompare(right.id, undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * Build the browser model catalog without requiring a Session.
 * @param ctx - Host context carrying the live LLM registry.
 * @param defaultSelection - deployment default used before a Session selects a model.
 * @returns successful non-empty provider groups and isolated provider failures.
 */
export async function buildModelCatalog(
  ctx: Context,
  defaultSelection: ModelSelection = ctx.agentDefaultModel.currentSelection(),
): Promise<ModelCatalog> {
  const providers = ctx.llm.listProviders()
  const catalog = await Promise.all(providers.map(async (provider) => {
    try {
      const models = await ctx.llm.listModels(provider.id)
      const entries = await Promise.all(models.map(async (model) => {
        const resolved = await ctx.llm.resolveModelInfo(provider.id, model.id)
        const reasoning: ModelReasoning | undefined = resolved.reasoning === undefined
          ? undefined
          : {
            efforts: resolved.reasoning.efforts.map(effort => ({
              id: effort.id,
              name: effort.name,
              ...(effort.description === undefined ? {} : { description: effort.description }),
            })),
            ...(resolved.reasoning.defaultEffort === undefined
              ? {}
              : { defaultEffort: resolved.reasoning.defaultEffort }),
          }
        return {
          id: model.id,
          name: model.name,
          ...(model.description === undefined ? {} : { description: model.description }),
          ...(reasoning === undefined ? {} : { reasoning }),
        }
      }))
      return {
        kind: 'group' as const,
        // Registry order is the installed catalog followed by whatever a live
        // refresh appended, which is not an order anyone can scan. The
        // selector sorts for reading; `RouteCatalog` keeps configuration
        // order for everything that dispatches.
        group: { id: provider.id, name: provider.name, models: [...entries].sort(byDisplayName) },
      }
    } catch (error) {
      return {
        kind: 'failure' as const,
        failure: {
          id: provider.id,
          name: provider.name,
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
  }))
  return {
    default: { ...defaultSelection },
    routableProviders: providers.map(provider => provider.id),
    groups: catalog.flatMap(item => item.kind === 'group' ? [item.group] : [])
      .filter(group => group.models.length > 0)
      .sort(byDisplayName),
    // Failures keep provider order: this is the diagnostic channel, not the
    // list a person scans for a model.
    failures: catalog.flatMap(item => item.kind === 'failure' ? [item.failure] : []),
  }
}
