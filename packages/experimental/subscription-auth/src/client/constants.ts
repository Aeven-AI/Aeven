/** Static tables for the Coding OAuth settings UI. */

import {
  CAPABILITY_SETTINGS_PATH,
  CODING_OAUTH_LOGIN_CANCEL_PATH,
  CODING_OAUTH_LOGIN_CODE_PATH,
  CODING_OAUTH_LOGIN_PATH,
  CODING_OAUTH_LOGOUT_PATH,
  CODING_OAUTH_MODELS_PATH,
  CODING_OAUTH_STATUS_PATH,
  CODEX_USAGE_PATH as CORE_CODEX_USAGE_PATH,
  GATEWAY_REVEAL_PATH as CORE_GATEWAY_REVEAL_PATH,
  GATEWAY_ROTATE_PATH as CORE_GATEWAY_ROTATE_PATH,
  GATEWAY_SETTINGS_PATH,
  IMAGINE_CREDENTIAL_STATUS_PATH,
  OAUTH_IMPORT_CANCEL_PATH,
  OAUTH_IMPORT_COMMIT_PATH,
  OAUTH_IMPORT_PREVIEW_PATH,
  OAUTH_IMPORT_SOURCES_PATH,
} from 'dsh-coding-oauth-core/contracts'
import type { GrokBuildSettingsKey } from './locales.ts'
import type {
  ProviderCardDefinition,
  SourceCommitAction,
  SourceConflict,
  SourceKind,
  SourcePreviewAction,
  SourceReason,
} from './types.ts'

export const STATUS_PATH = CODING_OAUTH_STATUS_PATH
export const LOGIN_PATH = CODING_OAUTH_LOGIN_PATH
export const LOGIN_CODE_PATH = CODING_OAUTH_LOGIN_CODE_PATH
export const LOGIN_CANCEL_PATH = CODING_OAUTH_LOGIN_CANCEL_PATH
export const LOGOUT_PATH = CODING_OAUTH_LOGOUT_PATH
export const MODELS_PATH = CODING_OAUTH_MODELS_PATH
export const SOURCES_PATH = OAUTH_IMPORT_SOURCES_PATH
export const SOURCES_PREVIEW_PATH = OAUTH_IMPORT_PREVIEW_PATH
export const SOURCES_COMMIT_PATH = OAUTH_IMPORT_COMMIT_PATH
export const SOURCES_CANCEL_PATH = OAUTH_IMPORT_CANCEL_PATH
export const CAPABILITIES_PATH = CAPABILITY_SETTINGS_PATH
export const CODEX_USAGE_PATH = CORE_CODEX_USAGE_PATH

/**
 * Per-provider usage reads. Mirrors the Host `subscriptionUsagePath`; the
 * client bundle cannot import Host modules, so the one path rule is restated
 * rather than shared.
 */
export const SUBSCRIPTION_USAGE_PATH_PREFIX = '/plugins/dsh-grok-build/usage/'

/**
 * Build the usage path for one provider slug.
 * @param slug - the provider slug as the status route spells it.
 * @returns the same-origin path to request.
 */
export function subscriptionUsagePath(slug: string): string {
  return `${SUBSCRIPTION_USAGE_PATH_PREFIX}${slug}`
}
export const IMAGINE_CREDENTIAL_PATH = IMAGINE_CREDENTIAL_STATUS_PATH
export const GATEWAY_PATH = GATEWAY_SETTINGS_PATH
export const GATEWAY_REVEAL_PATH = CORE_GATEWAY_REVEAL_PATH
export const GATEWAY_ROTATE_PATH = CORE_GATEWAY_ROTATE_PATH
export const POLL_INTERVAL_MS = 1_000
export const HOUR_MS = 60 * 60 * 1000

export const SOURCE_KINDS: readonly SourceKind[] = ['grok', 'codex', 'claude']
export const SOURCE_REASONS: readonly SourceReason[] = ['missing', 'unsafe', 'invalid', 'too_large']
export const SOURCE_CONFLICTS: readonly SourceConflict[] = [
  'none',
  'same_credential',
  'same_account',
  'different_account',
  'unknown_account',
  'unreadable_destination',
  'unsafe_destination',
]
export const SOURCE_PREVIEW_ACTIONS: readonly SourcePreviewAction[] = ['import', 'reuse', 'overwrite', 'blocked']
export const SOURCE_COMMIT_ACTIONS: readonly SourceCommitAction[] = ['imported', 'unchanged', 'overwritten']

export const SOURCE_DEFAULT_PATH: { readonly [K in SourceKind]: string } = {
  grok: '~/.grok/auth.json',
  codex: '~/.codex/auth.json',
  claude: '~/.claude/.credentials.json',
}

export const SOURCE_KIND_KEY: { readonly [K in SourceKind]: GrokBuildSettingsKey } = {
  grok: 'sourceKindGrok',
  codex: 'sourceKindCodex',
  claude: 'sourceKindClaude',
}

export const SOURCE_REASON_KEY: { readonly [K in SourceReason]: GrokBuildSettingsKey } = {
  missing: 'sourceReasonMissing',
  unsafe: 'sourceReasonUnsafe',
  invalid: 'sourceReasonInvalid',
  too_large: 'sourceReasonTooLarge',
}

export const SOURCE_CONFLICT_KEY: { readonly [K in SourceConflict]: GrokBuildSettingsKey } = {
  none: 'sourceConflictNone',
  same_credential: 'sourceConflictSameCredential',
  same_account: 'sourceConflictSameAccount',
  different_account: 'sourceConflictDifferentAccount',
  unknown_account: 'sourceConflictUnknownAccount',
  unreadable_destination: 'sourceConflictUnreadableDestination',
  unsafe_destination: 'sourceConflictUnsafeDestination',
}

export const SOURCE_PREVIEW_ACTION_KEY: { readonly [K in SourcePreviewAction]: GrokBuildSettingsKey } = {
  import: 'sourceActionImport',
  reuse: 'sourceActionReuse',
  overwrite: 'sourceActionOverwrite',
  blocked: 'sourceActionBlocked',
}

export const SOURCE_COMMIT_ACTION_KEY: { readonly [K in SourceCommitAction]: GrokBuildSettingsKey } = {
  imported: 'sourceCommitImported',
  unchanged: 'sourceCommitUnchanged',
  overwritten: 'sourceCommitOverwritten',
}


export const IMAGINE_SOURCE_KEY: { readonly [source: string]: GrokBuildSettingsKey } = {
  none: 'imagineSourceNone',
  env: 'imagineSourceEnv',
  environment: 'imagineSourceEnv',
  'xai-api-key': 'imagineSourceEnv',
  xai_api_key: 'imagineSourceEnv',
  'api-key': 'imagineSourceApiKey',
  api_key: 'imagineSourceApiKey',
  apikey: 'imagineSourceApiKey',
  key: 'imagineSourceApiKey',
  settings: 'imagineSourceApiKey',
  oauth: 'imagineSourceOAuth',
  'oauth-access': 'imagineSourceOAuth',
  'grok-cli-key': 'imagineSourceCliKey',
  'cli-key': 'imagineSourceCliKey',
}

// Render order is the account order in Settings: the subscriptions users
// reach for first, not the order they were implemented in.
export const PROVIDERS: readonly ProviderCardDefinition[] = [
  {
    slug: 'claude',
    route: 'claude-code-oauth',
    titleKey: 'claudeTitle',
    descriptionKey: 'claudeDescription',
    methods: ['browser'],
    recommended: 'browser',
    remoteRecommended: 'browser',
  },
  {
    slug: 'codex',
    route: 'codex-oauth',
    titleKey: 'codexTitle',
    descriptionKey: 'codexDescription',
    methods: ['device', 'browser'],
    recommended: 'browser',
    remoteRecommended: 'device',
  },
  {
    slug: 'grok',
    route: 'grok-build',
    titleKey: 'grokTitle',
    descriptionKey: 'grokDescription',
    methods: ['pkce', 'device'],
    recommended: 'pkce',
    remoteRecommended: 'device',
  },
]

export const GATEWAY_PORT_MIN = 1024
export const GATEWAY_PORT_MAX = 65_535
export const GATEWAY_RANDOM_PORT_MIN = 18_100
export const GATEWAY_RANDOM_PORT_MAX = 18_999
export const GATEWAY_RANDOM_RESERVED = new Set([22, 53, 3080, 7890, 9090, 18_080])

export const CONSUMED_PREVIEW_CODES = new Set([
  'preview_invalid',
  'preview_expired',
  'source_changed',
  'destination_changed',
  'confirm_required',
  'unsafe_destination',
])

export const PLUGIN_VERSION = '0.7.0'

/** Repository README, the one link the removed About tab carried. */
export const PLUGIN_DOCS_URL = 'https://github.com/Aeven-AI/dsh-subscription-auth#readme'
