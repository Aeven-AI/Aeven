/**
 * Slack connector settings the Host owns: the workspace endpoint, the OAuth surface one login
 * uses, and the user scopes it requests.
 *
 * The Slack app behind this connector is a public client — PKCE is what makes the exchange
 * possible without a client secret — so nothing here is a deployment secret and the login runs on
 * this Host. The readable and writable surface belongs to Slack's own MCP server, which scopes
 * every call to the user who consented.
 */

import { createHash } from 'node:crypto'
import type { ConnectorId } from './types.ts'

/** Slack's MCP server: JSON-RPC 2.0 over Streamable HTTP, authenticated with a user token. */
export const SLACK_MCP_ENDPOINT = 'https://mcp.slack.com/mcp'

/** Slack's user-token consent screen. */
export const SLACK_AUTHORIZE_URL = 'https://slack.com/oauth/v2_user/authorize'

/** Slack's user-token exchange. A PKCE client sends `code_verifier` and no `client_secret`. */
export const SLACK_TOKEN_URL = 'https://slack.com/api/oauth.v2.user.access'

/** Slack's own token test, which names the workspace and the account a user token belongs to. */
export const SLACK_AUTH_TEST_URL = 'https://slack.com/api/auth.test'

/** Revocation of one user token, called when the reader disconnects a workspace. */
export const SLACK_REVOKE_URL = 'https://slack.com/api/auth.revoke'

/**
 * Path half of the loopback redirect. Slack matches the registered redirect exactly, so the
 * deployment registers `http://127.0.0.1:<slackCallbackPort>/callback` on the application.
 */
export const SLACK_CALLBACK_PATH = '/callback'

/**
 * User scopes one login requests by default: searching public and private channels, files, and
 * people; reading channels and their messages and threads; reading profiles, channels, and their
 * members; posting, scheduling, reacting, uploading, and working with canvases and lists.
 *
 * Direct messages are deliberately absent — `search:read.im`, `search:read.mpim`, `im:history`,
 * and `mpim:history` are what `slackDirectMessages` adds — because searching a person's private
 * conversations is the sharpest thing this connector can do.
 */
export const SLACK_WORKSPACE_SCOPES = [
  'search:read.public', 'search:read.private', 'search:read.files', 'search:read.users',
  'channels:read', 'groups:read', 'im:read', 'mpim:read',
  'channels:history', 'groups:history',
  'users:read', 'files:read', 'emoji:read',
  'chat:write', 'reactions:read', 'reactions:write', 'files:write',
  'canvases:read', 'canvases:write', 'lists:read', 'lists:write',
  'channels:write', 'groups:write', 'im:write', 'mpim:write',
] as const

/** Scopes added when a deployment serves direct messages, each of which the app must also register. */
export const SLACK_DIRECT_MESSAGE_SCOPES = ['search:read.im', 'search:read.mpim', 'im:history', 'mpim:history'] as const

/** The workspace and account one user token belongs to, as Slack reports them. */
export interface SlackWorkspace {
  /** Team id; two connectors of one account may not carry the same one. */
  teamId: string
  /** Team name Slack reports. */
  teamName: string
  /** Workspace domain, taken from the workspace URL Slack reports. */
  domain?: string
  /** Slack user id of the account that consented. */
  userId: string
  /** That account's Slack username. */
  userName: string
}

/**
 * Loopback redirect one login binds, which the application must have registered.
 * @param port - configured callback port.
 * @returns the redirect URI Slack is given and matches.
 */
export function slackRedirectUri(port: number): string {
  return `http://127.0.0.1:${port}${SLACK_CALLBACK_PATH}`
}

/**
 * Connector id of one Slack workspace of one user, the same for every login to that workspace, so
 * the workspace's tool names (`mcp__slack_<id prefix>__…`) survive disconnecting and reconnecting.
 * @param owner - Aeven account that consented.
 * @param teamId - Slack team id.
 * @returns a UUID-formatted id derived from both.
 */
export function slackConnectorId(owner: string, teamId: string): ConnectorId {
  const hex = createHash('sha256').update(`slack\0${owner}\0${teamId}`).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${hex.slice(18, 20)}-${hex.slice(20, 32)}` as ConnectorId
}

/** Opening verbs whose tool only reads. */
const SLACK_READ_VERBS = new Set(['search', 'read', 'list', 'get', 'fetch', 'download', 'lookup', 'find', 'resolve'])

/**
 * Words that make a name a write, wherever they appear after the opening verb. Slack reports an
 * upload in two calls and the first of them is a `get` that creates an upload target, so the
 * opening verb alone does not decide.
 */
const SLACK_WRITE_WORDS = new Set([
  'send', 'post', 'reply', 'schedule', 'draft', 'upload', 'create', 'update', 'edit', 'delete', 'remove',
  'archive', 'add', 'invite', 'join', 'leave', 'set', 'rename', 'share', 'complete', 'start', 'end', 'open', 'close',
])

/**
 * Whether one mounted Slack tool only reads.
 *
 * Slack's server owns these names and can add to them, so this classifies by the name's own verbs
 * and answers false for anything it does not recognize: an unknown tool asks the reader, which
 * costs one prompt, where the other default would post to a workspace unreviewed.
 * @param tool - tool name inside the connector's namespace, with or without Slack's `slack_` prefix.
 * @returns true when the name says the call only reads.
 */
export function isSlackReadTool(tool: string): boolean {
  const name = tool.startsWith('slack_') ? tool.slice('slack_'.length) : tool
  const [verb, ...rest] = name.split('_').filter(part => part !== '')
  if (verb === undefined || !SLACK_READ_VERBS.has(verb)) return false
  return !rest.some(word => SLACK_WRITE_WORDS.has(word))
}
