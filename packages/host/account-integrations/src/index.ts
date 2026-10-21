/** Personal skill storage and account-scoped MCP connections exposed to Settings. */

import { createHash, randomUUID } from 'node:crypto'
import { rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { Context, Service, type Fiber } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { z } from 'zod'
import { Remote, TypertRemoteService } from '@aeven/typert-protocol'
import { defineDomain, domainTable, type Domain } from '@aeven/storage-domain'
import { assertNever } from '@aeven/util-values'
import { credentialKey, credentialRef } from '@aeven/credentials'
import { avnHomePath } from '@aeven/home-paths'
import { createScope, type Scope } from '@aeven/scope'
import type {} from '@aeven/identity-user'
import type { Agent, PreStepDecision } from '@aeven/agent'
import type {} from '@aeven/tools'
import type {} from '@aeven/workspace'
import type {} from '@aeven/agent-presets/types'
// Type-only: resolves the `agentPresets` Context augmentation this view reads its scope key from.
import type {} from '@aeven/agent-presets'
import type {} from '@aeven/skill-catalog'
import { isSkillName, type SkillCandidate } from '@aeven/skill'
import type { MailAccount, MailAccountId, MailError, MailSecret } from '@aeven/mail'
import * as mcp from '@aeven/mcp-client'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { googleConnection, googleService, verifyGoogle } from './google.ts'
import { microsoftConnection, microsoftService, verifyMicrosoft } from './microsoft.ts'
import { publicToolName } from '@aeven/mcp-client'
import { parsePersonalSkill } from './skills.ts'
import { ReverseEngineeringRuntime, type ReverseEngineeringConfig } from './reverse-engineering.ts'
import { resolveFfmpegBinary, resolveWhatsAppBinary, WhatsAppDaemon } from './whatsapp.ts'
import { resolveTelegramEntry, TelegramDaemon, type TelegramCredentials, type TelegramDaemonStatus } from './telegram.ts'
import { discordGuildIcon, resolveDiscordEntry, DISCORD_ADMIN_PERMISSIONS, DISCORD_CURATED_PERMISSIONS, type DiscordGuild } from './discord.ts'
import { isSlackReadTool, slackConnectorId, SLACK_DIRECT_MESSAGE_SCOPES, SLACK_MCP_ENDPOINT, SLACK_WORKSPACE_SCOPES, type SlackWorkspace } from './slack.ts'
import { isSlackConsentFailure, probeSlackToken, revokeSlackToken, refreshSlackToken, SlackLoginError, startSlackLogin, type SlackLogin, type SlackToken } from './slack-login.ts'
import { connectorCredential, type PendingConsent } from './oauth.ts'
import { BrokerError, ConnectorBroker, type ConsentStatus, type IssuedToken } from './broker.ts'
import type { AccountIntegrationsView, CatalogSkillView, ConnectorAuthorization, ConnectorCreateRequest, ConnectorId, ConnectorProvider, ConnectorProviderView, DiscordConnectorSettings, PersonalSkillView, EmailConnectionFailure, EmailConnectorSettings, EmailConnectionRequest, EmailConnectionResult, EmailConnectionUpdate, SkillCatalogView, SkillSetup, SkillViewId, SkillUploadFile, SlackConnectorSettings, TelegramConnectorSettings, TelegramPairingView, WhatsAppPairingView } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Signed-in account integration management. */
    accountIntegrations: AccountIntegrations
  }
}

/** Deployment upload, network, and connector settings; no connector credential is configured here. */
export interface Config {
  /** Private REA/Ghidra runtime installed when an enabled account skill is first invoked. */
  reverseEngineering?: ReverseEngineeringConfig
  /** Largest decoded skill bundle. */
  maxSkillBytes: number
  /** MCP discovery, tool, and OAuth request budget. */
  timeoutMs: number
  /** Maximum time between starting a consent and the provider returning to the Aeven API. */
  consentLifetimeMs: number
  /**
   * Aeven API origin whose connector broker holds every provider credential: OAuth
   * client secrets and refresh tokens, the Discord bot token, and the Telegram
   * application identifiers. Absent leaves Google, GitHub, Discord, and Telegram unavailable.
   */
  apiUrl?: string
  /** Credential reference holding each signed-in user's Aeven access token; the broker authenticates it. */
  credentialRef: string
  /** Email accounts one signed-in user may connect. */
  maxEmailAccounts: number
  /** WhatsApp numbers one signed-in user may link. */
  maxWhatsAppAccounts: number
  /** Telegram accounts one signed-in user may sign in. */
  maxTelegramAccounts: number
  /** Discord guilds one signed-in user may install the Aeven bot into. */
  maxDiscordGuilds: number
  /** Slack workspaces one signed-in user may connect. */
  maxSlackWorkspaces: number
  /**
   * The deployment's Slack app client id, which is public because Slack's PKCE client is a public
   * client. Absent leaves Slack unavailable, and no Slack secret exists for this Host to hold.
   */
  slackClientId?: string
  /**
   * Loopback callback port the Slack app registered as `http://127.0.0.1:<port>/callback`. Slack
   * matches the registered redirect exactly, so this value and the application agree or the
   * consent fails at the redirect.
   */
  slackCallbackPort: number
  /** Whether a login also asks for direct-message search and history, which the app must register too. */
  slackDirectMessages: boolean
  /** Time a live Slack token is trusted before Slack is asked again. */
  slackVerifyIntervalMs: number
  /** WhatsApp daemon executable; defaults to the platform package installed for this host. */
  whatsappBinaryPath?: string
  /** Telegram daemon entry; defaults to the vendored package installed for this host. */
  telegramEntryPath?: string
  /** Discord connector server entry; defaults to the vendored package installed for this host. */
  discordEntryPath?: string
  /** Discord permissions the install link requests, as a base-10 bitfield string. */
  discordPermissions?: string
  /** Whether connected guilds also serve the administration and moderation tools. */
  discordAdminTools: boolean
  /** Time a verified guild membership is trusted before Discord is asked again. */
  discordVerifyIntervalMs: number
  /** Time allowed for a Telegram daemon to bind its loopback port. */
  telegramStartupTimeoutMs: number
  /** Time a stopping Telegram daemon gets to exit cleanly before it is killed. */
  telegramStopGraceMs: number
  /** Interval between sign-in state reads while a Telegram code or password is awaited. */
  telegramPairingPollMs: number
  /** First delay before restarting a Telegram daemon that exited unexpectedly; doubles per consecutive failure. */
  telegramRestartDelayMs: number
  /** Longest restart delay; a daemon that ran this long resets the failure count. */
  telegramMaxRestartDelayMs: number
  /** Time allowed for a WhatsApp daemon to bind its loopback port. */
  whatsappStartupTimeoutMs: number
  /** Time a stopping WhatsApp daemon gets to exit cleanly before it is killed. */
  whatsappStopGraceMs: number
  /** Interval between pairing-state reads while a QR code is shown. */
  whatsappPairingPollMs: number
  /** First delay before restarting a WhatsApp daemon that exited unexpectedly; doubles per consecutive failure. */
  whatsappRestartDelayMs: number
  /** Longest restart delay; a daemon that ran this long resets the failure count. */
  whatsappMaxRestartDelayMs: number
}

const skillSchema = z.object({
  owner: z.string(), name: z.string().refine(isSkillName), description: z.string(), content: z.string(), enabled: z.boolean(),
  modelInvocable: z.boolean(), userInvocable: z.boolean(),
  resources: z.record(z.string().refine(path => !path.startsWith('/') && !path.includes('\\') && !/^[A-Za-z]:/.test(path)
    && path.split('/').every(part => part !== '' && part !== '.' && part !== '..')), z.string()), revision: z.uuid(),
  setup: z.object({ state: z.enum(['installing', 'ready', 'failed']), detail: z.string().optional() }).optional(),
})
const providers = ['github', 'gmail', 'google-drive', 'google-calendar', 'outlook', 'outlook-calendar', 'onedrive', 'sharepoint', 'teams', 'email', 'whatsapp', 'telegram', 'discord', 'slack', 'mcp'] as const satisfies readonly ConnectorProvider[]
const emailServerSchema = z.object({
  host: z.string().trim().min(1).max(253).regex(/^[A-Za-z0-9.-]+$/), port: z.number().int().min(1).max(65_535),
  security: z.enum(['tls', 'starttls']), username: z.string().trim().min(1).max(320),
})
const emailSettingsSchema = z.object({
  address: z.email(), aliases: z.array(z.email()).max(20),
  receive: emailServerSchema.extend({ protocol: z.enum(['imap', 'pop3']) }), send: emailServerSchema.optional(),
})
/** Email passwords kept as the connector's credential grant. */
const emailSecretSchema = z.object({ receivePassword: z.string().min(1), sendPassword: z.string().min(1).optional() })
/** The user token and refresh credential of one Slack workspace, kept as that connector's own grant. */
const slackTokenSchema = z.object({
  accessToken: z.string().min(1), refreshToken: z.string().min(1).optional(), expiresAt: z.number().optional(), scopes: z.array(z.string()),
})
const emailRequestSchema = emailSettingsSchema.extend({
  name: z.string().trim().min(1).max(100).optional(), receivePassword: z.string().min(1).max(1024),
  sendPassword: z.string().min(1).max(1024).optional(),
})
const emailUpdateSchema = emailSettingsSchema.extend({
  name: z.string().trim().min(1).max(100).optional(), receivePassword: z.string().min(1).max(1024).optional(),
  sendPassword: z.string().min(1).max(1024).optional(),
})
const connectorSchema = z.object({
  owner: z.string(), id: z.string().transform(value => value as ConnectorId),
  provider: z.enum(providers), name: z.string(),
  /** Absent for `email`, which has server settings instead of an MCP endpoint. */
  endpoint: z.url().optional(), enabled: z.boolean(),
  email: emailSettingsSchema.optional(),
  microsoft: z.object({ id: z.string(), name: z.string(), username: z.string(), tenantId: z.string() }).optional(),
  /** Set when a mail server rejected the stored password; the account needs to be added again. */
  authFailed: z.boolean().optional(),
  /** Linked account of a `whatsapp` row; `linked` turns false when the phone removes the device. */
  whatsapp: z.object({ phone: z.string(), profileName: z.string().optional(), linked: z.boolean() }).optional(),
  /** Signed-in account of a `telegram` row; `linked` turns false when Telegram rejects the session. */
  telegram: z.object({
    userId: z.string(), name: z.string().optional(), username: z.string().optional(), phone: z.string().optional(), linked: z.boolean(),
  }).optional(),
  /**
   * OAuth grant of a Google, Microsoft, or GitHub row, held by the Aeven API: the scopes it granted, and
   * `expired` once the API reports the provider revoked it and the user must consent again.
   */
  grant: z.object({ scopes: z.array(z.string()), expired: z.boolean().optional() }).optional(),
  /** Guild of a `discord` row; `linked` turns false when the bot leaves the guild. */
  discord: z.object({
    applicationId: z.string(), botUserId: z.string(), guildId: z.string(), guildName: z.string(),
    icon: z.string().optional(), installedById: z.string().optional(), installedByName: z.string().optional(), linked: z.boolean(),
  }).optional(),
  /**
   * Workspace of a `slack` row, with the scopes its grant carried. The user token lives in the
   * account's credential provider, never here; `linked` turns false once Slack refuses it.
   */
  slack: z.object({
    teamId: z.string(), teamName: z.string(), domain: z.string().optional(), userId: z.string(), userName: z.string(),
    scopes: z.array(z.string()), linked: z.boolean(),
  }).optional(),
})
const domainSpec = defineDomain({ name: 'account_integrations', version: 0, tables: {
  skills: domainTable<string, z.infer<typeof skillSchema>>(skillSchema),
  skill_preferences: domainTable<string, { enabled: boolean }>(z.object({ enabled: z.boolean() })),
  connectors: domainTable<ConnectorId, z.infer<typeof connectorSchema>>(connectorSchema),
} })
const createSchema = z.object({
  provider: z.enum(providers), name: z.string().trim().min(1).max(100),
  endpoint: z.url().optional(), token: z.string().min(1).optional(),
})
/** Drop absent optional fields that zod reports as `undefined`. */
function emailSettings(value: z.infer<typeof emailSettingsSchema>): EmailConnectorSettings {
  const { send, ...rest } = value
  return { ...rest, ...send !== undefined ? { send } : {} }
}

/** Drop an absent send password that zod reports as `undefined`. */
function emailSecret(value: z.infer<typeof emailSecretSchema>): MailSecret {
  return { receivePassword: value.receivePassword, ...value.sendPassword !== undefined ? { sendPassword: value.sendPassword } : {} }
}

/** Account identity as either the daemon or a stored connector row reports it. */
interface TelegramIdentityLike {
  /** The daemon's field name for the account id. */
  id?: string | undefined
  /** The stored row's field name for the account id. */
  userId?: string | undefined
  name?: string | undefined
  username?: string | undefined
  phone?: string | undefined
}

/** Project one account identity onto the connector settings Settings shows. */
function telegramSettings(value: TelegramIdentityLike): TelegramConnectorSettings {
  const userId = value.userId ?? value.id
  if (userId === undefined) throw new Error('Telegram account identity carries no user id')
  const { name, username, phone } = value
  return {
    userId, ...name === undefined ? {} : { name }, ...username === undefined ? {} : { username },
    ...phone === undefined ? {} : { phone },
  }
}

/**
 * Connector id of one Telegram account of one user, the same for every sign-in of that account, so the
 * account's tool names (`mcp__<provider>_<id prefix>__…`) survive signing it in again.
 * @param owner - Aeven account that signs the Telegram account in.
 * @param userId - Telegram user id.
 * @returns a UUID-formatted id derived from both.
 */
function telegramConnectorId(owner: string, userId: string): ConnectorId {
  const hex = createHash('sha256').update(`telegram\0${owner}\0${userId}`).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${hex.slice(18, 20)}-${hex.slice(20, 32)}` as ConnectorId
}

/** Project one daemon status onto the sign-in view Settings renders. */
function telegramView(id: ConnectorId, status: TelegramDaemonStatus): TelegramPairingView {
  const reason = status.reason
  return {
    id, state: telegramPairingState(status.state),
    ...status.phone === undefined ? {} : { phone: status.phone },
    ...reason === undefined ? {} : { reason },
    ...status.identity === undefined ? {} : { account: telegramSettings(status.identity) },
    ...status.qr === undefined ? {} : { qr: status.qr },
  }
}

/** Map the daemon's sign-in state onto the state Settings renders. */
function telegramPairingState(state: TelegramDaemonStatus['state']): TelegramPairingView['state'] {
  switch (state) {
    case 'login': return 'starting'
    case 'code': return 'code'
    case 'qr': return 'qr'
    case 'password': return 'password'
    case 'authorized': return 'connected'
    case 'unlinked': return 'unlinked'
    case 'failed': return 'failed'
    default: return assertNever(state)
  }
}

/** Project one stored guild row onto the Discord settings Settings shows. */
function discordSettings(value: NonNullable<z.infer<typeof connectorSchema>['discord']>): DiscordConnectorSettings {
  return {
    applicationId: value.applicationId, botUserId: value.botUserId, guildId: value.guildId,
    guildName: value.guildName, linked: value.linked,
    ...value.icon === undefined ? {} : { icon: value.icon },
    ...value.installedById === undefined ? {} : { installedById: value.installedById },
    ...value.installedByName === undefined ? {} : { installedByName: value.installedByName },
  }
}

/** Project one stored workspace row onto the Slack settings Settings shows. */
function slackSettings(value: NonNullable<z.infer<typeof connectorSchema>['slack']>): SlackConnectorSettings {
  return {
    teamId: value.teamId, teamName: value.teamName, userId: value.userId, userName: value.userName,
    scopes: value.scopes, linked: value.linked,
    ...value.domain === undefined ? {} : { domain: value.domain },
  }
}

/**
 * Connector id of one Discord guild of one user, the same for every install into that guild, so the
 * guild's tool names (`mcp__<provider>_<id prefix>__…`) survive installing it again.
 * @param owner - Aeven account that installed the Aeven bot into the guild.
 * @param guildId - Discord guild id.
 * @returns a UUID-formatted id derived from both.
 */
function discordConnectorId(owner: string, guildId: string): ConnectorId {
  const hex = createHash('sha256').update(`discord\0${owner}\0${guildId}`).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${hex.slice(18, 20)}-${hex.slice(20, 32)}` as ConnectorId
}

const uploadsSchema = z.array(z.object({ path: z.string().min(1), base64: z.string() })).min(1)
/** Google and GitHub sign in through OAuth grants the Aeven API holds. */
const brokeredProviders = new Set<ConnectorProvider>(['github', 'gmail', 'google-drive', 'google-calendar', 'outlook', 'outlook-calendar', 'onedrive', 'sharepoint', 'teams'])
/** Key of the Telegram application identifiers cached after the first signed-in fetch, so linked accounts start at boot. */
const telegramAppKey = credentialKey('account-integrations', 'telegram-application')
/** Time before an issued access token's expiry at which the Host asks for a new one. */
const TOKEN_MARGIN_MS = 60_000

/** Connector-owned skill names; bodies and resources remain in the skill registry. */
const connectorSkills: Record<ConnectorProvider, readonly string[]> = {
  'google-drive': ['google-drive', 'google-docs', 'google-sheets', 'google-slides', 'google-drive-comments', 'google-forms'],
  gmail: ['gmail'], 'google-calendar': ['google-calendar'], github: ['github'], outlook: ['outlook'], 'outlook-calendar': ['outlook-calendar'], onedrive: ['onedrive'], sharepoint: ['sharepoint'], teams: ['teams'], mcp: [], email: [], whatsapp: ['whatsapp'], telegram: ['telegram'],
  discord: ['discord'], slack: ['slack'],
}

/** Provider names the model's tool index shows beside each connector's own name. */
const providerTitles: Record<ConnectorProvider, string> = {
  github: 'GitHub', gmail: 'Gmail', 'google-drive': 'Google Drive', 'google-calendar': 'Google Calendar', outlook: 'Outlook mail',
  'outlook-calendar': 'Outlook Calendar', onedrive: 'OneDrive', sharepoint: 'SharePoint', teams: 'Microsoft Teams', mcp: 'MCP server',
  email: 'Email', whatsapp: 'WhatsApp', telegram: 'Telegram', discord: 'Discord', slack: 'Slack',
}

/** Connector tool names: `mcp__<provider>_<first 8 hex digits of the connector id>__<tool>`. */
const CONNECTOR_TOOL_NAME = /^mcp__([a-z-]+)_([a-f0-9]{8})__/

/**
 * MCP server name of one connector. The provider makes its tools readable in the
 * model's index; the id prefix keeps two accounts of one provider apart, and a
 * derived id (Telegram, Discord) keeps the names across signing in again.
 * @param id - the connector id.
 * @param provider - the connector's provider.
 * @returns the server name, at most 26 characters.
 */
function connectorServerName(id: string, provider: ConnectorProvider): string {
  return `${provider}_${id.replaceAll('-', '').slice(0, 8)}`
}

/** WhatsApp tools that only read the cache or the account; every other tool acts visibly and asks first. */
const whatsappReadTools = new Set([
  'list_messages', 'list_chats', 'get_chat', 'get_message_context', 'search_contacts', 'is_on_whatsapp', 'get_status', 'pairing_status',
  'download_media', 'get_poll_results', 'list_groups', 'get_group_info', 'get_blocklist', 'get_privacy_settings', 'request_sync',
])

/**
 * Telegram tools that only read the account; every other tool acts on a real account other people
 * see and asks first. This mirrors `TELEGRAM_READ_TOOLS` in `native/telegram-mcp/aeven/tools.ts`,
 * which the daemon's own suite pins against the served `readOnlyHint` annotations.
 */
const telegramReadTools = new Set([
  'whoami', 'list_chats', 'get_chat', 'list_members', 'find_public_chat',
  'get_history', 'search_messages', 'get_message', 'get_replies', 'get_unread', 'chat_digest',
  'list_media', 'download_media',
  'poll_results', 'list_scheduled', 'get_draft', 'random_member',
  'list_blocked', 'list_banned', 'list_invite_links',
])

/**
 * Discord tools that only read the guild; the connector mounts one server per guild, so no tool
 * takes a guild argument. This mirrors `DISCORD_CURATED_READ_TOOLS` in `native/discord-mcp/aeven/tools.ts`,
 * which that package's own suite pins against the served surface.
 */
const discordReadTools = new Set([
  'list_channels', 'get_channel', 'get_messages', 'get_thread', 'search_messages', 'list_members', 'get_guild_info',
])

/** Discord tools that post, react, upload, or open a thread: visible to other people, so the user approves first. */
const discordWriteTools = new Set([
  'send_message', 'reply_message', 'add_reaction', 'remove_reaction', 'send_file', 'create_thread',
])

/**
 * Discord administration and moderation tools, served only by a deployment that turns them on.
 * Each one changes the server for everyone, so it never runs on the same approval as a message.
 * This mirrors `DISCORD_ADMIN_TOOL_NAMES` in `native/discord-mcp/aeven/admin.ts`.
 */
const discordAdminTools = new Set([
  'list_roles', 'create_role', 'edit_role', 'delete_role', 'assign_role', 'remove_role',
  'list_bans', 'get_ban', 'ban_member', 'unban_member', 'timeout_member', 'clear_timeout', 'delete_messages',
  'kick_member', 'bulk_ban_members', 'get_member', 'edit_member', 'purge_messages',
  'create_channel', 'delete_channel', 'edit_channel', 'set_channel_permissions',
  'list_invites', 'revoke_invite', 'read_audit_log',
  'list_automod_rules', 'create_automod_rule', 'edit_automod_rule', 'delete_automod_rule',
  'edit_guild',
])

/** One linked number's supervised daemon. */
interface SupervisedWhatsApp {
  daemon: WhatsAppDaemon
  /** Settles when the daemon has bound its port; rejects when startup failed. */
  ready: Promise<void>
  /** False once the process exited. */
  alive: boolean
  /** Consecutive unexpected exits, used for restart backoff. */
  failures: number
  startedAt: number
  restart?: NodeJS.Timeout
}

/** A linking attempt; it becomes a connector row only once the phone has scanned the code. */
interface WhatsAppPairing {
  owner: string
  daemon: WhatsAppDaemon
  view: WhatsAppPairingView
  /** Set once the attempt reached a terminal state; the next read returns that state and forgets the attempt. */
  done: boolean
  /** Set while a status read is in flight, so overlapping polls cannot save the number twice. */
  busy: boolean
  poll?: NodeJS.Timeout
  expiry?: NodeJS.Timeout
}

/** One signed-in account's supervised daemon. */
interface SupervisedTelegram {
  daemon: TelegramDaemon
  /** Settles when the daemon has bound its port; rejects when startup failed. */
  ready: Promise<void>
  /** False once the process exited. */
  alive: boolean
  /** Consecutive unexpected exits, used for restart backoff. */
  failures: number
  startedAt: number
  restart?: NodeJS.Timeout
}

/** A sign-in attempt; it becomes a connector row only once Telegram authorized the account. */
interface TelegramPairing {
  owner: string
  daemon: TelegramDaemon
  view: TelegramPairingView
  /** Set once the attempt reached a terminal state; the next read returns that state and forgets the attempt. */
  done: boolean
  /** Set while a state read is in flight, so overlapping polls cannot save the account twice. */
  busy: boolean
  poll?: NodeJS.Timeout
  expiry?: NodeJS.Timeout
}

const connectorSkillNames = new Set(Object.values(connectorSkills).flat())

/** Reject plaintext credentials outside loopback and URLs with embedded credentials. */
function endpoint(value: string): string {
  const url = new URL(value)
  if (url.username || url.password || url.hash
    || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('connector URL requires HTTPS, or HTTP on loopback, without embedded credentials')
  }
  return url.href
}

/** Private filesystem account name; original account ids never become paths. */
function accountDirectory(owner: string): string {
  return createHash('sha256').update(owner).digest('hex')
}

/** Signed-in users manage their own integrations; each agent mounts only its owner's connectors. */
export default class AccountIntegrations extends TypertRemoteService {
  static inject = ['typert', 'identityUsers', 'storageDomain', 'credentials', 'skills', 'agents', 'tools', 'workspaceRegistry', 'subprocess']

  static Config: Schema<Config> = Schema.object({
    reverseEngineering: Schema.object({
      reaVersion: Schema.string().pattern(/^\d+\.\d+\.\d+$/).default('6.7.0'),
      ghidraRelease: Schema.string().pattern(/^Ghidra_\d+\.\d+\.\d+_build$/).default('Ghidra_12.1.4_build'),
      javaVersion: Schema.natural().min(21).default(21),
      timeoutMs: Schema.natural().min(1).default(900_000),
      retryDelayMs: Schema.natural().min(0).default(600_000),
      stopGraceMs: Schema.natural().min(1).default(5_000),
      outputMaxBytes: Schema.natural().min(1).default(64 * 1024),
    }),
    maxSkillBytes: Schema.natural().min(1).default(10 * 1024 * 1024),
    timeoutMs: Schema.natural().min(1).default(60_000),
    consentLifetimeMs: Schema.natural().min(1).default(600_000),
    maxEmailAccounts: Schema.natural().min(1).default(20),
    maxWhatsAppAccounts: Schema.natural().min(1).default(10),
    maxTelegramAccounts: Schema.natural().min(1).default(10),
    maxDiscordGuilds: Schema.natural().min(1).default(25),
    maxSlackWorkspaces: Schema.natural().min(1).default(10),
    slackClientId: Schema.string(),
    slackCallbackPort: Schema.natural().min(1).max(65_535).default(12_751),
    slackDirectMessages: Schema.boolean().default(false),
    slackVerifyIntervalMs: Schema.natural().min(1).default(300_000),
    whatsappBinaryPath: Schema.string(),
    telegramEntryPath: Schema.string(),
    discordEntryPath: Schema.string(),
    discordPermissions: Schema.string(),
    discordAdminTools: Schema.boolean().default(false),
    discordVerifyIntervalMs: Schema.natural().min(1).default(300_000),
    telegramStartupTimeoutMs: Schema.natural().min(1).default(15_000),
    telegramStopGraceMs: Schema.natural().min(1).default(5_000),
    telegramPairingPollMs: Schema.natural().min(100).default(1_500),
    telegramRestartDelayMs: Schema.natural().min(1).default(1_000),
    telegramMaxRestartDelayMs: Schema.natural().min(1).default(60_000),
    whatsappStartupTimeoutMs: Schema.natural().min(1).default(15_000),
    whatsappStopGraceMs: Schema.natural().min(1).default(5_000),
    whatsappPairingPollMs: Schema.natural().min(100).default(1_500),
    whatsappRestartDelayMs: Schema.natural().min(1).default(1_000),
    whatsappMaxRestartDelayMs: Schema.natural().min(1).default(60_000),
    apiUrl: Schema.string(),
    credentialRef: Schema.string().default('AEVEN_TOKEN'),
  })

  private domain!: Domain<typeof domainSpec>
  private reverseEngineering: ReverseEngineeringRuntime | undefined
  /** Install progress the runtime last reported, merged onto the reverse-engineering entry of the view. */
  private skillSetup: SkillSetup | undefined
  private invalidateSkills: () => void = () => {}
  private readonly connected = new Set<ConnectorId>()
  private readonly consents = new Map<string, PendingConsent>()
  private readonly consentFailures = new Map<string, { authorizationFailure: 'admin-consent-required' | 'failed'; adminConsentUrl?: string }>()
  private readonly whatsappBinary: string | undefined
  private readonly ffmpegBinary: string | undefined
  private readonly telegramEntry: string | undefined
  private readonly discordEntry: string | undefined
  /** The Aeven API's connector broker; undefined without an `apiUrl`. */
  private readonly broker: ConnectorBroker | undefined
  /** Access tokens the broker issued, per connector, kept until shortly before they expire. */
  private readonly issuedTokens = new Map<ConnectorId, IssuedToken>()
  private readonly whatsapp = new Map<ConnectorId, SupervisedWhatsApp>()
  private readonly telegram = new Map<ConnectorId, SupervisedTelegram>()
  /** Last guild-membership verdict per connector, so a conversation step does not ask Discord again. */
  private readonly discordPresence = new Map<ConnectorId, { at: number; present: boolean }>()
  /** Workspace logins in flight, keyed by the connector each is about to store. */
  private readonly slackLogins = new Map<ConnectorId, { owner: string; cancel: () => void; completion: Promise<void> }>()
  /** Last token verdict per workspace, so a settings read does not ask Slack every time. */
  private readonly slackPresence = new Map<ConnectorId, { at: number; present: boolean }>()
  private readonly pairings = new Map<ConnectorId, WhatsAppPairing>()
  private readonly telegramPairings = new Map<ConnectorId, TelegramPairing>()
  /**
   * Connector synchronization in flight per agent. A conversation starts connecting its accounts when it is created,
   * and its first step waits for that same run instead of starting a second one.
   */
  private readonly syncing = new Map<Agent, Promise<void>>()
  private readonly mounts = new Map<Agent, {
    scope: Scope
    connections: Map<ConnectorId, { key: string; fiber: Fiber }>
  }>()

  /**
   * @param ctx - identity, durable storage, credentials, skills, and tools context.
   * @param config - deployment limits and provider registrations.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'accountIntegrations')
    this.whatsappBinary = resolveWhatsAppBinary(config.whatsappBinaryPath)
    this.ffmpegBinary = resolveFfmpegBinary()
    this.telegramEntry = resolveTelegramEntry(config.telegramEntryPath)
    this.discordEntry = resolveDiscordEntry(config.discordEntryPath)
    if (config.discordPermissions !== undefined && !/^\d+$/.test(config.discordPermissions)) {
      throw new Error('discordPermissions must be a base-10 permission bitfield')
    }
    const ref = credentialRef(config.credentialRef)
    this.broker = config.apiUrl === undefined ? undefined : new ConnectorBroker({
      apiUrl: endpoint(config.apiUrl),
      timeoutMs: config.timeoutMs,
      sessionToken: async owner => (await this.ctx.credentials.resolve(ref, owner).catch(() => undefined))?.value,
    })
  }

  /** Open account data and register reversible skill and tool contributions. */
  async [Service.init](): Promise<void> {
    this.domain = await this.ctx.storageDomain.open(domainSpec)
    this.ctx.effect(() => () => this.domain.close(), 'account-integrations: storage')
    for (const [id, connector] of this.domain.table('connectors').entries()) {
      if (await this.isConnected(connector)) this.connected.add(id)
    }
    this.ctx.effect(() => {
      // Signed-in accounts and linked numbers run continuously, so each daemon keeps its
      // Telegram or WhatsApp connection warm between conversations.
      for (const [id, connector] of this.domain.table('connectors').entries()) {
        if (connector.provider === 'whatsapp' && connector.enabled && connector.whatsapp?.linked === true && this.whatsappBinary !== undefined) {
          this.runWhatsApp(id, connector.owner).catch(() => {
            // A daemon that cannot start now is started again by the next conversation step or Settings action.
          })
        }
        if (connector.provider === 'telegram' && connector.enabled && connector.telegram?.linked === true && this.telegramEntry !== undefined) {
          this.runTelegram(id, connector.owner).catch(() => {
            // A daemon that cannot start now is started again by the next conversation step or Settings action.
          })
        }
      }
      return async () => {
        const pairings = [...this.pairings.keys()]
        const telegramPairings = [...this.telegramPairings.keys()]
        await Promise.all([
          ...[...this.whatsapp.keys()].map(id => this.stopWhatsApp(id)),
          ...[...this.telegram.keys()].map(id => this.stopTelegram(id)),
          ...pairings.map(id => this.endPairing(id, 'expired')),
          ...telegramPairings.map(id => this.endTelegramPairing(id, 'expired')),
        ])
        this.pairings.clear()
        this.telegramPairings.clear()
      }
    }, 'account-integrations: WhatsApp and Telegram daemons')
    this.ctx.effect(() => this.ctx.skills.registerProvider((control) => {
      this.invalidateSkills = control.invalidate
      return {
        name: 'account-integrations',
        list: options => Promise.resolve(options.owner === undefined ? [] : [...this.domain.table('skills').entries()]
          .filter(([, skill]) => skill.owner === options.owner && skill.enabled)
          .map(([key, skill]): SkillCandidate => ({
            name: skill.name, description: skill.description, source: 'account', provider: 'account-integrations',
            invocation: { modelInvocable: skill.modelInvocable, userInvocable: skill.userInvocable },
            rank: 350, locator: key,
          }))),
        get: async (candidate, options) => {
          const skill = this.domain.table('skills').get(String(candidate.locator))
          if (skill === undefined || skill.owner !== options.owner || !skill.enabled) return undefined
          const directory = avnHomePath('accounts', accountDirectory(skill.owner), 'skills', skill.name, skill.revision)
          for (const [path, data] of Object.entries(skill.resources)) {
            const file = join(directory, path)
            await mkdir(dirname(file), { recursive: true, mode: 0o700 })
            await writeFile(file, Buffer.from(data, 'base64'), { mode: 0o600 })
          }
          return { ...candidate, content: skill.content, resourceBase: { kind: 'directory' as const, path: directory } }
        },
      }
    }), 'account-integrations: personal skill provider')
    this.ctx.effect(() => this.ctx.skills.registerInvocationPolicy((name, options) =>
      (connectorSkillNames.has(name) || options.owner === undefined || this.domain.table('skill_preferences').get(`${accountDirectory(options.owner)}:${name}`)?.enabled !== false)
        && this.skillConnectorAvailable(name, options.owner)),
    'account-integrations: skill invocation preferences')
    this.ctx.inject(['mail'], (ctx) => {
      ctx.effect(() => ctx.mail.registerSource({
        id: 'account-integrations',
        list: owner => Promise.resolve([...this.domain.table('connectors').entries()].flatMap(([id, connector]): MailAccount[] =>
          connector.owner === owner && connector.provider === 'email' && connector.enabled && connector.authFailed !== true && connector.email !== undefined
            ? [{ id: id as string as MailAccountId, owner, settings: emailSettings(connector.email) }]
            : [])),
        secret: async (account) => {
          const record = await this.ctx.credentials.readRecord(connectorCredential(account.owner, account.id as string as ConnectorId))
          const secret = record?.kind === 'grant' ? emailSecretSchema.safeParse(record.payload) : undefined
          return secret?.success === true ? emailSecret(secret.data) : undefined
        },
        authenticationFailed: async (account) => {
          const id = account.id as string as ConnectorId
          if (this.domain.table('connectors').get(id)?.owner !== account.owner) return
          await this.domain.table('connectors').update(id, connector => ({ ...connector, authFailed: true }))
          this.connected.delete(id)
        },
      }), 'account-integrations: mail account source')
    })
    // A new conversation connects its accounts while the person is still typing its first message.
    this.ctx.on('agent/created', ({ agent }) => {
      this.syncOnce(agent).catch((error: unknown) => {
        this.ctx.logger('account-integrations').warn(`connecting accounts for a new conversation failed: ${error instanceof Error ? error.message : String(error)}`)
      })
    })
    this.ctx.on('agent/pre-step', async ({ agent }, next): Promise<PreStepDecision> => {
      await this.syncOnce(agent)
      const owner = agent.session.header.owner
      const skill = owner === undefined ? undefined : this.domain.table('skills').get(`${accountDirectory(owner)}:reverse-engineering`)
      if (skill?.enabled === true && this.config.reverseEngineering !== undefined) {
        // Enabling the skill already started the install; this call mounts it for the agent that needs it.
        // A request never waits for the download, and a failed setup never fails the request.
        this.reverseRuntime().start(agent)
      }
      return next()
    })
    this.ctx.on('tools/pre-execute', async (exec, next) => {
      const match = CONNECTOR_TOOL_NAME.exec(exec.name)
      if (match !== null) {
        const connector = [...this.domain.table('connectors').entries()]
          .find(([id, candidate]) => candidate.provider === match[1] && connectorServerName(id, candidate.provider) === `${match[1]}_${match[2]}`)?.[1]
        if (connector === undefined) {
          return { kind: 'deny', reason: 'This connector no longer exists: its account was unlinked. Search the tool catalog for the tools of the account that replaced it.' }
        }
        if (connector.owner !== exec.agent?.session.header.owner) {
          return { kind: 'deny', reason: 'This connector is unavailable for the conversation owner.' }
        }
        if (!connector.enabled) {
          return { kind: 'deny', reason: 'This connector is turned off. The user can turn it on in Settings → Connectors.' }
        }
        if (!await this.isConnected(connector)) {
          return { kind: 'deny', reason: 'This connector\'s account is signed out. The user has to sign it in again in Settings → Connectors.' }
        }
        const google = googleService(connector.provider)
        if (google !== undefined) {
          if (connector.grant?.scopes.includes(google.scopes[0]) !== true) {
            return { kind: 'deny', reason: 'Reconnect this Google account in Settings to grant the required permissions.' }
          }
          if (exec.name.endsWith('__workspace_raw')) {
            const args = exec.arguments as { service: string; path: string[] }
            if (!args.path.every(part => /^[A-Za-z][A-Za-z0-9]*$/.test(part))) {
              return { kind: 'deny', reason: 'Workspace API paths must contain resource and method names, without CLI options or file paths.' }
            }
            const [, method] = args.path
            const formEdit = args.service === 'forms' && args.path.length === 2 && args.path[0] === 'forms'
              && method !== undefined && /^(create|batchUpdate)$/.test(method)
            const last = args.path.at(-1)
            if (!formEdit && (last === undefined || !/^(get|list|export|download)$/i.test(last))) {
              return { kind: 'ask', allowSession: `${exec.name}:${args.service}:${args.path.join('.')}`, allowSessionCoverage: 'account', reason: 'Approve this change to your connected Google account.' }
            }
          }
          if (/__(gmail_send_draft|drive_share|drive_trash|calendar_delete_event)$/.test(exec.name)) {
            return { kind: 'ask', allowSession: exec.name, allowSessionCoverage: 'account', reason: 'Approve sending, sharing, or deleting through your connected Google account.' }
          }
        }
        const microsoft = microsoftService(connector.provider)
        if (microsoft !== undefined) {
          const serverName = connectorServerName(connector.id, connector.provider)
          if (microsoft.read.some(tool => publicToolName(serverName, tool) === exec.name)) return next()
          if (microsoft.write.some(tool => publicToolName(serverName, tool) === exec.name)) {
            return { kind: 'ask', allowSession: exec.name, allowSessionCoverage: 'account', reason: 'Approve this change through your connected Microsoft account.' }
          }
          return { kind: 'deny', reason: 'This tool is outside the connected Microsoft service.' }
        }
        if (connector.provider === 'whatsapp' && !whatsappReadTools.has(exec.name.slice(match[0].length))) {
          return { kind: 'ask', allowSession: exec.name, allowSessionCoverage: 'account', reason: 'Approve this action on your linked WhatsApp number. Other people can see it.' }
        }
        if (connector.provider === 'telegram' && !telegramReadTools.has(exec.name.slice(match[0].length))) {
          return { kind: 'ask', allowSession: exec.name, allowSessionCoverage: 'account', reason: 'Approve this action on your signed-in Telegram account. Other people can see it.' }
        }
        if (connector.provider === 'discord') {
          const tool = exec.name.slice(match[0].length)
          if (discordReadTools.has(tool)) return next()
          if (discordWriteTools.has(tool)) {
            return { kind: 'ask', allowSession: exec.name, allowSessionCoverage: 'account', reason: 'Approve this action on your connected Discord server. Other people can see it.' }
          }
          // Administration and moderation change the server for everyone, so they never ride on a message approval.
          return { kind: 'ask', allowSession: exec.name, allowSessionCoverage: 'account', reason: discordAdminTools.has(tool)
            ? 'Approve this Discord administration action: it changes the server for everyone.'
            : 'Approve this unrecognized action on your connected Discord server.' }
        }
        if (connector.provider === 'slack') {
          const tool = exec.name.slice(match[0].length)
          if (isSlackReadTool(tool)) return next()
          // Slack owns these names, so an unrecognized one asks rather than posting unreviewed.
          return { kind: 'ask', allowSession: exec.name, allowSessionCoverage: 'account', reason: 'Approve this action on your connected Slack workspace. It will appear as you.' }
        }
      }
      return next()
    })
    this.ctx.effect(() => () => {
      this.consents.clear()
      this.consentFailures.clear()
      this.issuedTokens.clear()
      this.connected.clear()
      this.discordPresence.clear()
      for (const [, pending] of this.slackLogins) pending.cancel()
      this.slackLogins.clear()
      this.mounts.clear()
    }, 'account-integrations: connector scopes')
  }

  /**
   * Read the caller's integrations without exposing credentials.
   * @returns the account's own skills, personal connections, and deployment sign-in availability.
   */
  @Remote
  async list(): Promise<AccountIntegrationsView> {
    const owner = this.owner()
    // Settings reads the list when the reader returns from a provider's consent window, so
    // this is where a consent the Aeven API completed becomes a connector.
    await this.settleConsents(owner)
    const connectors = [...this.domain.table('connectors').entries()].filter(([, item]) => item.owner === owner)
    const skills: AccountIntegrationsView['skills'] = [...this.domain.table('skills').entries()].filter(([, item]) => item.owner === owner)
      .map(([, item]) => ({ id: `${accountDirectory(owner)}:${item.name}` as SkillViewId, name: item.name, description: item.description, content: item.content, enabled: this.domain.table('skill_preferences').get(`${accountDirectory(owner)}:${item.name}`)?.enabled ?? item.enabled,
        files: Object.keys(item.resources), source: 'account', ...(item.setup === undefined ? {} : { setup: item.setup }) }))
      .sort((a, b) => a.name.localeCompare(b.name))
    // Discovered skills are not the account's to switch off, so the library lists none of them.
    // A connector-owned skill documents the connector that decides its invocation instead.
    const connectorOwned = new Map<string, AccountIntegrationsView['skills'][number]>()
    const scope = await this.ctx.get('agentPresets')?.standingKeyFor()
    const views: (string | undefined)[] = [undefined, ...this.ctx.workspaceRegistry.list()
      .filter(workspace => workspace.owner === owner && workspace.kind === 'folder')
      .map(workspace => workspace.path)]
    for (const cwd of views) {
      const options = { owner, cwd, scope }
      for (const skill of await this.ctx.skills.list(options)) {
        if (skill.provider === 'account-integrations' || !connectorSkillNames.has(skill.name) || connectorOwned.has(skill.name)) continue
        const definition = await this.ctx.skills.get(skill.name, options)
        if (definition === undefined) throw new Error('skill is no longer available')
        connectorOwned.set(skill.name, { id: createHash('sha256').update(`connector:${skill.name}`).digest('hex') as SkillViewId, name: skill.name, description: skill.description,
          content: definition.content, enabled: true, source: skill.source, files: [] })
      }
    }
    const connections = await Promise.all(connectors.map(async ([id, entry]) => {
      const item = entry.provider === 'whatsapp' ? await this.refreshWhatsApp(id, entry)
        : entry.provider === 'telegram' ? await this.refreshTelegram(id, entry)
          : entry.provider === 'slack' ? await this.refreshSlack(id, entry) : entry
      const connected = await this.isConnected(item)
      if (connected) this.connected.add(id)
      else this.connected.delete(id)
      return { id, name: item.name, provider: item.provider, enabled: item.enabled, connected,
        ...item.endpoint !== undefined ? { endpoint: item.endpoint } : {},
        ...item.email === undefined ? {} : { email: emailSettings(item.email) },
        ...item.microsoft !== undefined ? { microsoft: item.microsoft } : {},
        ...item.whatsapp === undefined ? {} : {
          whatsapp: {
            phone: item.whatsapp.phone,
            ...item.whatsapp.profileName === undefined ? {} : { profileName: item.whatsapp.profileName },
          },
        },
        ...item.telegram !== undefined ? { telegram: telegramSettings(item.telegram) } : {},
        ...item.discord === undefined ? {} : { discord: discordSettings(item.discord) },
        ...item.slack === undefined ? {} : { slack: slackSettings(item.slack) } }
    }))
    return {
      skills: skills.filter(skill => !connectorSkillNames.has(skill.name)).map(skill => this.withSetup(skill)), connectors: connections,
      providers: providers.map((provider): ConnectorProviderView => ({
        provider, ...this.consentFailures.get(`${owner}\0${provider}`), configured: provider === 'mcp' || (provider === 'email' ? this.ctx.get('mail') !== undefined
          : provider === 'whatsapp' ? this.whatsappBinary !== undefined
            : provider === 'telegram' ? this.telegramEntry !== undefined && this.broker !== undefined
              : provider === 'discord' ? this.discordEntry !== undefined && this.broker !== undefined
                : provider === 'slack' ? this.slackApplicationId !== undefined
                  : brokeredProviders.has(provider) && this.broker !== undefined),
        skills: connectorSkills[provider].flatMap((name) => {
          const skill = connectorOwned.get(name)
          return skill === undefined ? [] : [skill]
        }),
      })),
    }
  }

  /**
   * Read the vendored skill catalog this deployment ships.
   * @returns the catalog listing, or undefined when the deployment mounts no catalog.
   */
  @Remote
  // oxlint-disable-next-line typescript/require-await -- the Remote contract answers with a promise; this read has nothing to await.
  async catalog(): Promise<SkillCatalogView | undefined> {
    const catalog = this.ctx.get('skillCatalog')
    if (catalog === undefined) return undefined
    const view = catalog.list()
    return {
      commit: view.commit,
      synced: view.synced,
      categories: view.categories.map(category => ({ ...category })),
      skills: view.skills.map((skill): CatalogSkillView => ({ ...skill, keywords: [...skill.keywords] })),
    }
  }

  /**
   * Read one catalogued skill's instructions, so Settings can show a skill before it is installed.
   * @param name - catalogued skill name.
   * @returns the instruction body the skill installs with, or undefined when the deployment mounts no catalog
   * or does not catalogue that name.
   */
  @Remote
  // oxlint-disable-next-line typescript/require-await -- the Remote contract answers with a promise; this read has nothing to await.
  async catalogSkillContent(name: string): Promise<string | undefined> {
    const catalog = this.ctx.get('skillCatalog')
    if (catalog === undefined) return undefined
    if (!catalog.list().skills.some(skill => skill.name === name)) return undefined
    return parsePersonalSkill([catalog.bundle(name)], this.config.maxSkillBytes).content
  }

  /**
   * Install the private analysis engine when the account makes the skill available.
   *
   * Enabling the skill is the commit point for its cost: the downloads and the decompiler build start there, behind
   * the settings page, so the first request that needs the tools already has them.
   * @param name - skill name whose availability changed.
   * @param enabled - whether the account can now invoke it.
   */
  private prepareReverseEngineering(name: string, enabled: boolean): void {
    if (name !== 'reverse-engineering' || !enabled || this.config.reverseEngineering === undefined) return
    this.reverseRuntime().warm()
  }

  /**
   * The one runtime every agent shares, which reports its progress onto the installed skill's row so Settings can
   * show it beside that skill's switch.
   * @returns the shared runtime.
   * @throws Error when this deployment configures no analysis runtime.
   */
  private reverseRuntime(): ReverseEngineeringRuntime {
    const config = this.config.reverseEngineering
    if (config === undefined) throw new Error('reverse engineering is not configured')
    this.reverseEngineering ??= new ReverseEngineeringRuntime(this.ctx, config, (setup) => {
      this.skillSetup = setup
      this.invalidateSkills()
    })
    return this.reverseEngineering
  }

  /**
   * Retry the analysis runtime's install after a failure, which Settings offers from the failure dialog.
   */
  @Remote
  async retryReverseEngineering(): Promise<void> {
    this.reverseRuntime().retry()
    await Promise.resolve()
  }

  /**
   * Attach the analysis runtime's progress to the skill it prepares, whichever source lists that skill.
   * @param skill - one entry of the account's skill library.
   * @returns the entry, carrying `setup` while a runtime reports progress for it.
   */
  private withSetup(skill: PersonalSkillView): PersonalSkillView {
    return skill.name === 'reverse-engineering' && this.skillSetup !== undefined ? { ...skill, setup: this.skillSetup } : skill
  }

  /**
   * Install one catalogued skill into the account's library.
   * @param name - catalogued skill name.
   * @throws Error when the deployment mounts no catalog, or the name is not catalogued.
   */
  @Remote
  async installCatalogSkill(name: string): Promise<void> {
    const catalog = this.ctx.get('skillCatalog')
    if (catalog === undefined) throw new Error('this deployment ships no skill catalog')
    await this.importSkill([catalog.bundle(name)])
  }

  /**
   * Install or replace one personal bundle after validating every resource path.
   * @param files - uploaded SKILL.md and resources, or one ZIP/.skill file.
   */
  @Remote
  async importSkill(files: SkillUploadFile[]): Promise<void> {
    const owner = this.owner()
    const skill = parsePersonalSkill(uploadsSchema.parse(files), this.config.maxSkillBytes)
    await this.domain.table('skills').put(`${accountDirectory(owner)}:${skill.name}`, {
      owner, name: skill.name, description: skill.description, content: skill.content, enabled: this.domain.table('skill_preferences').get(`${accountDirectory(owner)}:${skill.name}`)?.enabled !== false,
      modelInvocable: skill.modelInvocable, userInvocable: skill.userInvocable,
      resources: Object.fromEntries([...skill.files].map(([path, bytes]) => [path, Buffer.from(bytes).toString('base64')])), revision: randomUUID(),
    })
    this.invalidateSkills()
    this.prepareReverseEngineering(skill.name, true)
  }

  /**
   * Change account invocation availability for a skill across its installed sources.
   * @param name - skill name visible in the account library.
   * @param enabled - invocation availability.
   */
  @Remote
  async setSkillEnabled(name: string, enabled: boolean): Promise<void> {
    if (!(await this.list()).skills.some(skill => skill.name === name)) throw new Error('skill is not in the account library')
    const key = `${accountDirectory(this.owner())}:${name}`
    await this.domain.table('skill_preferences').put(key, { enabled })
    if (this.domain.table('skills').get(key) !== undefined) {
      await this.domain.table('skills').update(key, skill => ({ ...skill, enabled }))
    }
    this.invalidateSkills()
    this.prepareReverseEngineering(name, enabled)
  }

  /**
   * Remove one caller-owned skill from discovery.
   * @param name - personal skill name.
   */
  @Remote
  async removeSkill(name: string): Promise<void> {
    await this.domain.table('skills').delete(`${accountDirectory(this.owner())}:${name}`)
    this.invalidateSkills()
  }

  /**
   * Verify a custom remote MCP server and store its optional bearer credential privately.
   * @param request - endpoint, name, and write-only access token.
   * @returns the new connector identity.
   */
  @Remote
  async connect(request: ConnectorCreateRequest): Promise<ConnectorId> {
    const owner = this.owner()
    const input = createSchema.parse(request)
    if (input.provider === 'email') throw new Error('email accounts are added with connectEmail')
    if (input.provider === 'whatsapp') throw new Error('WhatsApp numbers are linked with startWhatsAppPairing')
    if (input.provider === 'telegram') throw new Error('Telegram accounts are signed in with startTelegramPairing')
    if (input.provider === 'discord') throw new Error('Discord servers are installed with authorize')
    if (input.provider === 'slack') throw new Error('Slack workspaces are connected with authorize')
    if (input.provider !== 'mcp' && input.provider !== 'github') throw new Error('this provider requires OAuth sign-in')
    const url = endpoint(input.endpoint ?? (input.provider === 'github' ? 'https://api.githubcopilot.com/mcp/' : ''))
    await this.verifyMcp(url, input.token)
    const id = randomUUID() as ConnectorId
    await this.ctx.credentials.modifyRecord(connectorCredential(owner, id), () => Promise.resolve({
      kind: 'api-key', ...input.token === undefined ? {} : { key: input.token },
    }))
    await this.domain.table('connectors').put(id, { owner, id, provider: input.provider, name: input.name, endpoint: url, enabled: true })
    this.connected.add(id)
    this.invalidateSkills()
    return id
  }

  /**
   * Verify an IMAP or POP3 mailbox and its optional SMTP server, then store the account with its passwords kept privately.
   * @param request - server settings and write-only passwords.
   * @returns the new connector identity, or the reason and verification step that failed.
   */
  @Remote
  async connectEmail(request: EmailConnectionRequest): Promise<EmailConnectionResult> {
    const owner = this.owner()
    const parsed = emailRequestSchema.safeParse(request)
    if (!parsed.success) return { kind: 'failed', reason: 'invalid' }
    const { name, receivePassword, sendPassword, ...fields } = parsed.data
    const settings = emailSettings(fields)
    const existing = [...this.domain.table('connectors').entries()].map(([, connector]) => connector).filter(connector => connector.owner === owner && connector.provider === 'email')
    if (existing.some(connector => connector.email?.address.toLowerCase() === settings.address.toLowerCase())) return { kind: 'failed', reason: 'duplicate' }
    if (existing.length >= this.config.maxEmailAccounts) return { kind: 'failed', reason: 'limit' }
    const secret = { receivePassword, ...sendPassword !== undefined ? { sendPassword } : {} }
    const failure = await this.probeEmail(settings, secret)
    if (failure !== undefined) return failure
    const id = randomUUID() as ConnectorId
    await this.ctx.credentials.modifyRecord(connectorCredential(owner, id), () => Promise.resolve({ kind: 'grant', payload: secret }))
    await this.domain.table('connectors').put(id, { owner, id, provider: 'email', name: name ?? settings.address, email: settings, enabled: true })
    this.connected.add(id)
    return { kind: 'connected', id }
  }

  /**
   * Change an email account's settings, re-verifying the servers before saving; an absent password keeps the stored one.
   * @param id - caller-owned email connector.
   * @param request - server settings and optional replacement passwords.
   * @returns the connector identity, or the reason and verification step that failed.
   */
  @Remote
  async updateEmail(id: ConnectorId, request: EmailConnectionUpdate): Promise<EmailConnectionResult> {
    const owner = this.owner()
    const saved = this.domain.table('connectors').get(id)
    if (saved === undefined || saved.owner !== owner || saved.provider !== 'email') throw new Error('connector not found')
    const parsed = emailUpdateSchema.safeParse(request)
    if (!parsed.success) return { kind: 'failed', reason: 'invalid' }
    const { name, receivePassword, sendPassword, ...fields } = parsed.data
    const settings = emailSettings(fields)
    const others = [...this.domain.table('connectors').entries()].filter(([other, connector]) => other !== id && connector.owner === owner && connector.provider === 'email')
    if (others.some(([, connector]) => connector.email?.address.toLowerCase() === settings.address.toLowerCase())) return { kind: 'failed', reason: 'duplicate' }
    const record = await this.ctx.credentials.readRecord(connectorCredential(owner, id))
    const stored = record?.kind === 'grant' ? emailSecretSchema.safeParse(record.payload) : undefined
    const previous = stored?.success === true ? emailSecret(stored.data) : undefined
    const nextReceive = receivePassword ?? previous?.receivePassword
    if (nextReceive === undefined) return { kind: 'failed', reason: 'invalid' }
    const nextSend = sendPassword ?? (receivePassword === undefined ? previous?.sendPassword : undefined)
    const secret = { receivePassword: nextReceive, ...nextSend !== undefined ? { sendPassword: nextSend } : {} }
    const failure = await this.probeEmail(settings, secret)
    if (failure !== undefined) return failure
    await this.ctx.credentials.modifyRecord(connectorCredential(owner, id), () => Promise.resolve({ kind: 'grant', payload: secret }))
    await this.domain.table('connectors').put(id, { owner, id, provider: 'email', name: name ?? settings.address, email: settings, enabled: saved.enabled })
    this.connected.add(id)
    return { kind: 'connected', id }
  }

  /** Verify email settings, translating a probe failure into the reason and step shown in Settings. */
  private async probeEmail(settings: EmailConnectorSettings, secret: MailSecret): Promise<EmailConnectionResult | undefined> {
    const mail = this.ctx.get('mail')
    if (mail === undefined) return { kind: 'failed', reason: 'unavailable' }
    try {
      await mail.probe(settings, secret)
      return undefined
    } catch (error) {
      const { MailError } = await import('@aeven/mail')
      if (!(error instanceof MailError)) return { kind: 'failed', reason: 'other' }
      const reasons: Partial<Record<MailError['code'], EmailConnectionFailure>> = {
        MAIL_AUTHENTICATION: 'authentication', MAIL_CONNECTION: 'connection', MAIL_TLS: 'tls', MAIL_INVALID: 'invalid', MAIL_UNSUPPORTED: 'invalid',
      }
      return { kind: 'failed', reason: reasons[error.code] ?? 'other', ...error.step !== undefined ? { step: error.step } : {} }
    }
  }

  /**
   * Start a provider consent flow bound to the authenticated caller.
   *
   * The Aeven API starts the consent and receives the provider's redirect; the next {@link list}
   * after it completes stores the connector. For `discord` this is the bot installation: the user
   * picks the server to add the Aeven application to, and one connector row is stored for that guild.
   * @param provider - registered provider to connect.
   * @returns the provider consent URL.
   */
  @Remote
  async authorize(provider: ConnectorProvider): Promise<ConnectorAuthorization> {
    const owner = this.owner()
    if (provider === 'slack') return this.authorizeSlack(owner)
    if (this.broker === undefined || (provider !== 'discord' && !brokeredProviders.has(provider))) {
      throw new Error('provider sign-in is not configured for this deployment')
    }
    this.consentFailures.delete(`${owner}\0${provider}`)
    for (const [state, pending] of this.consents) if (pending.expiresAt <= Date.now()) this.consents.delete(state)
    // A Discord install authorizes one guild, so the attempt carries no connector id of its own.
    const id = provider === 'discord'
      ? randomUUID() as ConnectorId
      : ([...this.domain.table('connectors').entries()].find(([, item]) => item.owner === owner && item.provider === provider)?.[0] ?? randomUUID()) as ConnectorId
    const started = await this.broker.start(owner, provider === 'discord'
      ? { provider, permissions: this.discordPermissions() }
      : { provider, connectorId: id }).catch((error: unknown) => {
      throw new Error(error instanceof BrokerError && error.reason === 'not-configured'
        ? 'provider sign-in is not configured for this deployment'
        : 'provider sign-in could not start; try again')
    })
    const expiresAt = Math.min(Date.parse(started.expiresAt), Date.now() + this.config.consentLifetimeMs)
    this.consents.set(started.state, { owner, id, provider, expiresAt })
    return { url: started.url }
  }

  /**
   * Enable or disable one personal connector; disabled calls are immediately denied.
   * @param id - caller-owned connector.
   * @param enabled - availability for subsequent conversation steps.
   */
  @Remote
  async setConnectorEnabled(id: ConnectorId, enabled: boolean): Promise<void> {
    const owner = this.owner()
    const saved = this.domain.table('connectors').get(id)
    if (saved === undefined || saved.owner !== owner) throw new Error('connector not found')
    if (enabled && !await this.isConnected(saved)) throw new Error('reconnect this connector before enabling it')
    await this.domain.table('connectors').update(id, (connector) => {
      if (connector.owner !== owner) throw new Error('connector not found')
      return { ...connector, enabled }
    })
    this.invalidateSkills()
    if (!enabled) await this.unmountConnector(id)
    if (saved.provider === 'whatsapp') {
      if (!enabled) await this.stopWhatsApp(id)
      else {
        this.runWhatsApp(id, owner).catch(() => {
          // The next conversation step starts the daemon again and reports the number as unlinked if the phone removed it.
        })
      }
    }
    if (saved.provider === 'telegram') {
      if (!enabled) await this.stopTelegram(id)
      else {
        this.runTelegram(id, owner).catch(() => {
          // The next conversation step starts the daemon again and reports the account as unlinked if Telegram rejected the session.
        })
      }
    }
  }

  /**
   * Disconnect a personal connector and delete its stored credential.
   * @param id - caller-owned connector.
   */
  @Remote
  async disconnect(id: ConnectorId): Promise<void> {
    const owner = this.owner()
    const saved = this.domain.table('connectors').get(id)
    if (saved?.owner !== owner) throw new Error('connector not found')
    if (saved.provider === 'whatsapp') {
      await this.unlinkWhatsApp(id, owner)
      return
    }
    if (saved.provider === 'telegram') {
      await this.unlinkTelegram(id, owner)
      return
    }
    if (saved.provider === 'discord') {
      await this.uninstallDiscord(id)
      return
    }
    if (saved.provider === 'slack') {
      await this.uninstallSlack(id)
      return
    }
    const completions: Promise<void>[] = []
    for (const [state, consent] of this.consents) {
      if (consent.owner !== owner || consent.id !== id) continue
      this.consents.delete(state)
      if (consent.completion !== undefined) completions.push(consent.completion)
    }
    await Promise.all(completions)
    // The grant lives on the Aeven API; deleting it there revokes it at the provider.
    if (saved.grant !== undefined) await this.broker?.remove(owner, id)
    await this.domain.table('connectors').delete(id)
    this.connected.delete(id)
    this.issuedTokens.delete(id)
    this.invalidateSkills()
    await this.unmountConnector(id)
    await this.ctx.credentials.deleteRecord(connectorCredential(owner, id))
  }

  /**
   * Start linking a WhatsApp number: launch a daemon on a fresh data directory and wait for its QR code.
   * A caller's earlier unfinished attempt is cancelled; the number is saved only after the phone scans the code.
   * @returns the attempt, or the reason it could not start.
   */
  @Remote
  async startWhatsAppPairing(): Promise<WhatsAppPairingView> {
    const owner = this.owner()
    if (this.whatsappBinary === undefined) return { state: 'unavailable' }
    for (const [id, pairing] of this.pairings) if (pairing.owner === owner) { await this.endPairing(id, 'expired'); this.pairings.delete(id) }
    const linked = [...this.domain.table('connectors').entries()].map(([, connector]) => connector).filter(connector => connector.owner === owner && connector.provider === 'whatsapp')
    if (linked.length >= this.config.maxWhatsAppAccounts) return { state: 'limit' }
    const id = randomUUID() as ConnectorId
    const pairing: WhatsAppPairing = { owner, daemon: this.newWhatsAppDaemon(owner, id), view: { id, state: 'starting' }, done: false, busy: false }
    this.pairings.set(id, pairing)
    try {
      await pairing.daemon.start()
    } catch {
      // The daemon's own diagnostics are not shown; Settings offers a new attempt.
      await this.endPairing(id, 'failed')
      this.pairings.delete(id)
      return { id, state: 'failed' }
    }
    if (pairing.done) return pairing.view
    pairing.poll = setInterval(() => { void this.advancePairing(id) }, this.config.whatsappPairingPollMs)
    pairing.expiry = setTimeout(() => { void this.endPairing(id, 'expired') }, this.config.consentLifetimeMs)
    await this.advancePairing(id)
    return pairing.view
  }

  /**
   * Read a linking attempt; a terminal state is returned once and the attempt is then forgotten.
   * @param id - attempt identity from startWhatsAppPairing.
   * @returns current QR code or outcome.
   */
  @Remote
  // oxlint-disable-next-line typescript/require-await -- the Remote contract answers with a promise; this read has nothing to await.
  async whatsAppPairing(id: ConnectorId): Promise<WhatsAppPairingView> {
    const owner = this.owner()
    const pairing = this.pairings.get(id)
    if (pairing === undefined || pairing.owner !== owner) {
      return { id, state: this.domain.table('connectors').get(id)?.owner === owner ? 'connected' : 'expired' }
    }
    if (pairing.done) this.pairings.delete(id)
    return pairing.view
  }

  /**
   * Abandon a linking attempt and delete its data directory.
   * @param id - attempt identity from startWhatsAppPairing.
   */
  @Remote
  async cancelWhatsAppPairing(id: ConnectorId): Promise<void> {
    const pairing = this.pairings.get(id)
    if (pairing === undefined || pairing.owner !== this.owner()) return
    await this.endPairing(id, 'expired')
    this.pairings.delete(id)
  }

  /**
   * Start signing in a Telegram account: launch a daemon on a fresh data directory and send the login code.
   * A caller's earlier unfinished attempt is cancelled; the account is saved only after Telegram authorizes it.
   * @param phone - international number, with or without a leading `+`.
   * @returns the attempt, or the reason it could not start.
   */
  @Remote
  async startTelegramPairing(phone: string): Promise<TelegramPairingView> {
    return await this.beginTelegramPairing(async daemon => daemon.loginStart(phone))
  }

  /**
   * Start signing in a Telegram account by QR code: launch a daemon on a fresh data directory and show the
   * login code the Telegram app scans. A caller's earlier unfinished attempt is cancelled; the account is saved
   * only after Telegram authorizes it.
   * @returns the attempt, `qr` with the code to scan, or the reason it could not start.
   */
  @Remote
  async startTelegramQrPairing(): Promise<TelegramPairingView> {
    return await this.beginTelegramPairing(async daemon => daemon.loginQr())
  }

  /** Launch an attempt's daemon, run its first sign-in step, and keep polling while Telegram waits for the user. */
  private async beginTelegramPairing(first: (daemon: TelegramDaemon) => Promise<TelegramDaemonStatus>): Promise<TelegramPairingView> {
    const owner = this.owner()
    if (this.telegramEntry === undefined || await this.telegramCredentials(owner) === undefined) return { state: 'unavailable' }
    for (const [id, pairing] of this.telegramPairings) if (pairing.owner === owner) { await this.endTelegramPairing(id, 'expired'); this.telegramPairings.delete(id) }
    const signedIn = [...this.domain.table('connectors').entries()].map(([, connector]) => connector).filter(connector => connector.owner === owner && connector.provider === 'telegram')
    if (signedIn.length >= this.config.maxTelegramAccounts) return { state: 'limit' }
    const id = randomUUID() as ConnectorId
    const pairing: TelegramPairing = { owner, daemon: await this.newTelegramDaemon(owner, id), view: { id, state: 'starting' }, done: false, busy: false }
    this.telegramPairings.set(id, pairing)
    try {
      await pairing.daemon.start()
    } catch {
      // The daemon's own diagnostics are not shown; Settings offers a new attempt.
      await this.endTelegramPairing(id, 'failed')
      this.telegramPairings.delete(id)
      return { id, state: 'failed' }
    }
    const status = await first(pairing.daemon).catch(() => undefined)
    if (status === undefined) {
      await this.endTelegramPairing(id, 'failed')
      this.telegramPairings.delete(id)
      return { id, state: 'failed' }
    }
    pairing.view = telegramView(id, status)
    if (pairing.view.state === 'starting' || pairing.view.state === 'code' || pairing.view.state === 'qr' || pairing.view.state === 'password') {
      pairing.poll = setInterval(() => { void this.advanceTelegramPairing(id) }, this.config.telegramPairingPollMs)
      pairing.expiry = setTimeout(() => { void this.endTelegramPairing(id, 'expired') }, this.config.consentLifetimeMs)
    } else {
      await this.endTelegramPairing(id, pairing.view.state)
      this.telegramPairings.delete(id)
    }
    return pairing.view
  }

  /**
   * Read a sign-in attempt; a terminal state is returned once and the attempt is then forgotten.
   * @param id - attempt identity from startTelegramPairing.
   * @returns current step, or outcome.
   */
  @Remote
  async telegramPairing(id: ConnectorId): Promise<TelegramPairingView> {
    const owner = this.owner()
    const pairing = this.telegramPairings.get(id)
    if (pairing === undefined || pairing.owner !== owner) {
      return { id, state: this.domain.table('connectors').get(id)?.owner === owner ? 'connected' : 'expired' }
    }
    await this.advanceTelegramPairing(id)
    if (pairing.done) this.telegramPairings.delete(id)
    return pairing.view
  }

  /**
   * Submit the code Telegram sent to the account.
   * @param id - attempt identity from startTelegramPairing.
   * @param code - digits from the Telegram message.
   * @returns the attempt after Telegram answered.
   */
  @Remote
  async submitTelegramCode(id: ConnectorId, code: string): Promise<TelegramPairingView> {
    return await this.submitTelegramStep(id, async daemon => daemon.loginCode(code))
  }

  /**
   * Submit the account's 2FA password when Telegram asked for it.
   * @param id - attempt identity from startTelegramPairing.
   * @param password - the account password; it is passed straight to the daemon and never stored.
   * @returns the attempt after Telegram answered.
   */
  @Remote
  async submitTelegramPassword(id: ConnectorId, password: string): Promise<TelegramPairingView> {
    return await this.submitTelegramStep(id, async daemon => daemon.loginPassword(password))
  }

  /**
   * Abandon a sign-in attempt and delete its data directory.
   * @param id - attempt identity from startTelegramPairing.
   */
  @Remote
  async cancelTelegramPairing(id: ConnectorId): Promise<void> {
    const pairing = this.telegramPairings.get(id)
    if (pairing === undefined || pairing.owner !== this.owner()) return
    await this.endTelegramPairing(id, 'expired')
    this.telegramPairings.delete(id)
  }

  /** Pass one sign-in step to the attempt's daemon and report what Telegram answered. */
  private async submitTelegramStep(
    id: ConnectorId,
    step: (daemon: TelegramDaemon) => Promise<TelegramDaemonStatus>,
  ): Promise<TelegramPairingView> {
    const pairing = this.telegramPairings.get(id)
    if (pairing === undefined || pairing.owner !== this.owner() || pairing.done) return { id, state: 'expired' }
    const status = await step(pairing.daemon).catch(() => undefined)
    if (status === undefined) return pairing.view
    pairing.view = telegramView(id, status)
    await this.advanceTelegramPairing(id)
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- the attempt can end while its advance is awaited.
    if (pairing.done) this.telegramPairings.delete(id)
    return pairing.view
  }

  /** Read the attempt's daemon once and save the account once Telegram has authorized it. */
  private async advanceTelegramPairing(id: ConnectorId): Promise<void> {
    const pairing = this.telegramPairings.get(id)
    if (pairing === undefined || pairing.done || pairing.busy) return
    pairing.busy = true
    try {
      const status = await pairing.daemon.status()
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- the attempt can end while its daemon status is awaited.
      if (pairing.done) return
      pairing.view = telegramView(id, status)
      if (status.state === 'code' || status.state === 'qr' || status.state === 'password') return
      if (status.state === 'unlinked') {
        await this.endTelegramPairing(id, 'unlinked')
        return
      }
      if (status.state === 'failed' || status.state === 'login') {
        await this.endTelegramPairing(id, status.state === 'login' ? 'expired' : 'failed')
        return
      }
      const identity = status.identity
      if (identity === undefined || identity.id === '') {
        await this.endTelegramPairing(id, 'failed')
        return
      }
      const existing = [...this.domain.table('connectors').entries()].find(([, connector]) =>
        connector.owner === pairing.owner && connector.provider === 'telegram' && connector.telegram?.userId === identity.id)
      if (existing !== undefined && existing[1].telegram?.linked === true) {
        await pairing.daemon.logout().catch(() => {
          // The local session is deleted with the directory; the account can end it from Telegram.
        })
        await this.endTelegramPairing(id, 'duplicate')
        return
      }
      // A signed-out account is signed in again in place, and a new one gets the id derived from the account,
      // so a conversation that already uses the account's tools keeps working after it signs in again.
      const target = existing?.[0] ?? telegramConnectorId(pairing.owner, identity.id)
      const settings = { userId: identity.id, linked: true,
        ...identity.name === undefined ? {} : { name: identity.name },
        ...identity.username === undefined ? {} : { username: identity.username },
        ...identity.phone === undefined ? {} : { phone: identity.phone } }
      if (target !== id) {
        // The attempt's daemon stores its session under the attempt id; it moves to the account's directory
        // and a daemon is started there.
        await pairing.daemon.stop()
        await this.stopTelegram(target)
        const directory = this.telegramDirectory(pairing.owner, target)
        await rm(directory, { recursive: true, force: true })
        await rename(pairing.daemon.directory, directory)
      }
      await this.domain.table('connectors').put(target, {
        owner: pairing.owner, id: target, provider: 'telegram',
        name: identity.name ?? (identity.username === undefined ? identity.id : `@${identity.username}`),
        enabled: existing?.[1].enabled ?? true, telegram: settings,
      })
      if (target === id) this.superviseTelegram(id, pairing.owner, pairing.daemon, Promise.resolve(), 0)
      else {
        this.runTelegram(target, pairing.owner).catch(() => {
          // The next conversation step starts the daemon again and reports the account as unlinked if Telegram rejected the session.
        })
      }
      await this.endTelegramPairing(id, 'connected', true)
      pairing.view = { id: target, state: 'connected', account: telegramSettings(settings) }
      this.connected.add(target)
      this.invalidateSkills()
    } catch {
      // A failed status read is retried on the next poll; the expiry timer bounds the attempt.
    } finally {
      pairing.busy = false
    }
  }

  /** Finish an attempt with a terminal state, deleting its daemon and directory unless the account was saved. */
  private async endTelegramPairing(id: ConnectorId, state: TelegramPairingView['state'], saved = false): Promise<void> {
    const pairing = this.telegramPairings.get(id)
    if (pairing === undefined || pairing.done) return
    pairing.done = true
    pairing.view = { ...pairing.view, id, state }
    clearInterval(pairing.poll)
    clearTimeout(pairing.expiry)
    if (saved) return
    await pairing.daemon.stop()
    await rm(pairing.daemon.directory, { recursive: true, force: true })
  }

  /** Read the attempt's daemon once and save the number when the phone has scanned the code. */
  private async advancePairing(id: ConnectorId): Promise<void> {
    const pairing = this.pairings.get(id)
    if (pairing === undefined || pairing.done || pairing.busy) return
    pairing.busy = true
    try {
      const status = await pairing.daemon.status()
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- the attempt can end while its daemon status is awaited.
      if (pairing.done) return
      switch (status.state) {
        case 'starting': return
        case 'qr':
          pairing.view = { id, state: 'qr', ...status.qr_png !== undefined ? { qr: `data:image/png;base64,${status.qr_png}` } : {} }
          return
        case 'expired':
        case 'failed':
          await this.endPairing(id, status.state)
          return
        case 'paired': {
          const phone = status.phone ?? ''
          const duplicate = [...this.domain.table('connectors').entries()].map(([, connector]) => connector).some(connector =>
            connector.owner === pairing.owner && connector.provider === 'whatsapp' && connector.whatsapp?.phone === phone)
          if (phone === '' || duplicate) {
            await pairing.daemon.logout().catch(() => {
              // The local session is deleted with the directory; the phone can remove a device that stayed listed.
            })
            await this.endPairing(id, phone === '' ? 'failed' : 'duplicate')
            return
          }
          const profileName = status.name === undefined || status.name === '' ? undefined : status.name
          await this.domain.table('connectors').put(id, {
            owner: pairing.owner, id, provider: 'whatsapp', name: profileName ?? `+${phone}`, enabled: true,
            whatsapp: { phone, linked: true, ...profileName !== undefined ? { profileName } : {} },
          })
          this.superviseWhatsApp(id, pairing.owner, pairing.daemon, Promise.resolve(), 0)
          await this.endPairing(id, 'connected', true)
          this.connected.add(id)
          this.invalidateSkills()
          return
        }
      }
    } catch {
      // A failed status read is retried on the next poll; the expiry timer bounds the attempt.
    } finally {
      pairing.busy = false
    }
  }

  /** Finish an attempt with a terminal state, deleting its daemon and directory unless the number was saved. */
  private async endPairing(id: ConnectorId, state: WhatsAppPairingView['state'], saved = false): Promise<void> {
    const pairing = this.pairings.get(id)
    if (pairing === undefined || pairing.done) return
    pairing.done = true
    pairing.view = { id, state }
    clearInterval(pairing.poll)
    clearTimeout(pairing.expiry)
    if (saved) return
    await pairing.daemon.stop()
    await rm(pairing.daemon.directory, { recursive: true, force: true })
  }

  /** Remove the device from the WhatsApp account, then delete the daemon's data and the connector. */
  private async unlinkWhatsApp(id: ConnectorId, owner: string): Promise<void> {
    try {
      await (await this.runWhatsApp(id, owner)).logout()
    } catch {
      // Without a network the phone keeps listing the device until removed there; the local session is deleted regardless.
    }
    await this.stopWhatsApp(id)
    await this.domain.table('connectors').delete(id)
    this.connected.delete(id)
    this.invalidateSkills()
    await this.unmountConnector(id)
    await rm(this.whatsappDirectory(owner, id), { recursive: true, force: true })
  }

  /** The running daemon of a linked number, or undefined when it cannot run or the phone removed the device. */
  private async linkedWhatsApp(id: ConnectorId, connector: z.infer<typeof connectorSchema>): Promise<WhatsAppDaemon | undefined> {
    if (connector.whatsapp?.linked !== true || this.whatsappBinary === undefined) return undefined
    let daemon: WhatsAppDaemon
    let state: string
    try {
      daemon = await this.runWhatsApp(id, connector.owner)
      state = (await daemon.status()).state
    } catch {
      // A daemon that cannot start or answer is retried on the next step; its tools stay unmounted meanwhile.
      return undefined
    }
    if (state === 'paired') return daemon
    await this.markWhatsAppUnlinked(id)
    return undefined
  }

  /** Re-read a running daemon so Settings shows a device the phone removed. */
  private async refreshWhatsApp(id: ConnectorId, connector: z.infer<typeof connectorSchema>): Promise<z.infer<typeof connectorSchema>> {
    const entry = this.whatsapp.get(id)
    if (entry === undefined || !entry.alive || connector.whatsapp?.linked !== true) return connector
    try {
      await entry.ready
      if ((await entry.daemon.status()).state === 'paired') return connector
    } catch {
      // A daemon that is restarting keeps its last known link state.
      return connector
    }
    await this.markWhatsAppUnlinked(id)
    return this.domain.table('connectors').get(id) ?? connector
  }

  private async markWhatsAppUnlinked(id: ConnectorId): Promise<void> {
    await this.domain.table('connectors').update(id, connector => ({ ...connector, whatsapp: connector.whatsapp === undefined ? undefined : { ...connector.whatsapp, linked: false } }))
    this.connected.delete(id)
    await this.stopWhatsApp(id)
    await this.unmountConnector(id)
    this.invalidateSkills()
  }

  /**
   * Return the number's daemon, starting it when it is not running.
   * @returns the daemon once it has bound its port.
   */
  private async runWhatsApp(id: ConnectorId, owner: string): Promise<WhatsAppDaemon> {
    const current = this.whatsapp.get(id)
    if (current?.alive === true) {
      await current.ready
      return current.daemon
    }
    clearTimeout(current?.restart)
    const daemon = this.newWhatsAppDaemon(owner, id)
    const entry = this.superviseWhatsApp(id, owner, daemon, daemon.start(), current?.failures ?? 0)
    await entry.ready
    return daemon
  }

  /** Track a daemon and restart it with backoff when it exits while its number stays enabled and linked. */
  private superviseWhatsApp(
    id: ConnectorId,
    owner: string,
    daemon: WhatsAppDaemon,
    ready: Promise<void>,
    failures: number,
  ): SupervisedWhatsApp {
    const entry: SupervisedWhatsApp = { daemon, ready, alive: true, failures, startedAt: Date.now() }
    this.whatsapp.set(id, entry)
    void daemon.exited.then(() => {
      entry.alive = false
      if (daemon.stopped || this.whatsapp.get(id) !== entry) return
      const connector = this.domain.table('connectors').get(id)
      if (connector?.enabled !== true || connector.whatsapp?.linked !== true) { this.whatsapp.delete(id); return }
      const maxDelay = this.config.whatsappMaxRestartDelayMs
      entry.failures = Date.now() - entry.startedAt >= maxDelay ? 0 : entry.failures + 1
      const delay = Math.min(this.config.whatsappRestartDelayMs * 2 ** Math.max(0, entry.failures - 1), maxDelay)
      entry.restart = setTimeout(() => {
        this.runWhatsApp(id, owner).catch(() => {
          // Startup failures do not schedule another restart; the next conversation step or Settings action retries.
        })
      }, delay)
    })
    return entry
  }

  private async stopWhatsApp(id: ConnectorId): Promise<void> {
    const entry = this.whatsapp.get(id)
    if (entry === undefined) return
    this.whatsapp.delete(id)
    clearTimeout(entry.restart)
    await entry.daemon.stop()
  }

  private newWhatsAppDaemon(owner: string, id: ConnectorId): WhatsAppDaemon {
    const binary = this.whatsappBinary
    if (binary === undefined) throw new Error('WhatsApp sign-in is not configured for this deployment')
    return new WhatsAppDaemon(binary, this.whatsappDirectory(owner, id), {
      startupTimeoutMs: this.config.whatsappStartupTimeoutMs, requestTimeoutMs: this.config.timeoutMs,
      stopGraceMs: this.config.whatsappStopGraceMs,
    }, this.ffmpegBinary)
  }

  /** Aeven-owned data directory of one number: the whatsmeow session and message cache in `store/`, sendable files in `media/`. */
  private whatsappDirectory(owner: string, id: ConnectorId): string {
    return avnHomePath('accounts', accountDirectory(owner), 'connectors', id)
  }

  /** End the account's Telegram session, then delete the daemon's data and the connector. */
  private async unlinkTelegram(id: ConnectorId, owner: string): Promise<void> {
    try {
      await (await this.runTelegram(id, owner)).logout()
    } catch {
      // Without a network the session stays listed in Telegram until it is ended there; the local session is deleted regardless.
    }
    await this.stopTelegram(id)
    await this.domain.table('connectors').delete(id)
    this.connected.delete(id)
    this.invalidateSkills()
    await this.unmountConnector(id)
    await rm(this.telegramDirectory(owner, id), { recursive: true, force: true })
  }

  /** The running daemon of a signed-in account, or undefined when it cannot run or Telegram rejected the session. */
  private async linkedTelegram(id: ConnectorId, connector: z.infer<typeof connectorSchema>): Promise<TelegramDaemon | undefined> {
    if (connector.telegram?.linked !== true || this.telegramEntry === undefined) return undefined
    let daemon: TelegramDaemon
    let state: TelegramDaemonStatus['state']
    try {
      daemon = await this.runTelegram(id, connector.owner)
      state = (await daemon.status()).state
    } catch {
      // A daemon that cannot start or answer is retried on the next step; its tools stay unmounted meanwhile.
      return undefined
    }
    if (state === 'authorized') return daemon
    await this.markTelegramUnlinked(id)
    return undefined
  }

  /** Re-read a running daemon so Settings shows a session Telegram rejected. */
  private async refreshTelegram(id: ConnectorId, connector: z.infer<typeof connectorSchema>): Promise<z.infer<typeof connectorSchema>> {
    const entry = this.telegram.get(id)
    if (entry === undefined || !entry.alive || connector.telegram?.linked !== true) return connector
    try {
      await entry.ready
      if ((await entry.daemon.status(true)).state === 'authorized') return connector
    } catch {
      // A daemon that is restarting keeps its last known link state.
      return connector
    }
    await this.markTelegramUnlinked(id)
    return this.domain.table('connectors').get(id) ?? connector
  }

  /** Re-ask Slack about a workspace's token at most once per `slackVerifyIntervalMs`, so a revoked one stops claiming to be connected. */
  private async refreshSlack(id: ConnectorId, connector: z.infer<typeof connectorSchema>): Promise<z.infer<typeof connectorSchema>> {
    if (connector.slack?.linked !== true || this.slackApplicationId === undefined) return connector
    const cached = this.slackPresence.get(id)
    if (cached !== undefined && Date.now() - cached.at < this.config.slackVerifyIntervalMs) {
      if (cached.present) return connector
      await this.markSlackUnlinked(id)
      return this.domain.table('connectors').get(id) ?? connector
    }
    let present: boolean
    try {
      const token = await this.slackAccessToken(connector.owner, connector)
      present = await probeSlackToken({ accessToken: token, timeoutMs: this.config.timeoutMs })
    } catch {
      // An unreachable Slack keeps the row's last known state; the next read asks again.
      return connector
    }
    this.slackPresence.set(id, { at: Date.now(), present })
    if (present) return connector
    await this.markSlackUnlinked(id)
    return this.domain.table('connectors').get(id) ?? connector
  }

  private async markTelegramUnlinked(id: ConnectorId): Promise<void> {
    await this.domain.table('connectors').update(id, connector => ({ ...connector, telegram: connector.telegram === undefined ? undefined : { ...connector.telegram, linked: false } }))
    this.connected.delete(id)
    await this.stopTelegram(id)
    await this.unmountConnector(id)
    this.invalidateSkills()
  }

  /**
   * Return the account's daemon, starting it when it is not running.
   * @returns the daemon once it has bound its port.
   */
  private async runTelegram(id: ConnectorId, owner: string): Promise<TelegramDaemon> {
    const current = this.telegram.get(id)
    if (current?.alive === true) {
      await current.ready
      return current.daemon
    }
    clearTimeout(current?.restart)
    const daemon = await this.newTelegramDaemon(owner, id)
    const entry = this.superviseTelegram(id, owner, daemon, daemon.start(), current?.failures ?? 0)
    await entry.ready
    return daemon
  }

  /** Track a daemon and restart it with backoff when it exits while its account stays enabled and signed in. */
  private superviseTelegram(
    id: ConnectorId,
    owner: string,
    daemon: TelegramDaemon,
    ready: Promise<void>,
    failures: number,
  ): SupervisedTelegram {
    const entry: SupervisedTelegram = { daemon, ready, alive: true, failures, startedAt: Date.now() }
    this.telegram.set(id, entry)
    void daemon.exited.then(() => {
      entry.alive = false
      if (daemon.stopped || this.telegram.get(id) !== entry) return
      const connector = this.domain.table('connectors').get(id)
      if (connector?.enabled !== true || connector.telegram?.linked !== true) { this.telegram.delete(id); return }
      const maxDelay = this.config.telegramMaxRestartDelayMs
      entry.failures = Date.now() - entry.startedAt >= maxDelay ? 0 : entry.failures + 1
      const delay = Math.min(this.config.telegramRestartDelayMs * 2 ** Math.max(0, entry.failures - 1), maxDelay)
      entry.restart = setTimeout(() => {
        this.runTelegram(id, owner).catch(() => {
          // Startup failures do not schedule another restart; the next conversation step or Settings action retries.
        })
      }, delay)
    })
    return entry
  }

  private async stopTelegram(id: ConnectorId): Promise<void> {
    const entry = this.telegram.get(id)
    if (entry === undefined) return
    this.telegram.delete(id)
    clearTimeout(entry.restart)
    await entry.daemon.stop()
  }

  private async newTelegramDaemon(owner: string, id: ConnectorId): Promise<TelegramDaemon> {
    const credentials = await this.telegramCredentials(owner)
    if (credentials === undefined) throw new Error('Telegram application credentials are unavailable until the account owner signs in')
    const entry = this.telegramEntry
    if (entry === undefined) throw new Error('Telegram sign-in is not configured for this deployment')
    return new TelegramDaemon(entry, this.telegramDirectory(owner, id), credentials, {
      startupTimeoutMs: this.config.telegramStartupTimeoutMs, requestTimeoutMs: this.config.timeoutMs,
      stopGraceMs: this.config.telegramStopGraceMs,
    })
  }

  /** Aeven-owned data directory of one account: the session string, its identity cache, and downloads. */
  private telegramDirectory(owner: string, id: ConnectorId): string {
    return avnHomePath('accounts', accountDirectory(owner), 'connectors', id)
  }

  /**
   * The deployment's Telegram application identifiers, read from the Aeven API with a signed-in
   * user's session and cached in the credential provider, so accounts already linked start at
   * boot before anyone signs in.
   * @param owner - a signed-in user whose session may fetch them when no copy is cached.
   * @returns the identifiers, or undefined when none is cached and none can be fetched.
   */
  private async telegramCredentials(owner?: string): Promise<TelegramCredentials | undefined> {
    const cached = await this.ctx.credentials.readRecord(telegramAppKey).catch(() => undefined)
    const parsed = cached?.kind === 'grant' ? z.object({ apiId: z.string().min(1), apiHash: z.string().min(1) }).safeParse(cached.payload) : undefined
    if (parsed?.success === true) return parsed.data
    if (owner === undefined || this.broker === undefined) return undefined
    const app = await this.broker.telegramApp(owner).catch(() => undefined)
    if (app === undefined) return undefined
    await this.ctx.credentials.modifyRecord(telegramAppKey, () => Promise.resolve({ kind: 'grant', payload: app }))
    return app
  }

  /** Discord permissions the install link asks for: the curated surface, or the administration set when it is served. */
  private discordPermissions(): string {
    if (this.config.discordPermissions !== undefined) return this.config.discordPermissions
    return this.config.discordAdminTools ? DISCORD_ADMIN_PERMISSIONS : DISCORD_CURATED_PERMISSIONS
  }

  /** Guild rows one account has installed. */
  private discordGuilds(owner: string): [ConnectorId, z.infer<typeof connectorSchema>][] {
    return [...this.domain.table('connectors').entries()].filter(([, connector]) => connector.owner === owner && connector.provider === 'discord')
  }

  /**
   * Record one guild the Aeven API reports the user installed the Aeven bot into. The API spent
   * the code and confirmed the bot's membership; a guild beyond the account's limit is removed again.
   * @param consent - the account-bound consent this install belongs to.
   * @param result - the guild, installer, and bot the API recorded.
   */
  private async recordDiscordInstall(consent: PendingConsent, result: NonNullable<ConsentStatus['result']>): Promise<void> {
    if (result.guild === undefined || result.botUserId === undefined || result.applicationId === undefined) throw new Error('Discord reported no guild for this installation')
    const guild: DiscordGuild = {
      id: result.guild.id, name: result.guild.name, ...result.guild.icon === undefined ? {} : { icon: result.guild.icon },
    }
    const existing = this.discordGuilds(consent.owner).find(([, connector]) => connector.discord?.guildId === guild.id)
    if (existing === undefined && this.discordGuilds(consent.owner).length >= this.config.maxDiscordGuilds) {
      await this.broker?.removeDiscord(consent.owner, guild.id)
      throw new Error('Discord server limit reached')
    }
    // One row per guild: adding a server the account already connected refreshes that row instead of duplicating it.
    const id = existing?.[0] ?? discordConnectorId(consent.owner, guild.id)
    const icon = discordGuildIcon(guild)
    await this.domain.table('connectors').put(id, {
      owner: consent.owner, id, provider: 'discord', name: guild.name, enabled: existing?.[1].enabled ?? true,
      discord: {
        applicationId: result.applicationId, botUserId: result.botUserId, guildId: guild.id, guildName: guild.name, linked: true,
        ...icon === undefined ? {} : { icon },
        ...result.installer === undefined ? {} : { installedById: result.installer.id, installedByName: result.installer.name },
      },
    })
    this.discordPresence.set(id, { at: Date.now(), present: true })
    this.connected.add(id)
    this.invalidateSkills()
  }

  /**
   * Read one guild's membership, remembering the verdict for the configured interval.
   * @param id - Discord connector.
   * @param connector - its stored row.
   * @returns true while the Aeven bot is still a member of the guild.
   */
  private async discordPresent(id: ConnectorId, connector: z.infer<typeof connectorSchema>): Promise<boolean> {
    const guildId = connector.discord?.guildId
    if (guildId === undefined || connector.discord?.linked !== true) return false
    const cached = this.discordPresence.get(id)
    if (cached !== undefined && Date.now() - cached.at < this.config.discordVerifyIntervalMs) return cached.present
    if (this.broker === undefined) return cached?.present ?? false
    let guild: DiscordGuild | undefined
    try {
      guild = await this.broker.discordGuild(connector.owner, guildId)
    } catch {
      // A lookup that failed for any reason other than membership keeps the last known verdict;
      // the next step asks Discord again.
      return cached?.present ?? true
    }
    const present = guild !== undefined
    this.discordPresence.set(id, { at: Date.now(), present })
    if (guild === undefined) return false
    // The server may have been renamed or given another icon since the install.
    const icon = discordGuildIcon(guild)
    if (guild.name !== connector.discord.guildName || icon !== connector.discord.icon) {
      await this.domain.table('connectors').update(id, row => ({
        ...row, name: guild.name,
        discord: row.discord === undefined ? undefined : { ...row.discord, guildName: guild.name, ...icon === undefined ? {} : { icon } },
      }))
    }
    return present
  }

  /** Mark one guild connection as no longer installed: the bot is not a member anymore. */
  private async markDiscordUnlinked(id: ConnectorId): Promise<void> {
    await this.domain.table('connectors').update(id, connector => ({
      ...connector, discord: connector.discord === undefined ? undefined : { ...connector.discord, linked: false },
    }))
    this.discordPresence.delete(id)
    this.connected.delete(id)
    await this.unmountConnector(id)
    this.invalidateSkills()
  }

  /**
   * Remove the user's installation at the Aeven API, which takes the bot out of the guild once no user
   * has it installed there, then delete the row.
   */
  private async uninstallDiscord(id: ConnectorId): Promise<void> {
    const connector = this.domain.table('connectors').get(id)
    const guildId = connector?.discord?.guildId
    if (guildId !== undefined && connector !== undefined && this.broker !== undefined) {
      await this.broker.removeDiscord(connector.owner, guildId)
    }
    await this.domain.table('connectors').delete(id)
    this.discordPresence.delete(id)
    this.connected.delete(id)
    this.invalidateSkills()
    await this.unmountConnector(id)
  }

  /**
   * The stdio server configuration of one guild connector: one child process serving that guild alone.
   * @param connector - the guild row.
   * @param session - the owner's current Aeven access token, which the API's Discord proxy authenticates.
   * @returns the child's command and environment, or undefined when this Host cannot serve Discord.
   */
  private discordServer(connector: z.infer<typeof connectorSchema>, session: string): {
    command: string
    args: string[]
    env: Record<string, string>
  } | undefined {
    const discord = connector.discord
    if (discord === undefined || this.discordEntry === undefined || this.broker === undefined) return undefined
    return {
      command: process.execPath,
      args: [this.discordEntry],
      // The bot token stays on the Aeven API: the child calls the API's Discord proxy as the
      // owner, which acts as the bot only inside guilds that owner installed it into.
      env: {
        DISCORD_API_BASE: this.broker.discordApiBase(discord.guildId),
        DISCORD_AUTHORIZATION: `Bearer ${session}`,
        DISCORD_GUILD_ID: discord.guildId,
        DISCORD_GUILD_NAME: discord.guildName,
        ...this.config.discordAdminTools ? { DISCORD_ADMIN_TOOLS: '1' } : {},
      },
    }
  }

  /**
   * Start one Slack workspace login: bind the callback, hand Settings the consent URL, and store
   * the row when the reader finishes in the browser.
   *
   * The login runs on this Host with a public client, so the token never passes through the Aeven
   * API, and the row is written only after Slack confirms which workspace and account it belongs to.
   * @param owner - signed-in account connecting the workspace.
   * @returns the consent URL to open.
   * @throws when Slack is unconfigured, the account is at its limit, or the callback port is taken.
   */
  private async authorizeSlack(owner: string): Promise<ConnectorAuthorization> {
    const clientId = this.slackApplicationId
    if (clientId === undefined) throw new Error('provider sign-in is not configured for this deployment')
    if (this.slackWorkspaces(owner).length >= this.config.maxSlackWorkspaces) throw new Error('workspace limit reached')
    for (const [id, pending] of this.slackLogins) if (pending.owner === owner) { pending.cancel(); this.slackLogins.delete(id) }
    this.consentFailures.delete(`${owner}\0slack`)
    const scopes = this.slackScopes()
    let login: SlackLogin
    try {
      login = await startSlackLogin({ clientId, port: this.config.slackCallbackPort, scopes, timeoutMs: this.config.consentLifetimeMs })
    } catch (error) {
      // A blocked port is the deployment's own configuration, and Settings has to say so rather than report a failed sign-in.
      throw new Error(error instanceof SlackLoginError && error.reason === 'port'
        ? `the Slack callback port ${this.config.slackCallbackPort} is already in use on this computer`
        : 'Slack sign-in could not start; try again')
    }
    const id = randomUUID() as ConnectorId
    const completion = login.completion
      .then(async ({ token, workspace }) => {
        await this.recordSlackWorkspace(owner, workspace, token)
        this.consentFailures.delete(`${owner}\0slack`)
      })
      .catch((error: unknown) => {
        this.consentFailures.set(`${owner}\0slack`, { authorizationFailure: error instanceof SlackLoginError && error.reason === 'approval' ? 'admin-consent-required' : 'failed' })
        this.ctx.logger('account-integrations').warn(`Slack sign-in was not completed: ${error instanceof Error ? error.message : String(error)}`)
      })
      .finally(() => {
        if (this.slackLogins.get(id)?.completion === completion) this.slackLogins.delete(id)
      })
    this.slackLogins.set(id, { owner, cancel: login.cancel, completion })
    return { url: login.url }
  }

  /**
   * The deployment's Slack application client id. It is public — Slack's PKCE client is a public
   * client — and an empty value is a deployment that has not registered one.
   */
  private get slackApplicationId(): string | undefined {
    const clientId = this.config.slackClientId?.trim()
    return clientId === undefined || clientId === '' ? undefined : clientId
  }

  /** User scopes one login asks for: the workspace surface, plus direct messages only where the deployment serves them. */
  private slackScopes(): readonly string[] {
    return this.config.slackDirectMessages ? [...SLACK_WORKSPACE_SCOPES, ...SLACK_DIRECT_MESSAGE_SCOPES] : SLACK_WORKSPACE_SCOPES
  }

  /** Workspace rows one account has connected. */
  private slackWorkspaces(owner: string): [ConnectorId, z.infer<typeof connectorSchema>][] {
    return [...this.domain.table('connectors').entries()].filter(([, connector]) => connector.owner === owner && connector.provider === 'slack')
  }

  /**
   * Store one connected workspace under the id its team id derives, replacing any row this account
   * already had for it, and revoke the grant a row over the account's limit would have added.
   * @param owner - the account that consented.
   * @param workspace - the team and account Slack reported.
   * @param token - the user token and refresh credential the login obtained.
   */
  private async recordSlackWorkspace(owner: string, workspace: SlackWorkspace, token: SlackToken): Promise<void> {
    const id = slackConnectorId(owner, workspace.teamId)
    const existing = this.slackWorkspaces(owner).some(([, connector]) => connector.slack?.teamId === workspace.teamId)
    if (!existing && this.slackWorkspaces(owner).length >= this.config.maxSlackWorkspaces) {
      await revokeSlackToken({ accessToken: token.accessToken, timeoutMs: this.config.timeoutMs }).catch(() => undefined)
      throw new Error('workspace limit reached')
    }
    // The workspace is kept only if Slack's MCP server accepts the token it just issued, as the
    // other connectors verify their provider before a row is written.
    try {
      await this.verifyMcp(SLACK_MCP_ENDPOINT, token.accessToken)
    } catch {
      await revokeSlackToken({ accessToken: token.accessToken, timeoutMs: this.config.timeoutMs }).catch(() => undefined)
      throw new Error('Slack did not accept this workspace; ask an administrator to approve the Aeven app, then connect it again')
    }
    await this.ctx.credentials.modifyRecord(connectorCredential(owner, id), () => Promise.resolve({ kind: 'grant', payload: token }))
    await this.domain.table('connectors').put(id, {
      owner, id, provider: 'slack', name: workspace.teamName, endpoint: SLACK_MCP_ENDPOINT, enabled: true,
      slack: {
        teamId: workspace.teamId, teamName: workspace.teamName, userId: workspace.userId, userName: workspace.userName,
        scopes: [...token.scopes], linked: true,
        ...workspace.domain === undefined ? {} : { domain: workspace.domain },
      },
    })
    this.connected.add(id)
    this.invalidateSkills()
  }

  /**
   * The user token one workspace row presents, refreshed when Slack issued a rotating token.
   * @param owner - the account the credential belongs to.
   * @param connector - the workspace row.
   * @returns the access token.
   * @throws when the stored consent is gone, which also marks the row for reconnecting.
   */
  private async slackAccessToken(owner: string, connector: z.infer<typeof connectorSchema>): Promise<string> {
    const record = await this.ctx.credentials.readRecord(connectorCredential(owner, connector.id))
    const token = record?.kind === 'grant' ? slackTokenSchema.safeParse(record.payload) : undefined
    if (token?.success !== true) throw new Error('the Slack workspace has no stored token; connect it again in Settings')
    const stored = token.data
    if (stored.expiresAt === undefined || stored.expiresAt - TOKEN_MARGIN_MS > Date.now()) return stored.accessToken
    if (stored.refreshToken === undefined) {
      await this.markSlackUnlinked(connector.id)
      throw new Error('the Slack token expired; connect the workspace again in Settings')
    }
    const clientId = this.slackApplicationId
    if (clientId === undefined) throw new Error('Slack sign-in is not configured for this deployment')
    try {
      const refreshed = await refreshSlackToken({ clientId, refreshToken: stored.refreshToken, timeoutMs: this.config.timeoutMs })
      const bundle: SlackToken = { ...refreshed, scopes: refreshed.scopes.length === 0 ? stored.scopes : refreshed.scopes }
      await this.ctx.credentials.modifyRecord(connectorCredential(owner, connector.id), () => Promise.resolve({ kind: 'grant', payload: bundle }))
      return bundle.accessToken
    } catch (error) {
      if (!isSlackConsentFailure(error)) throw error
      await this.markSlackUnlinked(connector.id)
      throw new Error('the Slack workspace has to be connected again in Settings')
    }
  }

  /** Mark one workspace as needing to be connected again and drop its mounted tools. */
  private async markSlackUnlinked(id: ConnectorId): Promise<void> {
    await this.domain.table('connectors').update(id, connector => ({ ...connector, slack: connector.slack === undefined ? undefined : { ...connector.slack, linked: false } }))
    this.connected.delete(id)
    await this.unmountConnector(id)
    this.invalidateSkills()
  }

  /** Stop every login in flight and delete the rows they left, which is what disconnecting a workspace does. */
  private async uninstallSlack(id: ConnectorId): Promise<void> {
    const connector = this.domain.table('connectors').get(id)
    const pending = this.slackLogins.get(id)
    if (pending !== undefined) {
      this.slackLogins.delete(id)
      pending.cancel()
    }
    const record = connector === undefined ? undefined : await this.ctx.credentials.readRecord(connectorCredential(connector.owner, id))
    const token = record?.kind === 'grant' ? slackTokenSchema.safeParse(record.payload) : undefined
    if (token?.success === true) {
      await revokeSlackToken({ accessToken: token.data.accessToken, timeoutMs: this.config.timeoutMs }).catch((error: unknown) => {
        // Slack refusing the revocation leaves the local row gone all the same: the reader asked for the connection to end.
        this.ctx.logger('account-integrations').warn(`Slack token revocation was refused: ${error instanceof Error ? error.message : String(error)}`)
      })
    }
    if (connector !== undefined) await this.ctx.credentials.deleteRecord(connectorCredential(connector.owner, id))
    await this.domain.table('connectors').delete(id)
    this.connected.delete(id)
    this.invalidateSkills()
    await this.unmountConnector(id)
  }

  private skillConnectorAvailable(name: string, owner: string | undefined): boolean {
    const provider = (Object.keys(connectorSkills) as ConnectorProvider[]).find(provider => connectorSkills[provider].includes(name))
    if (provider === undefined) return true
    return owner !== undefined && [...this.domain.table('connectors').entries()].some(([id, connector]) =>
      connector.owner === owner && connector.provider === provider && connector.enabled && this.connected.has(id))
  }

  private async isConnected(connector: z.infer<typeof connectorSchema>): Promise<boolean> {
    // The whatsmeow session lives in the daemon's store directory, not in the credential provider.
    if (connector.provider === 'whatsapp') return connector.whatsapp?.linked === true && this.whatsappBinary !== undefined
    // The teleproto session string lives in the daemon's directory, and the deployment's
    // application identifiers come from the Aeven API rather than from the row.
    if (connector.provider === 'telegram') return connector.telegram?.linked === true && this.telegramEntry !== undefined
    // A Discord guild is installed through the Aeven API, which holds the bot token: the row records
    // the guild, so there is no per-connector credential record.
    if (connector.provider === 'discord') {
      return connector.discord?.linked === true && this.discordEntry !== undefined && this.broker !== undefined
    }
    // A Slack workspace holds its own user token in the credential provider, so nothing on the API is involved.
    if (connector.provider === 'slack') {
      return connector.slack?.linked === true && this.slackApplicationId !== undefined
        && connector.endpoint === SLACK_MCP_ENDPOINT
        && (await this.ctx.credentials.readRecord(connectorCredential(connector.owner, connector.id)))?.kind === 'grant'
    }
    // An OAuth grant lives on the Aeven API; the row keeps the granted scopes and whether it expired.
    if (connector.grant !== undefined) {
      const grant = connector.grant
      if (grant.expired === true || this.broker === undefined) return false
      const google = googleService(connector.provider)
      const microsoft = microsoftService(connector.provider)
      if (microsoft !== undefined) return connector.microsoft !== undefined && connector.endpoint === microsoft.endpoint
        && microsoft.scopes.every(scope => grant.scopes.some(granted => granted.replace('https://graph.microsoft.com/', '') === scope))
      return google === undefined || (connector.endpoint === google.endpoint && grant.scopes.includes(google.scopes[0]))
    }
    const record = await this.ctx.credentials.readRecord(connectorCredential(connector.owner, connector.id))
    if (connector.provider === 'email') {
      return connector.authFailed !== true && record?.kind === 'grant' && emailSecretSchema.safeParse(record.payload).success
    }
    // A custom MCP server or a GitHub personal access token; any other row predates the broker and must reconnect.
    return record?.kind === 'api-key'
  }

  private async unmountConnector(id: ConnectorId): Promise<void> {
    for (const mount of this.mounts.values()) {
      const connection = mount.connections.get(id)
      if (connection === undefined) continue
      await connection.fiber.dispose()
      mount.connections.delete(id)
    }
  }

  private owner(): string {
    const user = this.ctx.identityUsers.actingUser()
    if (user === undefined) throw new Error('sign in to manage personal skills and connectors')
    return user.id
  }

  /**
   * The bearer one connector presents: a stored personal access token, or a short-lived access
   * token the Aeven API issues for its OAuth grant, reused until shortly before it expires.
   * @param owner - the connector's owner, whose session the API authenticates.
   * @param connector - the connector row.
   * @returns the bearer token; empty for a custom MCP server without one.
   * @throws when the grant expired at the provider, which also marks the row for reconnection.
   */
  private async accessToken(owner: string, connector: z.infer<typeof connectorSchema>): Promise<string> {
    // A Slack workspace's own user token, refreshed here; no API grant is involved.
    if (connector.provider === 'slack') return this.slackAccessToken(owner, connector)
    if (connector.grant === undefined) {
      const record = await this.ctx.credentials.readRecord(connectorCredential(owner, connector.id))
      if (record?.kind !== 'api-key') throw new Error('connector credential is missing; reconnect in Settings')
      return record.key ?? ''
    }
    const cached = this.issuedTokens.get(connector.id)
    const cachedIsFresh = cached !== undefined
      && (cached.expiresAt === undefined || cached.expiresAt - TOKEN_MARGIN_MS > Date.now())
    if (cachedIsFresh) return cached.accessToken
    if (this.broker === undefined) throw new Error('connector sign-in is not configured for this deployment')
    let issued: IssuedToken
    try {
      issued = await this.broker.token(owner, connector.id)
    } catch (error) {
      if (error instanceof BrokerError && (error.reason === 'reauthorize' || error.reason === 'not-connected')) {
        await this.domain.table('connectors').update(connector.id, row => row.grant === undefined ? row : { ...row, grant: { ...row.grant, expired: true } })
        this.connected.delete(connector.id)
        this.invalidateSkills()
        throw new Error('connector authorization expired; reconnect in Settings')
      }
      throw error
    }
    this.issuedTokens.set(connector.id, issued)
    return issued.accessToken
  }

  /**
   * Turn the caller's consents the Aeven API completed into connectors. A consent still
   * pending stays; an expired or failed one is dropped.
   * @param owner - the signed-in user whose consents are settled.
   */
  private async settleConsents(owner: string): Promise<void> {
    if (this.broker === undefined) return
    const broker = this.broker
    await Promise.all([...this.consents].filter(([, consent]) => consent.owner === owner && consent.completion === undefined)
      .map(async ([state, consent]) => {
        let status: ConsentStatus
        try {
          status = await broker.status(owner, state)
        } catch (error) {
          // An unreachable API leaves the consent for the next read; a consent the API no longer knows is gone.
          if (error instanceof BrokerError && error.reason === 'not-connected') this.consents.delete(state)
          return
        }
        if (status.status === 'pending') {
          if (consent.expiresAt <= Date.now()) this.consents.delete(state)
          return
        }
        if (status.status === 'failed' || status.result === undefined) {
          this.consentFailures.set(`${owner}\0${consent.provider}`, {
            authorizationFailure: status.error === 'admin-consent-required' ? 'admin-consent-required' : 'failed',
            ...status.adminConsentUrl === undefined ? {} : { adminConsentUrl: status.adminConsentUrl },
          })
          this.consents.delete(state)
          return
        }
        const result = status.result
        consent.completion = this.completeConsent(state, consent, result).catch((error: unknown) => {
          this.consentFailures.set(`${owner}\0${consent.provider}`, { authorizationFailure: 'failed' })
          this.ctx.logger('account-integrations').warn(`connector ${consent.provider} sign-in was not completed: ${error instanceof Error ? error.message : String(error)}`)
        }).finally(() => {
          if (this.consents.get(state) === consent) this.consents.delete(state)
        })
        await consent.completion
      }))
  }

  /**
   * Verify a completed consent's access and store its connector row.
   * @param state - the consent's state value, re-checked so a cancelled consent writes nothing.
   * @param consent - the account-bound consent.
   * @param result - what the Aeven API recorded.
   */
  private async completeConsent(state: string, consent: PendingConsent, result: NonNullable<ConsentStatus['result']>): Promise<void> {
    if (consent.provider === 'discord') {
      await this.recordDiscordInstall(consent, result)
      return
    }
    const broker = this.broker
    if (broker === undefined) throw new Error('connector sign-in is not configured for this deployment')
    const google = googleService(consent.provider)
    const microsoft = microsoftService(consent.provider)
    const endpointUrl = google?.endpoint ?? microsoft?.endpoint ?? 'https://api.githubcopilot.com/mcp/'
    let microsoftRow: z.infer<typeof connectorSchema>['microsoft']
    try {
      const issued = await broker.token(consent.owner, consent.id)
      if (microsoft !== undefined) {
        if (result.account === undefined || result.tenantId === undefined) throw new Error('Microsoft account metadata is missing')
        microsoftRow = { ...result.account, tenantId: result.tenantId }
        await verifyMicrosoft(consent.provider, await microsoftConnection(consent.provider, issued.accessToken,
          avnHomePath('accounts', accountDirectory(consent.owner), 'connectors', consent.id), this.config.timeoutMs), result.account.id, this.config.timeoutMs)
      } else if (google === undefined) await this.verifyMcp(endpointUrl, issued.accessToken)
      else await verifyGoogle(consent.provider, await googleConnection(consent.provider, issued.accessToken,
        avnHomePath('accounts', accountDirectory(consent.owner), 'connectors', consent.id), this.config.timeoutMs), this.config.timeoutMs)
      if (this.consents.get(state) !== consent) throw new Error('connector sign-in was cancelled')
      this.issuedTokens.set(consent.id, issued)
    } catch (error) {
      // An account the provider granted but whose API access fails is not kept anywhere.
      await broker.remove(consent.owner, consent.id).catch(() => undefined)
      throw error
    }
    // A grant from before the broker may still sit in the credential provider; the API's grant replaces it.
    await this.ctx.credentials.deleteRecord(connectorCredential(consent.owner, consent.id))
    await this.domain.table('connectors').put(consent.id, {
      owner: consent.owner, id: consent.id, provider: consent.provider, name: result.account?.username ?? consent.provider,
      endpoint: endpointUrl, enabled: true, grant: { scopes: result.scopes ?? [] },
      ...microsoftRow === undefined ? {} : { microsoft: microsoftRow },
    })
    this.consentFailures.delete(`${consent.owner}\0${consent.provider}`)
    this.connected.add(consent.id)
    this.invalidateSkills()
  }

  /**
   * Synchronize an agent's connectors, joining a run already in flight for it.
   * @param agent - the agent whose connectors to mount.
   * @returns when the agent's connectors match the stored accounts.
   */
  private syncOnce(agent: Agent): Promise<void> {
    const running = this.syncing.get(agent)
    if (running !== undefined) return running
    const run = this.syncConnectors(agent).finally(() => { this.syncing.delete(agent) })
    this.syncing.set(agent, run)
    return run
  }

  private async syncConnectors(agent: Agent): Promise<void> {
    const owner = agent.session.header.owner
    if (owner === undefined) return
    let owned = this.mounts.get(agent)
    if (owned === undefined) {
      owned = { scope: createScope(this.ctx, agent), connections: new Map() }
      this.mounts.set(agent, owned)
      const scope = owned.scope
      agent.ctx.effect(() => async () => {
        await scope.dispose()
        this.mounts.delete(agent)
      }, 'account-integrations: agent connections')
    }
    const mounts = owned.connections
    // Email rows have no MCP server; their tools come from the mail capability. WhatsApp and
    // Telegram rows get their endpoint and bearer token from their running daemon, and a Discord
    // row gets a stdio server of its own that serves that guild alone.
    const connectors = [...this.domain.table('connectors').entries()].flatMap(([id, connector]) => {
      const google = googleService(connector.provider)
      const microsoft = microsoftService(connector.provider)
      const mountable = connector.owner === owner && connector.enabled
        && (connector.endpoint !== undefined || connector.provider === 'whatsapp'
          || connector.provider === 'telegram' || connector.provider === 'discord')
        && connector.provider !== 'email'
        && (google === undefined || connector.endpoint === google.endpoint)
        && (microsoft === undefined || connector.endpoint === microsoft.endpoint)
      return mountable ? [[id, connector] as const] : []
    })
    for (const [id, mount] of mounts) {
      if (!connectors.some(([active]) => active === id)) { await mount.fiber.dispose(); mounts.delete(id) }
    }
    // Each connector checks its sign-in, fetches its token and opens its own server, independently of the others,
    // so they connect together: the first step of a conversation waits for the slowest account, not for all of them.
    await Promise.all(connectors.map(async ([id, saved]) => {
      const daemon = saved.provider === 'whatsapp' ? await this.linkedWhatsApp(id, saved)
        : saved.provider === 'telegram' ? await this.linkedTelegram(id, saved) : undefined
      const connector = this.domain.table('connectors').get(id) ?? saved
      const daemonRequired = connector.provider === 'whatsapp' || connector.provider === 'telegram'
      if (!await this.isConnected(connector) || (daemonRequired && daemon === undefined)) {
        const linked = connector.provider === 'whatsapp' ? connector.whatsapp?.linked : connector.provider === 'telegram' ? connector.telegram?.linked : undefined
        if (linked !== true) this.connected.delete(id)
        await this.unmountConnector(id)
        this.invalidateSkills()
        return
      }
      if (connector.provider === 'discord' && !await this.discordPresent(id, connector)) {
        await this.markDiscordUnlinked(id)
        return
      }
      this.connected.add(id)
      const google = googleService(connector.provider)
      const microsoft = microsoftService(connector.provider)
      let token: string
      let stdio: ReturnType<AccountIntegrations['discordServer']>
      try {
        // A Discord child authenticates to the API's proxy as the owner; its environment changes when
        // the owner's session rotates, which restarts the child with the new session below.
        if (connector.provider === 'discord') {
          const broker = this.broker
          if (broker === undefined) throw new Error('Discord sign-in is not configured for this deployment')
          token = daemon?.token ?? ''
          stdio = this.discordServer(connector, await broker.session(owner))
        } else {
          token = daemon?.token ?? await this.accessToken(owner, connector)
          stdio = undefined
        }
      } catch (error) {
        this.ctx.logger('account-integrations').warn(`connector ${id} is unavailable this step: ${error instanceof Error ? error.message : String(error)}`)
        await this.unmountConnector(id)
        return
      }
      const url = daemon?.endpoint ?? connector.endpoint ?? ''
      // Mounts are kept across steps while what the server needs has not changed: the endpoint and
      // token of a remote server, or the entry and guild of a local one.
      const key = stdio === undefined ? `${token}\0${url}` : `${stdio.command}\0${stdio.args.join(' ')}\0${Object.entries(stdio.env).sort().flat().join('\0')}`
      const existing = mounts.get(id)
      if (existing?.key === key) return
      if (existing !== undefined) { await existing.fiber.dispose(); mounts.delete(id) }
      const serverName = connectorServerName(id, connector.provider)
      const title = `${providerTitles[connector.provider]} (${connector.name})`
      const fiber = owned.scope.ctx.plugin(mcp, stdio !== undefined ? {
        transport: 'stdio', serverName, title, command: stdio.command, args: stdio.args, env: stdio.env,
        toolCallTimeoutMs: this.config.timeoutMs, failOnStartupError: true, reconnect: { enabled: false },
      } : microsoft !== undefined ? { ...await microsoftConnection(connector.provider, token,
        avnHomePath('accounts', accountDirectory(owner), 'connectors', id), this.config.timeoutMs), serverName, title } : google === undefined ? {
        transport: 'streamable-http', serverName, title,
        url, headers: token === '' ? {} : { Authorization: `Bearer ${token}` },
        toolCallTimeoutMs: this.config.timeoutMs, failOnStartupError: true, reconnect: { enabled: false },
      } : { ...await googleConnection(connector.provider, token,
        avnHomePath('accounts', accountDirectory(owner), 'connectors', id), this.config.timeoutMs), serverName, title })
      try {
        await fiber
      } catch (error) {
        // One account that cannot connect must not end the conversation's turn: the step runs without that
        // account's tools, and the next step tries to connect it again.
        await fiber.dispose()
        this.ctx.logger('account-integrations').warn(`connector ${id} could not connect: ${error instanceof Error ? error.message : String(error)}`)
        return
      }
      mounts.set(id, { key, fiber })
    }))
  }

  private async verifyMcp(url: string, token?: string): Promise<void> {
    const client = new Client({ name: 'aeven-account-connectors', version: '1.0.0' })
    try {
      // The SDK transport's optional sessionId declaration is narrower than its implementation.
      await client.connect(new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: token === undefined ? {} : { Authorization: `Bearer ${token}` } },
      }) as Transport, { timeout: this.config.timeoutMs })
      await client.listTools({}, { timeout: this.config.timeoutMs })
    } finally {
      await client.close()
    }
  }
}
