/** Account-owned integration settings exchanged with the browser. */

import type { Branded } from '@aeven/brand'

/** Durable identity of one account's connector. */
export type ConnectorId = Branded<'account-connector-id'>

/** Provider selected when creating a connector. */
export type ConnectorProvider = 'github' | 'gmail' | 'google-drive' | 'google-calendar' | 'outlook' | 'outlook-calendar' | 'onedrive' | 'sharepoint' | 'teams' | 'mcp' | 'email' | 'whatsapp' | 'telegram' | 'discord' | 'slack'

/** Stable Settings identity of one skill definition. */
export type SkillViewId = Branded<'account-skill-view-id'>

/** One skill Settings lists: the account's own library entry, or a skill a connector owns. */
export interface PersonalSkillView {
  id: SkillViewId
  name: string
  description: string
  enabled: boolean
  content: string
  files: string[]
  /** `account` for an imported bundle; the discovery source of a connector-owned skill. */
  source: string
  /** Install progress for a skill whose tools are prepared after it is enabled; absent for skills that need none. */
  setup?: SkillSetup
}

/** Progress of the tool installation a heavy skill starts when it is enabled. */
export interface SkillSetup {
  /** `installing` while work is running, `ready` once tools answer, `failed` until a retry starts. */
  state: 'installing' | 'ready' | 'failed'
  /** Why the last attempt failed; present with `failed` so Settings can say what to fix. */
  detail?: string | undefined
}

/** Connector metadata; credentials are never returned. */
export interface PersonalConnectorView {
  id: ConnectorId
  provider: ConnectorProvider
  name: string
  enabled: boolean
  connected: boolean
  endpoint?: string
  /** Server settings of an `email` connector; passwords are never returned. */
  email?: EmailConnectorSettings
  /** Microsoft account identity and refresh tenant; contains no tokens. */
  microsoft?: MicrosoftConnectorSettings
  /** Linked account of a `whatsapp` connector. */
  whatsapp?: WhatsAppConnectorSettings
  /** Signed-in account of a `telegram` connector. */
  telegram?: TelegramConnectorSettings
  /** Guild one `discord` connector is installed into. */
  discord?: DiscordConnectorSettings
  /** Workspace one `slack` connector is connected to; the user token stays private. */
  slack?: SlackConnectorSettings
}

/** The Slack workspace one `slack` connector is connected to, and the account that consented. */
export interface SlackConnectorSettings {
  /** Slack team id; two connectors of one account may not carry the same one. */
  teamId: string
  /** Workspace name Slack reports. */
  teamName: string
  /** Workspace domain, when Slack reported a usable workspace URL. */
  domain?: string
  /** Slack user id of the account that consented. */
  userId: string
  /** That account's Slack username. */
  userName: string
  /** User scopes the workspace granted. */
  scopes: string[]
  /** False once Slack refuses the stored token and the workspace has to be connected again. */
  linked: boolean
}

/** Non-secret Microsoft identity recorded after broker consent and Graph verification. */
export interface MicrosoftConnectorSettings {
  id: string
  name: string
  username: string
  tenantId: string
}

/** One installable skill from the vendored catalog. */
export interface CatalogSkillView {
  /** Name the skill installs under, which is also the name the library then lists. */
  name: string
  /** Upstream name, which may not be kebab-case. */
  displayName: string
  category: string
  description: string
  keywords: string[]
  /** Upstream install count when the catalog was vendored, shown beside the row. */
  downloads: number
  author: string
  path: string
  bytes: number
  /** Reviewed judgement against the harness native surface; absent until curation covers the skill. */
  verdict?: string
  /** Reviewed value 1-5; Settings shows the recommended set by default. */
  value?: number
}

/** The vendored catalog Settings browses and installs from. */
export interface SkillCatalogView {
  /** Upstream commit the catalog was vendored from. */
  commit: string
  /** Date that vendoring ran. */
  synced: string
  categories: { name: string; skills: number }[]
  skills: CatalogSkillView[]
}

/** Current signed-in account's skills and connectors. */
export interface AccountIntegrationsView {
  /** The account's own skill library: imported bundles and installed skills, minus connector-owned names. */
  skills: PersonalSkillView[]
  connectors: PersonalConnectorView[]
  providers: ConnectorProviderView[]
}

/** Deployment sign-in availability; contains no OAuth secrets. */
export interface ConnectorProviderView {
  provider: ConnectorProvider
  configured: boolean
  /** Last consent failure for this provider in the current Host session. */
  authorizationFailure?: 'admin-consent-required' | 'failed'
  /** Application-specific administrator approval link supplied by the Aeven API. */
  adminConsentUrl?: string
  /** Skill definitions this connector owns; its connection decides whether they are invocable. */
  skills: PersonalSkillView[]
}

/** Link for an account-bound provider consent flow. */
export interface ConnectorAuthorization {
  url: string
}

/** Coding agent whose skills Settings offers to import. */
export type SystemSkillAgent = 'claude' | 'codex'

/** One skill installed for another coding agent on this computer. */
export interface SystemSkillView {
  /** Handle the install call sends back: the agent, then the skill directory below its home. */
  id: string
  /** Skill name from the skill's frontmatter. */
  name: string
  /** Agent whose home holds the skill. */
  agent: SystemSkillAgent
  /** Description the skill declares. */
  description: string
}

/** One reference the account library already provides under another name. */
export interface SkillImportSkip {
  /** Skill name the reference declares. */
  name: string
  /** Why the import left it alone: a skill Aeven ships or the agent itself supplies owns the name. */
  reason: 'built-in'
}

/** What one repository or package reference added to the account library. */
export interface SkillReferenceImport {
  /** Names the import added, in the order the archive carried them. */
  imported: string[]
  /** Skills the import left alone. */
  skipped: SkillImportSkip[]
}

/** One uploaded bundle file, relative to its SKILL.md directory. */
export interface SkillUploadFile {
  path: string
  base64: string
}

/** Connector creation fields; token is write-only. */
export interface ConnectorCreateRequest {
  provider: ConnectorProvider
  name: string
  endpoint?: string
  token?: string
}

/** Transport security of one email server: implicit TLS or a mandatory STARTTLS upgrade. */
export type EmailSecurity = 'tls' | 'starttls'

/** One email server binding. */
export interface EmailServerSettings {
  host: string
  port: number
  security: EmailSecurity
  username: string
}

/** The receive binding; POP3 requires implicit TLS. */
export interface EmailReceiveSettings extends EmailServerSettings {
  protocol: 'imap' | 'pop3'
}

/** Non-secret settings of one email account. */
export interface EmailConnectorSettings {
  address: string
  /** Further addresses the account may send as. */
  aliases: string[]
  receive: EmailReceiveSettings
  /** Absent for a receive-only account. */
  send?: EmailServerSettings
}

/** Email account creation fields; passwords are write-only. */
export interface EmailConnectionRequest extends EmailConnectorSettings {
  /** Display name; defaults to the address. */
  name?: string
  receivePassword: string
  /** Absent when the send binding reuses the receive password. */
  sendPassword?: string
}

/** Email account edit fields; an absent password keeps the stored one. */
export interface EmailConnectionUpdate extends EmailConnectorSettings {
  name?: string
  receivePassword?: string
  sendPassword?: string
}

/** Verification step that failed while adding an email account. */
export type EmailProbeStep = 'receive-connect' | 'receive-authenticate' | 'receive-list' | 'send-connect' | 'send-authenticate'

/** Why an email account could not be added. */
export type EmailConnectionFailure = 'authentication' | 'connection' | 'tls' | 'invalid' | 'duplicate' | 'limit' | 'unavailable' | 'other'

/** Outcome of adding an email account. */
export type EmailConnectionResult =
  | { kind: 'connected'; id: ConnectorId }
  | { kind: 'failed'; reason: EmailConnectionFailure; step?: EmailProbeStep }

/** The WhatsApp account one `whatsapp` connector is linked to. */
export interface WhatsAppConnectorSettings {
  /** International number without `+`, as WhatsApp reports it. */
  phone: string
  /** The account's WhatsApp profile name, when it has one. */
  profileName?: string
}

/**
 * Progress of linking a WhatsApp number.
 * `qr` carries the code to scan; `connected` means the number was saved as a connector;
 * `expired`, `failed`, `duplicate`, `limit`, and `unavailable` are terminal and need a new attempt.
 */
export type WhatsAppPairingState = 'starting' | 'qr' | 'connected' | 'expired' | 'failed' | 'duplicate' | 'limit' | 'unavailable'

/** One WhatsApp linking attempt as shown in Settings. */
export interface WhatsAppPairingView {
  /** Identity of the attempt and of the connector it creates; absent when the attempt could not start. */
  id?: ConnectorId
  state: WhatsAppPairingState
  /** PNG data URL of the current QR code, present only in the `qr` state. */
  qr?: string
}

/** The Telegram account one `telegram` connector is signed in to. */
export interface TelegramConnectorSettings {
  /** Telegram user id; two connectors may not carry the same one. */
  userId: string
  /** Display name Telegram reports. */
  name?: string
  /** Public username without the leading `@`. */
  username?: string
  /** International number without `+`, when the account has one. */
  phone?: string
}

/**
 * Why Telegram refused the last submitted step. Mirrors the daemon's fixed
 * reasons, which replace Telegram's own error text.
 */
export type TelegramLoginFailure = 'code-invalid' | 'password-invalid' | 'phone-invalid' | 'too-many-attempts' | 'unreachable' | 'other'

/**
 * Progress of signing in a Telegram account.
 * `code` and `password` wait for the value the user types, and `qr` waits for the Telegram app to
 * scan the login code; `connected` means the account was
 * saved as a connector; `unlinked`, `expired`, `failed`, `duplicate`, `limit`, and `unavailable`
 * are terminal and need a new attempt.
 */
export type TelegramPairingState = 'starting' | 'code' | 'qr' | 'password' | 'connected' | 'unlinked' | 'expired' | 'failed' | 'duplicate' | 'limit' | 'unavailable'

/** One Telegram sign-in attempt as shown in Settings. */
export interface TelegramPairingView {
  /** Identity of the attempt and of the connector it creates; absent when the attempt could not start. */
  id?: ConnectorId
  state: TelegramPairingState
  /** Number the attempt is signing in. */
  phone?: string
  /** Why Telegram refused the last submitted step; the same step accepts another value. */
  reason?: TelegramLoginFailure
  /** The signed-in account, present once it was saved as a connector. */
  account?: TelegramConnectorSettings
  /** Image data URL of the current login QR code, present in the `qr` state once Telegram issued a token. */
  qr?: string
}

/**
 * The guild one `discord` connector is installed into. Every guild row is
 * backed by the same Aeven Discord application and bot; the guild id is what
 * makes two rows distinct, and the bot token stays on the Aeven API.
 */
export interface DiscordConnectorSettings {
  /** Registered Aeven Discord application the bot belongs to. */
  applicationId: string
  /** Bot user id of that application. */
  botUserId: string
  /** Guild id; two connectors of one account may not carry the same one. */
  guildId: string
  /** Guild name Discord reports. */
  guildName: string
  /** Icon URL of the guild, when it has one. */
  icon?: string
  /** Aeven account that authorized the installation, when Discord reported it. */
  installedById?: string
  /** Display name of that account. */
  installedByName?: string
  /** False once the bot is no longer a member of the guild. */
  linked: boolean
}
