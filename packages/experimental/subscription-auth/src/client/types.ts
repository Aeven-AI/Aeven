/** Shared client types for the Coding OAuth settings UI. */

import type { GrokBuildSettingsKey } from './locales.ts'

export type ProviderSlug = 'grok' | 'codex' | 'claude'
export type LoginMethod = 'pkce' | 'device' | 'browser'
export type CatalogSource = 'live' | 'cache' | 'fallback'
export type SourceKind = ProviderSlug
export type SourceReason = 'missing' | 'unsafe' | 'invalid' | 'too_large'
export type SourceConflict =
	| 'none'
	| 'same_credential'
	| 'same_account'
	| 'different_account'
	| 'unknown_account'
	| 'unreadable_destination'
	| 'unsafe_destination'
export type SourcePreviewAction = 'import' | 'reuse' | 'overwrite' | 'blocked'
export type SourceCommitAction = 'imported' | 'unchanged' | 'overwritten'
export type CapabilityFlagKey = 'codexSearch' | 'codexFast'
export type CapabilityLimitKey = 'searchResults'
export type CapabilitySettingKey = CapabilityFlagKey | CapabilityLimitKey
export type CopyField = 'openai' | 'anthropic' | 'key'

export type GrokStatus =
	| { status: 'signed-out'; grokImportAvailable: boolean }
	| { status: 'signing-in'; method: 'pkce' | 'device'; url?: string; userCode?: string; grokImportAvailable: boolean }
	| {
	  status: 'signed-in'
	  models: string[]
	  available: string[]
	  selected: string[]
	  catalogSource: CatalogSource
	  catalogError?: string
	  grokImportAvailable: boolean
	  accounts: readonly AccountSummary[]
	  activeAccountId: string
	}
	| { status: 'error'; message: string; grokImportAvailable: boolean }

export type SubscriptionStatus = {
  provider: Exclude<ProviderSlug, 'grok'>
  route: string
  displayName: string
  loginMethods: readonly ('browser' | 'device')[]
  recommendedLoginMethod: 'browser' | 'device'
  models: string[]
  available: string[]
  selected: string[]
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

export type ProviderStatus = GrokStatus | SubscriptionStatus

export interface CodingOAuthStatus {
  accessMode: 'loopback' | 'ssh-tunnel' | 'trusted-https-proxy' | 'denied'
  uiOwner: 'standalone' | 'hub'
  compatibility: {
    coreAbi: string
    dshVersion: string | null
    status: 'healthy' | 'degraded' | 'incompatible'
    diagnostics: readonly unknown[]
  }
  providers: {
    grok: GrokStatus
    codex: SubscriptionStatus
    claude: SubscriptionStatus
  }
}

export interface LoginChallenge {
  method: LoginMethod
  url: string
  userCode?: string
}

export interface ProviderCardDefinition {
  slug: ProviderSlug
  route: string
  titleKey: GrokBuildSettingsKey
  descriptionKey: GrokBuildSettingsKey
  methods: readonly LoginMethod[]
  recommended: LoginMethod
  /** Preferred method when the Settings UI is opened on a remote / non-loopback host. */
  remoteRecommended?: LoginMethod
}

export interface SourceStatus {
  kind: SourceKind
  displayPath: string
  available: boolean
  expiresAt?: number
  reason?: SourceReason
}

export interface SourcePreview {
  previewId: string
  kind: SourceKind
  displayPath: string
  expiresAt?: number
  ticketExpiresAt?: number
  conflict?: SourceConflict
  action?: SourcePreviewAction
  warnings: string[]
  confirmOverwriteRequired: boolean
}

export interface CapabilityFlags {
  codexSearch: boolean
  codexFast: boolean
}

export interface CapabilitySettingsView extends CapabilityFlags {
  searchResults: number
}

export interface CapabilitySnapshot {
  value: CapabilitySettingsView
  revision: number
  writable: boolean
}

/** Mirrors the Host `UsageEntitlement`; see `src/usage-view.ts` for what each means. */
export type UsageEntitlementView = 'entitled' | 'no-subscription' | 'not-entitled' | 'redirected' | 'unknown'

/** Mirrors the Host `UsageWindowLabel`. `custom` defers to `labelText`. */
export type UsageWindowLabelView =
	| 'fiveHour'
	| 'weekly'
	| 'weeklyOpus'
	| 'monthly'
	| 'session'
	| 'codeReview'
	| 'usage'
	| 'custom'

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

export interface UsageBreakdownView {
  id: string
  label: UsageProductLabelView
  labelText?: string
  usedPercent: number
}

export interface UsageGateView {
  message?: string
  url?: string
  label?: string
}

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

export interface ImagineCredentialView {
  configured: boolean
  source?: string
  writable?: boolean
}

export interface PluginRequestError extends Error {
  status: number
  code?: string
}

export interface GatewayView {
  enabled: boolean
  running: boolean
  bind: string
  port: number
  model: string | null
  keyConfigured: boolean
  keyAvailable: boolean
  keyHint: string
  models: string[]
  warning: string
}

export interface GrokBuildSettingsInjected {
  t: (key: GrokBuildSettingsKey, params?: Record<string, unknown>) => string
}

export type GrokBuildSettingsProps = Partial<GrokBuildSettingsInjected>
