/** Personal skill storage and account-scoped MCP connections exposed to Settings. */

import { createHash, randomUUID } from 'node:crypto'
import { realpath, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { Context, Service, type Fiber } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { z } from 'zod'
import { Remote, TypertRemoteService } from '@aeven/typert-protocol'
import { defineDomain, domainTable, type Domain } from '@aeven/storage-domain'
import { assertNever } from '@aeven/util-values'
import { credentialRef } from '@aeven/credentials'
import { avnHomePath } from '@aeven/home-paths'
import { createScope, type Scope } from '@aeven/scope'
import type {} from '@aeven/identity-user'
import type { Agent, PreStepDecision } from '@aeven/agent'
import type {} from '@aeven/tools'
import type {} from '@aeven/workspace'
import type {} from '@aeven/agent-presets/types'
import { isSkillName, type SkillCandidate } from '@aeven/skill'
import type {} from '@aeven/host-webserver'
import { MailError, type MailAccount, type MailAccountId, type MailSecret } from '@aeven/mail'
import * as mcp from '@aeven/mcp-client'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { googleConnection, googleService, verifyGoogle } from './google.ts'
import { parsePersonalSkill } from './skills.ts'
import { resolveWhatsAppBinary, WhatsAppDaemon } from './whatsapp.ts'
import { resolveTelegramEntry, TelegramDaemon, type TelegramCredentials, type TelegramDaemonStatus } from './telegram.ts'
import { connectorCredential, createConsent, exchangeGrant, grantSchema } from './oauth.ts'
import type { OAuthProviderConfig, PendingConsent } from './oauth.ts'
import type { AccountIntegrationsView, ConnectorAuthorization, ConnectorCreateRequest, ConnectorId, ConnectorProvider, ConnectorProviderView, EmailConnectionFailure, EmailConnectorSettings, EmailConnectionRequest, EmailConnectionResult, EmailConnectionUpdate, SkillViewId, SkillUploadFile, TelegramConnectorSettings, TelegramPairingView, WhatsAppPairingView } from './types.ts'

export type * from './types.ts'
export type { OAuthProviderConfig } from './oauth.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Signed-in account integration management. */
    accountIntegrations: AccountIntegrations
  }
}

/** Deployment upload, network, and registered OAuth application settings. */
export interface Config {
  /** Largest decoded skill bundle. */
  maxSkillBytes: number
  /** MCP discovery, tool, and OAuth request budget. */
  timeoutMs: number
  /** Maximum time between consent initiation and callback. */
  consentLifetimeMs: number
  /** Registered callback URL; must end in /connectors/oauth/callback. */
  redirectUri: string
  /** Email accounts one signed-in user may connect. */
  maxEmailAccounts: number
  /** WhatsApp numbers one signed-in user may link. */
  maxWhatsAppAccounts: number
  /** Telegram accounts one signed-in user may sign in. */
  maxTelegramAccounts: number
  /** WhatsApp daemon executable; defaults to the platform package installed for this host. */
  whatsappBinaryPath?: string
  /** Telegram daemon entry; defaults to the vendored package installed for this host. */
  telegramEntryPath?: string
  /** Credential reference holding the deployment's Telegram application id. */
  telegramApiIdRef: string
  /** Credential reference holding the deployment's Telegram application hash. */
  telegramApiHashRef: string
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
  /** Deployment-owned OAuth applications for Google, GitHub and Microsoft 365 MCP resources. */
  providers: Partial<Record<'github' | 'google' | 'microsoft365', OAuthProviderConfig>>
}

const skillSchema = z.object({
  owner: z.string(), name: z.string().refine(isSkillName), description: z.string(), content: z.string(), enabled: z.boolean(),
  modelInvocable: z.boolean(), userInvocable: z.boolean(),
  resources: z.record(z.string().refine(path => !path.startsWith('/') && !path.includes('\\') && !/^[A-Za-z]:/.test(path)
    && path.split('/').every(part => part !== '' && part !== '.' && part !== '..')), z.string()), revision: z.uuid(),
})
const providers = ['github', 'gmail', 'google-drive', 'google-calendar', 'microsoft365', 'email', 'whatsapp', 'telegram', 'mcp'] as const satisfies readonly ConnectorProvider[]
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
const emailRequestSchema = emailSettingsSchema.extend({
  name: z.string().trim().min(1).max(100).optional(), receivePassword: z.string().min(1).max(1024), sendPassword: z.string().min(1).max(1024).optional(),
})
const emailUpdateSchema = emailSettingsSchema.extend({
  name: z.string().trim().min(1).max(100).optional(), receivePassword: z.string().min(1).max(1024).optional(), sendPassword: z.string().min(1).max(1024).optional(),
})
const connectorSchema = z.object({
  owner: z.string(), id: z.string().transform(value => value as ConnectorId),
  provider: z.enum(providers), name: z.string(),
  /** Absent for `email`, which has server settings instead of an MCP endpoint. */
  endpoint: z.url().optional(), enabled: z.boolean(),
  email: emailSettingsSchema.optional(),
  /** Set when a mail server rejected the stored password; the account needs to be added again. */
  authFailed: z.boolean().optional(),
  /** Linked account of a `whatsapp` row; `linked` turns false when the phone removes the device. */
  whatsapp: z.object({ phone: z.string(), profileName: z.string().optional(), linked: z.boolean() }).optional(),
  /** Signed-in account of a `telegram` row; `linked` turns false when Telegram rejects the session. */
  telegram: z.object({
    userId: z.string(), name: z.string().optional(), username: z.string().optional(), phone: z.string().optional(), linked: z.boolean(),
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
  return { userId, ...name === undefined ? {} : { name }, ...username === undefined ? {} : { username }, ...phone === undefined ? {} : { phone } }
}

/**
 * Connector id of one Telegram account of one user, the same for every sign-in of that account, so the
 * account's tool names (`mcp__account_<id prefix>__…`) survive signing it in again.
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

const uploadsSchema = z.array(z.object({ path: z.string().min(1), base64: z.string() })).min(1)
const callbackPath = '/connectors/oauth/callback'

/** Connector-owned skill names; bodies and resources remain in the skill registry. */
const connectorSkills: Record<ConnectorProvider, readonly string[]> = {
  'google-drive': ['google-drive', 'google-docs', 'google-sheets', 'google-slides', 'google-drive-comments', 'google-forms'],
  gmail: ['gmail'], 'google-calendar': ['google-calendar'], github: ['github'], microsoft365: [], mcp: [], email: [], whatsapp: ['whatsapp'], telegram: ['telegram'],
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
  static inject = ['typert', 'identityUsers', 'storageDomain', 'credentials', 'skills', 'agents', 'tools', 'workspaceRegistry']

  static Config: Schema<Config> = Schema.object({
    maxSkillBytes: Schema.natural().min(1).default(10 * 1024 * 1024),
    timeoutMs: Schema.natural().min(1).default(60_000),
    consentLifetimeMs: Schema.natural().min(1).default(600_000),
    maxEmailAccounts: Schema.natural().min(1).default(20),
    maxWhatsAppAccounts: Schema.natural().min(1).default(10),
    maxTelegramAccounts: Schema.natural().min(1).default(10),
    whatsappBinaryPath: Schema.string(),
    telegramEntryPath: Schema.string(),
    telegramApiIdRef: Schema.string().default('TELEGRAM_API_ID'),
    telegramApiHashRef: Schema.string().default('TELEGRAM_API_HASH'),
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
    redirectUri: Schema.string().default(`http://127.0.0.1:3080${callbackPath}`),
    providers: Schema.dict(Schema.object({
      endpoint: Schema.string(), authorizationUrl: Schema.string().required(), tokenUrl: Schema.string().required(),
      clientId: Schema.string().required(), clientSecretRef: Schema.string(), scopes: Schema.array(String).default([]),
    })).default({}),
  })

  private domain!: Domain<typeof domainSpec>
  private invalidateSkills: () => void = () => {}
  private readonly connected = new Set<ConnectorId>()
  private readonly consents = new Map<string, PendingConsent>()
  private readonly whatsappBinary: string | undefined
  private readonly telegramEntry: string | undefined
  private readonly whatsapp = new Map<ConnectorId, SupervisedWhatsApp>()
  private readonly telegram = new Map<ConnectorId, SupervisedTelegram>()
  private readonly pairings = new Map<ConnectorId, WhatsAppPairing>()
  private readonly telegramPairings = new Map<ConnectorId, TelegramPairing>()
  private readonly mounts = new Map<Agent, {
    scope: Scope
    connections: Map<ConnectorId, { token: string; endpoint: string; fiber: Fiber }>
  }>()

  /**
   * @param ctx - identity, durable storage, credentials, skills, and tools context.
   * @param config - deployment limits and provider registrations.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'accountIntegrations')
    this.whatsappBinary = resolveWhatsAppBinary(config.whatsappBinaryPath)
    this.telegramEntry = resolveTelegramEntry(config.telegramEntryPath)
    const redirect = new URL(endpoint(config.redirectUri))
    if (redirect.pathname !== callbackPath || redirect.search) throw new Error(`connector callback URL must end in ${callbackPath}`)
    for (const [provider, app] of Object.entries(config.providers)) {
      if (!['github', 'google', 'microsoft365'].includes(provider)) throw new Error(`unknown connector provider: ${provider}`)
      if (provider !== 'google' && app.scopes.length === 0) throw new Error(`${provider} requires explicit OAuth scopes`)
      if (provider !== 'google' && app.endpoint === undefined) throw new Error(`${provider} requires an MCP endpoint`)
      if (app.endpoint !== undefined) endpoint(app.endpoint)
      if (new URL(app.authorizationUrl).protocol !== 'https:' || new URL(app.tokenUrl).protocol !== 'https:') {
        throw new Error('provider OAuth endpoints require HTTPS')
      }
    }
  }

  /** Open account data and register reversible skill, tool, and callback contributions. */
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
        list: async options => options.owner === undefined ? [] : [...this.domain.table('skills').entries()]
          .filter(([, skill]) => skill.owner === options.owner && skill.enabled)
          .map(([key, skill]): SkillCandidate => ({
            name: skill.name, description: skill.description, source: 'account', provider: 'account-integrations',
            invocation: { modelInvocable: skill.modelInvocable, userInvocable: skill.userInvocable },
            rank: 350, locator: key,
          })),
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
        list: async owner => [...this.domain.table('connectors').entries()].flatMap(([id, connector]): MailAccount[] =>
          connector.owner === owner && connector.provider === 'email' && connector.enabled && connector.authFailed !== true && connector.email !== undefined
            ? [{ id: id as string as MailAccountId, owner, settings: emailSettings(connector.email) }]
            : []),
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
    this.ctx.on('agent/pre-step', async ({ agent }, next): Promise<PreStepDecision> => {
      await this.syncConnectors(agent)
      return next()
    })
    this.ctx.on('tools/pre-execute', async (exec, next) => {
      const match = /^mcp__account_([a-f0-9]{24})__/.exec(exec.name)
      if (match !== null) {
        const connector = [...this.domain.table('connectors').entries()].find(([id]) => id.replaceAll('-', '').slice(0, 24) === match[1])?.[1]
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
          const record = await this.ctx.credentials.readRecord(connectorCredential(connector.owner, connector.id))
          if (record?.kind !== 'grant' || grantSchema.parse(record.payload).scopes?.includes(google.scopes[0]) !== true) {
            return { kind: 'deny', reason: 'Reconnect this Google account in Settings to grant the required permissions.' }
          }
          if (exec.name.endsWith('__workspace_raw')) {
            const args = exec.arguments as { service: string; path: string[] }
            if (!args.path.every(part => /^[A-Za-z][A-Za-z0-9]*$/.test(part))) {
              return { kind: 'deny', reason: 'Workspace API paths must contain resource and method names, without CLI options or file paths.' }
            }
            const formEdit = args.service === 'forms' && args.path.length === 2 && args.path[0] === 'forms'
              && /^(create|batchUpdate)$/.test(args.path[1]!)
            if (!formEdit && !/^(get|list|export|download)$/i.test(args.path.at(-1)!)) {
              return { kind: 'ask', reason: 'Approve this change to your connected Google account.' }
            }
          }
          if (/__(gmail_send_draft|drive_share|drive_trash|calendar_delete_event)$/.test(exec.name)) {
            return { kind: 'ask', reason: 'Approve sending, sharing, or deleting through your connected Google account.' }
          }
        }
        if (connector.provider === 'whatsapp' && !whatsappReadTools.has(exec.name.slice(match[0].length))) {
          return { kind: 'ask', reason: 'Approve this action on your linked WhatsApp number. Other people can see it.' }
        }
        if (connector.provider === 'telegram' && !telegramReadTools.has(exec.name.slice(match[0].length))) {
          return { kind: 'ask', reason: 'Approve this action on your signed-in Telegram account. Other people can see it.' }
        }
      }
      return next()
    })
    this.ctx.effect(() => () => {
      this.consents.clear()
      this.connected.clear()
      this.mounts.clear()
    }, 'account-integrations: connector scopes')
    this.ctx.inject(['webServer'], (ctx) => {
      ctx.effect(() => ctx.webServer.register({
        kind: 'exact', path: callbackPath,
        handler: async (request, response) => {
          const url = new URL(request.url!, this.config.redirectUri)
          const state = url.searchParams.get('state')
          const consent = state === null ? undefined : this.consents.get(state)
          response.setHeader('Cache-Control', 'no-store')
          response.setHeader('Referrer-Policy', 'no-referrer')
          const finish = (status: 200 | 400 | 502, detail?: { en: string; zh: string }): void => {
            const chinese = request.headers['accept-language']?.startsWith('zh') === true
            const title = status === 200 ? (chinese ? '账户已连接' : 'Account connected') : (chinese ? '连接未完成' : 'Connection not completed')
            const message = detail !== undefined ? (chinese ? detail.zh : detail.en) : status === 200
              ? (chinese ? '您可以关闭此窗口并返回 Aeven。' : 'You can close this window and return to Aeven.')
              : (chinese ? '请返回 Aeven 并重新开始登录。您可以关闭此窗口。' : 'Return to Aeven and start sign-in again. You can close this window.')
            response.writeHead(status, {
              'Content-Type': 'text/html; charset=utf-8',
              'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
            }).end(`<!doctype html><html lang="${chinese ? 'zh' : 'en'}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Aeven</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f6f5;color:#202020;font:16px/1.6 system-ui,sans-serif}main{max-width:440px;margin:24px;padding:40px;border:1px solid #e4e4e1;border-radius:20px;background:white;text-align:center}small{color:#666}h1{font-size:26px;line-height:1.3}p{color:#666}.mark{font-size:36px}</style><main><small>Aeven</small><div class="mark" aria-hidden="true">${status === 200 ? '✓' : '!'}</div><h1>${title}</h1><p>${message}</p></main></html>`)
          }

          const code = url.searchParams.get('code')
          if (request.method !== 'GET' || state === null || consent === undefined || consent.completion !== undefined || consent.expiresAt <= Date.now() || code === null || url.searchParams.has('error')) {
            finish(400, { en: 'Sign-in expired, was cancelled, or was already completed. Return to Aeven and start a new sign-in.', zh: '登录已过期、已取消或已完成。请返回 Aeven 并重新开始登录。' })
            return
          }
          const completion = (async (): Promise<void> => {
            let failure = { en: 'The account token could not be obtained. Check the configured OAuth client ID and secret, then start a new sign-in in Aeven.', zh: '无法获取账户令牌。请检查 OAuth 客户端 ID 和密钥，然后在 Aeven 中重新开始登录。' }
            try {
              const provider = this.oauthApplication(consent.provider)
              if (provider === undefined) throw new Error('connector provider is not configured')
              const grant = await exchangeGrant(this.ctx, provider, {
                grant_type: 'authorization_code', code, code_verifier: consent.verifier, redirect_uri: this.config.redirectUri,
              }, AbortSignal.timeout(this.config.timeoutMs))
              const google = googleService(consent.provider)
              failure = google === undefined
                ? { en: 'The connector could not verify account access. Check the provider permissions and start a new sign-in in Aeven.', zh: '连接器无法验证账户访问权限。请检查提供商权限，然后在 Aeven 中重新开始登录。' }
                : { en: 'Google API access could not be verified. Enable the selected service API in the OAuth application’s Google Cloud project, grant the requested permissions, then start a new sign-in in Aeven.', zh: '无法验证 Google API 访问权限。请在 OAuth 应用的 Google Cloud 项目中启用所选服务的 API 并授予请求的权限，然后在 Aeven 中重新开始登录。' }
              if (google === undefined) await this.verifyMcp(provider.endpoint!, grant.accessToken)
              else await verifyGoogle(consent.provider, await googleConnection(consent.provider, grant.accessToken,
                avnHomePath('accounts', accountDirectory(consent.owner), 'connectors', consent.id), this.config.timeoutMs), this.config.timeoutMs)
              failure = { en: 'The connection could not be saved. Return to Aeven and start a new sign-in.', zh: '无法保存连接。请返回 Aeven 并重新开始登录。' }
              if (this.consents.get(state) !== consent) throw new Error('connector sign-in was cancelled')
              await this.ctx.credentials.modifyRecord(connectorCredential(consent.owner, consent.id), async () => ({ kind: 'grant', payload: grant }))
              await this.domain.table('connectors').put(consent.id, {
                owner: consent.owner, id: consent.id, provider: consent.provider,
                name: consent.provider, endpoint: google?.endpoint ?? provider.endpoint!, enabled: true,
              })
              this.connected.add(consent.id)
              this.invalidateSkills()
              finish(200)
            } catch {
            // Provider responses may contain credentials; only fixed messages for the failed step are shown.
              finish(502, failure)
            } finally {
              if (this.consents.get(state) === consent) this.consents.delete(state)
            }
          })()
          consent.completion = completion
          await completion
        },
      }), 'account-integrations: OAuth callback')
    })
  }

  /**
   * Read the caller's integrations without exposing credentials.
   * @returns visible skills, personal connections, and deployment sign-in availability.
   */
  @Remote
  async list(): Promise<AccountIntegrationsView> {
    const owner = this.owner()
    const connectors = [...this.domain.table('connectors').entries()].filter(([, item]) => item.owner === owner)
    const personal = [...this.domain.table('skills').entries()].filter(([, item]) => item.owner === owner)
      .map(([, item]) => ({ id: `${accountDirectory(owner)}:${item.name}` as SkillViewId, name: item.name, description: item.description, content: item.content, enabled: this.domain.table('skill_preferences').get(`${accountDirectory(owner)}:${item.name}`)?.enabled ?? item.enabled,
        files: Object.keys(item.resources), source: 'account', managed: true }))
    const scope = await this.ctx.get('agentPresets')?.standingKeyFor()
    const workspaces = this.ctx.workspaceRegistry.list().filter(workspace => workspace.owner === owner && workspace.kind === 'folder')
    const views = [{ cwd: undefined as string | undefined, workspace: undefined as string | undefined },
      ...workspaces.map(workspace => ({ cwd: workspace.path, workspace: workspace.title }))]
    const existing = new Map<string, AccountIntegrationsView['skills'][number]>()
    for (const view of views) {
      const options = { owner, cwd: view.cwd, scope }
      const catalog = (await this.ctx.skills.list(options)).filter(skill => skill.provider !== 'account-integrations')
      for (const skill of catalog) {
        const definition = await this.ctx.skills.get(skill.name, options)
        if (definition === undefined) throw new Error('skill is no longer available')
        const key = definition.path === undefined
          ? `${skill.provider}:${skill.source}:${skill.name}`
          : `file:${await realpath(definition.path)}`
        if (existing.has(key)) continue
        existing.set(key, { id: createHash('sha256').update(key).digest('hex') as SkillViewId, name: skill.name, description: skill.description, content: definition.content,
          enabled: this.domain.table('skill_preferences').get(`${accountDirectory(owner)}:${skill.name}`)?.enabled !== false, managed: false, source: skill.source, files: [],
          ...skill.source.startsWith('project-') && view.workspace !== undefined ? { workspace: view.workspace } : {},
        })
      }
    }
    const skills: AccountIntegrationsView['skills'] = [...personal, ...existing.values()].sort((a, b) => a.name.localeCompare(b.name))
    const connections = await Promise.all(connectors.map(async ([id, entry]) => {
      const item = entry.provider === 'whatsapp' ? await this.refreshWhatsApp(id, entry)
        : entry.provider === 'telegram' ? await this.refreshTelegram(id, entry) : entry
      const connected = await this.isConnected(item)
      if (connected) this.connected.add(id)
      else this.connected.delete(id)
      return { id, name: item.name, provider: item.provider, enabled: item.enabled, connected,
        ...item.endpoint !== undefined ? { endpoint: item.endpoint } : {}, ...item.email !== undefined ? { email: emailSettings(item.email) } : {},
        ...item.whatsapp !== undefined ? { whatsapp: { phone: item.whatsapp.phone, ...item.whatsapp.profileName !== undefined ? { profileName: item.whatsapp.profileName } : {} } } : {},
        ...item.telegram !== undefined ? { telegram: telegramSettings(item.telegram) } : {} }
    }))
    for (const skill of skills) {
      if (connectorSkillNames.has(skill.name)) skill.enabled = true
      skill.available = skill.enabled && this.skillConnectorAvailable(skill.name, owner)
    }
    return {
      skills: skills.filter(skill => !connectorSkillNames.has(skill.name)), connectors: connections,
      providers: await Promise.all(providers.map(async (provider): Promise<ConnectorProviderView> => ({
        provider, configured: provider === 'mcp' || (provider === 'email' ? this.ctx.get('mail') !== undefined
          : provider === 'whatsapp' ? this.whatsappBinary !== undefined
            : provider === 'telegram' ? this.telegramEntry !== undefined && await this.telegramCredentials() !== undefined
              : this.oauthApplication(provider) !== undefined && this.ctx.get('webServer') !== undefined),
        skills: connectorSkills[provider].flatMap((name) => {
          const skill = skills.find(candidate => candidate.name === name && candidate.workspace === undefined)
          return skill === undefined ? [] : [skill]
        }),
      }))),
    }
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
    if (input.provider !== 'mcp' && input.provider !== 'github') throw new Error('this provider requires OAuth sign-in')
    const url = endpoint(input.endpoint ?? (input.provider === 'github' ? 'https://api.githubcopilot.com/mcp/' : ''))
    await this.verifyMcp(url, input.token)
    const id = randomUUID() as ConnectorId
    await this.ctx.credentials.modifyRecord(connectorCredential(owner, id), async () => ({ kind: 'api-key', ...input.token === undefined ? {} : { key: input.token } }))
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
    await this.ctx.credentials.modifyRecord(connectorCredential(owner, id), async () => ({ kind: 'grant', payload: secret }))
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
    await this.ctx.credentials.modifyRecord(connectorCredential(owner, id), async () => ({ kind: 'grant', payload: secret }))
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
      if (!(error instanceof MailError)) return { kind: 'failed', reason: 'other' }
      const reasons: Partial<Record<MailError['code'], EmailConnectionFailure>> = {
        MAIL_AUTHENTICATION: 'authentication', MAIL_CONNECTION: 'connection', MAIL_TLS: 'tls', MAIL_INVALID: 'invalid', MAIL_UNSUPPORTED: 'invalid',
      }
      return { kind: 'failed', reason: reasons[error.code] ?? 'other', ...error.step !== undefined ? { step: error.step } : {} }
    }
  }

  /**
   * Start a provider consent flow bound to the authenticated caller.
   * @param provider - registered provider to connect.
   * @returns the provider consent URL.
   */
  @Remote
  async authorize(provider: ConnectorProvider): Promise<ConnectorAuthorization> {
    const owner = this.owner()
    const app = this.oauthApplication(provider)
    if (app === undefined || this.ctx.get('webServer') === undefined) throw new Error('provider sign-in is not configured for this deployment')
    for (const [state, pending] of this.consents) if (pending.expiresAt <= Date.now()) this.consents.delete(state)
    const consent = createConsent(app, this.config.redirectUri, this.config.consentLifetimeMs, { owner, id: ([...this.domain.table('connectors').entries()].find(([, item]) => item.owner === owner && item.provider === provider)?.[0] ?? randomUUID()) as ConnectorId, provider })
    this.consents.set(consent.state, consent.consent)
    return { url: consent.url }
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
    const completions: Promise<void>[] = []
    for (const [state, consent] of this.consents) {
      if (consent.owner !== owner || consent.id !== id) continue
      this.consents.delete(state)
      if (consent.completion !== undefined) completions.push(consent.completion)
    }
    await Promise.all(completions)
    await this.domain.table('connectors').delete(id)
    this.connected.delete(id)
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
    if (this.telegramEntry === undefined || await this.telegramCredentials() === undefined) return { state: 'unavailable' }
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
  private async submitTelegramStep(id: ConnectorId, step: (daemon: TelegramDaemon) => Promise<TelegramDaemonStatus>): Promise<TelegramPairingView> {
    const pairing = this.telegramPairings.get(id)
    if (pairing === undefined || pairing.owner !== this.owner() || pairing.done) return { id, state: 'expired' }
    const status = await step(pairing.daemon).catch(() => undefined)
    if (status === undefined) return pairing.view
    pairing.view = telegramView(id, status)
    await this.advanceTelegramPairing(id)
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
  private async advancePairing(id: ConnectorId): Promise<void> {    const pairing = this.pairings.get(id)
    if (pairing === undefined || pairing.done || pairing.busy) return
    pairing.busy = true
    try {
      const status = await pairing.daemon.status()
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
  private superviseWhatsApp(id: ConnectorId, owner: string, daemon: WhatsAppDaemon, ready: Promise<void>, failures: number): SupervisedWhatsApp {
    const entry: SupervisedWhatsApp = { daemon, ready, alive: true, failures, startedAt: Date.now() }
    this.whatsapp.set(id, entry)
    void daemon.exited.then(() => {
      entry.alive = false
      if (daemon.stopped || this.whatsapp.get(id) !== entry) return
      const connector = this.domain.table('connectors').get(id)
      if (connector?.enabled !== true || connector.whatsapp?.linked !== true) { this.whatsapp.delete(id); return }
      entry.failures = Date.now() - entry.startedAt >= this.config.whatsappMaxRestartDelayMs ? 0 : entry.failures + 1
      const delay = Math.min(this.config.whatsappRestartDelayMs * 2 ** Math.max(0, entry.failures - 1), this.config.whatsappMaxRestartDelayMs)
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
    return new WhatsAppDaemon(this.whatsappBinary!, this.whatsappDirectory(owner, id), {
      startupTimeoutMs: this.config.whatsappStartupTimeoutMs, requestTimeoutMs: this.config.timeoutMs, stopGraceMs: this.config.whatsappStopGraceMs,
    })
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
  private superviseTelegram(id: ConnectorId, owner: string, daemon: TelegramDaemon, ready: Promise<void>, failures: number): SupervisedTelegram {
    const entry: SupervisedTelegram = { daemon, ready, alive: true, failures, startedAt: Date.now() }
    this.telegram.set(id, entry)
    void daemon.exited.then(() => {
      entry.alive = false
      if (daemon.stopped || this.telegram.get(id) !== entry) return
      const connector = this.domain.table('connectors').get(id)
      if (connector?.enabled !== true || connector.telegram?.linked !== true) { this.telegram.delete(id); return }
      entry.failures = Date.now() - entry.startedAt >= this.config.telegramMaxRestartDelayMs ? 0 : entry.failures + 1
      const delay = Math.min(this.config.telegramRestartDelayMs * 2 ** Math.max(0, entry.failures - 1), this.config.telegramMaxRestartDelayMs)
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
    const credentials = await this.telegramCredentials()
    if (credentials === undefined) throw new Error('Telegram application credentials are not configured')
    return new TelegramDaemon(this.telegramEntry!, this.telegramDirectory(owner, id), credentials, {
      startupTimeoutMs: this.config.telegramStartupTimeoutMs, requestTimeoutMs: this.config.timeoutMs, stopGraceMs: this.config.telegramStopGraceMs,
    })
  }

  /** Aeven-owned data directory of one account: the session string, its identity cache, and downloads. */
  private telegramDirectory(owner: string, id: ConnectorId): string {
    return avnHomePath('accounts', accountDirectory(owner), 'connectors', id)
  }

  /** The deployment's Telegram application credentials, resolved privately and never returned to a caller. */
  private async telegramCredentials(): Promise<TelegramCredentials | undefined> {
    const [id, hash] = await Promise.all([
      this.ctx.credentials.resolve(credentialRef(this.config.telegramApiIdRef)).catch(() => undefined),
      this.ctx.credentials.resolve(credentialRef(this.config.telegramApiHashRef)).catch(() => undefined),
    ])
    if (id === undefined || hash === undefined || id.value === '' || hash.value === '') return undefined
    return { apiId: id.value, apiHash: hash.value }
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
    // application credentials live in the credential provider rather than in the row.
    if (connector.provider === 'telegram') return connector.telegram?.linked === true && this.telegramEntry !== undefined
    const record = await this.ctx.credentials.readRecord(connectorCredential(connector.owner, connector.id))
    if (record === undefined) return false
    if (connector.provider === 'email') {
      return connector.authFailed !== true && record.kind === 'grant' && emailSecretSchema.safeParse(record.payload).success
    }
    if (record.kind === 'grant') {
      const grant = grantSchema.parse(record.payload)
      if (grant.expiresAt !== undefined && grant.expiresAt <= Date.now()
        && (grant.refreshToken === undefined || this.oauthApplication(connector.provider) === undefined)) return false
    }
    const google = googleService(connector.provider)
    return google === undefined || (connector.endpoint === google.endpoint && record.kind === 'grant'
      && grantSchema.parse(record.payload).scopes?.includes(google.scopes[0]) === true)
  }

  private async unmountConnector(id: ConnectorId): Promise<void> {
    for (const mount of this.mounts.values()) {
      const connection = mount.connections.get(id)
      if (connection === undefined) continue
      await connection.fiber.dispose()
      mount.connections.delete(id)
    }
  }

  private oauthApplication(provider: ConnectorProvider): OAuthProviderConfig | undefined {
    if (provider === 'mcp' || provider === 'email' || provider === 'whatsapp' || provider === 'telegram') return undefined
    const google = googleService(provider)
    if (google === undefined) return this.config.providers[provider as 'github' | 'microsoft365']
    const app = this.config.providers.google
    return app === undefined ? undefined : { ...app, endpoint: google.endpoint, scopes: [...google.scopes] }
  }

  private owner(): string {
    const user = this.ctx.identityUsers.actingUser()
    if (user === undefined) throw new Error('sign in to manage personal skills and connectors')
    return user.id
  }

  private async accessToken(owner: string, connector: z.infer<typeof connectorSchema>, signal?: AbortSignal): Promise<string> {
    const key = connectorCredential(owner, connector.id)
    const record = await this.ctx.credentials.readRecord(key)
    if (record === undefined) throw new Error('connector credential is missing; reconnect in Settings')
    if (record.kind === 'api-key') return record.key ?? ''
    const grant = grantSchema.parse(record.payload)
    if (grant.expiresAt === undefined || grant.expiresAt > Date.now()) return grant.accessToken
    const updated = await this.ctx.credentials.modifyRecord(key, async (current) => {
      if (current?.kind !== 'grant') throw new Error('connector was disconnected')
      const previous = grantSchema.parse(current.payload)
      if (previous.expiresAt === undefined || previous.expiresAt > Date.now()) return current
      const provider = this.oauthApplication(connector.provider)
      if (provider === undefined || previous.refreshToken === undefined) throw new Error('connector authorization expired; reconnect in Settings')
      const next = await exchangeGrant(this.ctx, provider, { grant_type: 'refresh_token', refresh_token: previous.refreshToken }, signal === undefined ? AbortSignal.timeout(this.config.timeoutMs) : AbortSignal.any([signal, AbortSignal.timeout(this.config.timeoutMs)]))
      return { kind: 'grant', payload: {
        ...next,
        ...next.scopes === undefined && previous.scopes !== undefined ? { scopes: previous.scopes } : {},
        ...next.refreshToken === undefined && previous.refreshToken !== undefined ? { refreshToken: previous.refreshToken } : {},
      } }
    })
    if (updated?.kind !== 'grant') throw new Error('connector authorization is unavailable')
    return grantSchema.parse(updated.payload).accessToken
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
    // Telegram rows get their endpoint and bearer token from their running daemon.
    const connectors = [...this.domain.table('connectors').entries()].flatMap(([id, connector]) => connector.owner === owner && connector.enabled
      && (connector.endpoint !== undefined || connector.provider === 'whatsapp' || connector.provider === 'telegram') && connector.provider !== 'email'
      && (googleService(connector.provider) === undefined || connector.endpoint === googleService(connector.provider)!.endpoint)
      ? [[id, connector] as const] : [])
    for (const [id, mount] of mounts) {
      if (!connectors.some(([active]) => active === id)) { await mount.fiber.dispose(); mounts.delete(id) }
    }
    for (const [id, saved] of connectors) {
      const daemon = saved.provider === 'whatsapp' ? await this.linkedWhatsApp(id, saved)
        : saved.provider === 'telegram' ? await this.linkedTelegram(id, saved) : undefined
      const connector = this.domain.table('connectors').get(id) ?? saved
      const daemonRequired = connector.provider === 'whatsapp' || connector.provider === 'telegram'
      if (!await this.isConnected(connector) || (daemonRequired && daemon === undefined)) {
        const linked = connector.provider === 'whatsapp' ? connector.whatsapp?.linked : connector.provider === 'telegram' ? connector.telegram?.linked : undefined
        if (linked !== true) this.connected.delete(id)
        await this.unmountConnector(id)
        this.invalidateSkills()
        continue
      }
      this.connected.add(id)
      const google = googleService(connector.provider)
      const token = daemon?.token ?? await this.accessToken(owner, connector)
      const url = daemon?.endpoint ?? connector.endpoint!
      const existing = mounts.get(id)
      if (existing?.token === token && existing.endpoint === url) continue
      if (existing !== undefined) { await existing.fiber.dispose(); mounts.delete(id) }
      const serverName = `account_${id.replaceAll('-', '').slice(0, 24)}`
      const fiber = owned.scope.ctx.plugin(mcp, google === undefined ? {
        transport: 'streamable-http', serverName,
        url, headers: token === '' ? {} : { Authorization: `Bearer ${token}` },
        toolCallTimeoutMs: this.config.timeoutMs, failOnStartupError: true, reconnect: { enabled: false },
      } : { ...await googleConnection(connector.provider, token,
        avnHomePath('accounts', accountDirectory(owner), 'connectors', id), this.config.timeoutMs), serverName })
      try {
        await fiber
      } catch (error) {
        // One account that cannot connect must not end the conversation's turn: the step runs without that
        // account's tools, and the next step tries to connect it again.
        await fiber.dispose()
        this.ctx.logger('account-integrations').warn(`connector ${id} could not connect: ${error instanceof Error ? error.message : String(error)}`)
        continue
      }
      mounts.set(id, { token, endpoint: url, fiber })
    }
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
