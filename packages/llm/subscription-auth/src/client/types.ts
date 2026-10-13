/** Shared client types for the Coding OAuth settings UI; wire types mirror the Host status and usage routes. */

import type { GrokBuildSettingsKey } from './locales.ts'

/** A provider the settings page shows a card for. */
export type ProviderSlug = 'grok' | 'codex'
/** How a sign-in completes: a browser redirect to the local callback (`pkce`, `browser`) or a device code. */
export type LoginMethod = 'pkce' | 'device' | 'browser'

/** Mirrors the Host `SubscriptionModelView`: one model and whether the user keeps it on. */
export interface ModelView {
  id: string
  name: string
  /** The model reads images in a conversation. */
  imageInput: boolean
  /** The model generates images. */
  imageOutput: boolean
  selected: boolean
}

/** Grok's sign-in state from the status route. */
export type GrokStatus =
	| { status: 'signed-out'; grokImportAvailable: boolean }
	| { status: 'signing-in'; method: 'pkce' | 'device'; url?: string; userCode?: string; grokImportAvailable: boolean }
	| {
	  status: 'signed-in'
	  models: ModelView[]
	  grokImportAvailable: boolean
	  accounts: readonly AccountSummary[]
	  activeAccountId: string
	}
	| { status: 'error'; message: string; grokImportAvailable: boolean }

/** Codex's sign-in state from the status route. */
export type SubscriptionStatus = {
  provider: Exclude<ProviderSlug, 'grok'>
  route: string
  displayName: string
  loginMethods: readonly ('browser' | 'device')[]
  recommendedLoginMethod: 'browser' | 'device'
  models: ModelView[]
} & (
	| { status: 'signed-out' }
	| { status: 'signing-in'; method: 'browser' | 'device'; url?: string; userCode?: string }
	| { status: 'signed-in'; expiresAt?: number; accounts: readonly AccountSummary[]; activeAccountId: string }
	| { status: 'error'; message: string }
)

/** Token-free account row from AuthDocument v2 status. */
export interface AccountSummary {
  id: string
  label?: string
  expires: number
  accountId?: string
}

/** Any provider's sign-in state. */
export type ProviderStatus = GrokStatus | SubscriptionStatus

/** The status route's answer: how the page is being accessed, plugin compatibility, and every provider's state. */
export interface CodingOAuthStatus {
  accessMode: 'loopback' | 'ssh-tunnel' | 'trusted-https-proxy' | 'denied'
  uiOwner: 'standalone' | 'hub'
  compatibility: {
    coreAbi: string
    avnVersion: string | null
    status: 'healthy' | 'degraded' | 'incompatible'
    diagnostics: readonly unknown[]
  }
  providers: {
    grok: GrokStatus
    codex: SubscriptionStatus
  }
}

/** The login route's answer: the provider page to open and, for a device flow, the code to enter there. */
export interface LoginChallenge {
  method: LoginMethod
  url: string
  userCode?: string
}

/**
 * One provider card: its copy keys and its two sign-in methods. The browser
 * method completes through the Host's local callback, so it is used when this
 * page runs on the Host's own machine; the device method shows a code instead
 * and is used when the page is opened from another machine.
 */
export interface ProviderCardDefinition {
  slug: ProviderSlug
  titleKey: GrokBuildSettingsKey
  descriptionKey: GrokBuildSettingsKey
  localMethod: LoginMethod
  remoteMethod: LoginMethod
}

/** Mirrors the Host `UsageEntitlement`; see `src/usage-view.ts` for what each means. */
export type UsageEntitlementView = 'entitled' | 'no-subscription' | 'not-entitled' | 'redirected' | 'unknown'

/** Mirrors the Host `UsageWindowLabel`. `custom` defers to `labelText`. */
export type UsageWindowLabelView =
	| 'fiveHour'
	| 'weekly'
	| 'monthly'
	| 'session'
	| 'codeReview'
	| 'usage'
	| 'custom'

/** Mirrors the Host `UsageWindow`: what is left of one quota window and when it resets (epoch seconds). */
export interface UsageWindowView {
  id: string
  label: UsageWindowLabelView
  labelText?: string
  remainingPercent: number
  resetsAt?: number
}

/** Mirrors the Host `UsageCredits`. */
export type UsageCreditsView =
  | { kind: 'count'; remaining: number; unlimited?: boolean }
  | { kind: 'money'; currency: string; remaining: number; unlimited?: boolean }

/** Mirrors the Host `UsageProductLabel`. `custom` defers to `labelText`. */
export type UsageProductLabelView = 'grokBuild' | 'chat' | 'imagine' | 'custom'

/** Mirrors the Host `UsageBreakdownEntry`: one product's share of a pooled allowance. */
export interface UsageBreakdownView {
  id: string
  label: UsageProductLabelView
  labelText?: string
  usedPercent: number
}

/** Mirrors the Host `UsageGate`: the provider's own refusal wording and link. */
export interface UsageGateView {
  message?: string
  url?: string
  label?: string
}

/** Mirrors the Host `ProviderUsage`: one provider's complete usage answer. */
export interface UsageView {
  entitlement: UsageEntitlementView
  windows: UsageWindowView[]
  credits?: UsageCreditsView
  breakdown?: UsageBreakdownView[]
  tier?: string
  gate?: UsageGateView
  redirectUrl?: string
  fetchedAt?: number
}

/** Per-provider usage state held by the settings section. */
export interface UsageSlotView {
  usage?: UsageView
  error?: string
  loading: boolean
}

/** A failed plugin request: the Host's message plus its HTTP status and optional machine code. */
export interface PluginRequestError extends Error {
  status: number
  code?: string
}

/** What the settings shell injects into the section. */
export interface GrokBuildSettingsInjected {
  t: (key: GrokBuildSettingsKey, params?: Record<string, unknown>) => string
}

/** Props of the settings section; the shell may omit the injected translator. */
export type GrokBuildSettingsProps = Partial<GrokBuildSettingsInjected>
