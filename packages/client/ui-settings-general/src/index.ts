/** Host loader entry for the browser implementation exported from `./client`. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-settings'

/**
 * Durable settings namespace for product-wide GUI onboarding facts. It stays
 * registered with its one historical field so existing documents keep a valid
 * home for the value; no shipped surface reads or writes it today.
 */
const ONBOARDING_SETTINGS_NAMESPACE = 'ui-onboarding'

interface OnboardingSettings {
  /** Version of the product notice the user last acknowledged. Retained only. */
  welcomeNoticeVersion?: string
}

const OnboardingSettingsSchema: z<OnboardingSettings> = z.object({
  welcomeNoticeVersion: z.string(),
})

/** Register the durable GUI-onboarding section when a settings provider exists. */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(
      ONBOARDING_SETTINGS_NAMESPACE,
      OnboardingSettingsSchema,
    )
  })
}
