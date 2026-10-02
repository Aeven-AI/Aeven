/**
 * The model list each subscription provider shows on the Providers page: the
 * chat models its route serves plus the image-generation models the
 * subscription includes, each with its selection state.
 * @module @aeven/subscription-auth/subscription-models
 */

import type { Api, Model } from '@earendil-works/pi-ai'
import { CODEX_IMAGE_MODEL } from './codex-images.ts'
import { GROK_IMAGINE_IMAGE_MODEL } from './grok-imagine/types.ts'
import type { SubscriptionSlug } from './ids.ts'

/** One image-generation model a subscription includes. */
export interface SubscriptionImageModel {
  /** Model id a media request names. */
  readonly id: string
  readonly name: string
}

/**
 * Image-generation models per provider. Each subscription serves one fixed
 * image model through its own image endpoint; neither vendor lists it in the
 * chat model listing, so it is declared here. The Grok id is the direct-API
 * spelling, which the Imagine client normalizes to the transport in use.
 */
export const SUBSCRIPTION_IMAGE_MODELS: Readonly<Record<SubscriptionSlug, readonly SubscriptionImageModel[]>> = {
  grok: [{ id: GROK_IMAGINE_IMAGE_MODEL, name: 'Grok Imagine' }],
  codex: [{ id: CODEX_IMAGE_MODEL, name: 'GPT Image 2' }],
}

/** One model as the Providers page lists it. */
export interface SubscriptionModelView {
  readonly id: string
  readonly name: string
  /** The model reads images in a conversation. */
  readonly imageInput: boolean
  /** The model generates images. */
  readonly imageOutput: boolean
  readonly selected: boolean
}

/**
 * List a provider's chat and image-generation models with their selection.
 * @param slug - the provider.
 * @param chatModels - every chat model the provider's route can serve.
 * @param isSelected - whether the user keeps a model id on.
 * @returns chat models first, then image-generation models.
 */
export function subscriptionModelViews(
  slug: SubscriptionSlug,
  chatModels: readonly Model<Api>[],
  isSelected: (modelId: string) => boolean,
): SubscriptionModelView[] {
  return [
    ...chatModels.map(model => ({
      id: model.id,
      name: model.name,
      imageInput: model.input.includes('image'),
      imageOutput: false,
      selected: isSelected(model.id),
    })),
    ...SUBSCRIPTION_IMAGE_MODELS[slug].map(model => ({
      id: model.id,
      name: model.name,
      imageInput: false,
      imageOutput: true,
      selected: isSelected(model.id),
    })),
  ]
}
