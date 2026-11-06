/**
 * The subscription model catalog pieces a Host user's subscriptions and each account's subscriptions share: the
 * model selection the Providers page reads and writes, and the Codex model listing the model sync refreshes.
 * @module
 */
import type { CodingOAuthModelSelection } from './auth-routes.ts'
import type { CodexModelCapabilities } from './codex-model-capabilities.ts'
import type { ModelSelection } from './model-selection.ts'
import type { OAuthProviderSession } from './oauth-session.ts'
import type { GrokBuildSession } from './session.ts'
import { subscriptionModelViews } from './subscription-models.ts'

/**
 * The model selection the subscription routes serve over one set of sessions.
 * @param grok - the Grok Build session.
 * @param codex - the Codex session.
 * @param selection - the stored model selection of the same subscriptions.
 * @returns the views and the selection write the routes call.
 */
export function subscriptionModelSelection(
  grok: GrokBuildSession,
  codex: OAuthProviderSession,
  selection: ModelSelection,
): CodingOAuthModelSelection {
  const available = (slug: 'grok' | 'codex'): ReturnType<GrokBuildSession['availableModels']> =>
    slug === 'grok' ? grok.availableModels() : codex.availableModels()
  return {
    views: slug => subscriptionModelViews(slug, available(slug), modelId => selection.isSelected(slug, modelId)),
    setSelected: async (slug, selected) => {
      const ids = subscriptionModelViews(slug, available(slug), () => true).map(model => model.id)
      await selection.setSelected(slug, ids, selected)
    },
  }
}

/**
 * Refresh the Codex session's live models from the listing Codex reports, in its priority order.
 * @param codex - the Codex session whose live models are replaced.
 * @param capabilities - the Codex model listing reader.
 * @param signal - cancels the refresh.
 * @throws Error when the listing names no models, which the capability cache also answers for a failed read.
 */
export async function syncCodexModels(
  codex: OAuthProviderSession,
  capabilities: CodexModelCapabilities,
  signal: AbortSignal,
): Promise<void> {
  const listed = (await capabilities.refresh(signal))
    .filter(model => model.listed)
    .sort((left, right) => (left.priority ?? Number.MAX_SAFE_INTEGER) - (right.priority ?? Number.MAX_SAFE_INTEGER))
  if (listed.length === 0) throw new Error('the Codex model listing returned no models')
  await codex.setLiveModels(listed.map(model => ({
    id: model.id,
    ...(model.name === undefined ? {} : { name: model.name }),
    ...(model.imageInput === undefined ? {} : { imageInput: model.imageInput }),
  })))
}
