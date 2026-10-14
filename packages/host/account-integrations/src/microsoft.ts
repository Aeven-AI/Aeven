/** Account-scoped Graph MCP bridge with explicit per-provider tool and permission lists. */

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { StdioConfig } from '@aeven/mcp-client'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { ConnectorProvider } from './types.ts'

const microsoftConnectors = {
  'outlook': {
    'endpoint': 'https://graph.microsoft.com/v1.0/me/messages',
    'org': false,
    'check': 'list-mail-messages',
    'arguments': {
      'top': 1,
    },
    'scopes': [
      'Mail.ReadWrite',
      'Mail.Send',
      'User.Read',
    ],
    'read': [
      'get-current-user',
      'list-mail-messages',
      'get-mail-message',
      'get-mail-message-mime',
      'list-mail-folders',
      'list-mail-child-folders',
      'list-mail-folder-messages',
      'list-mail-attachments',
    ],
    'write': [
      'send-mail',
      'create-draft-email',
      'update-mail-message',
      'delete-mail-message',
      'move-mail-message',
      'copy-mail-message',
      'add-mail-attachment',
      'delete-mail-attachment',
      'create-mail-attachment-upload-session',
      'forward-mail-message',
      'reply-mail-message',
      'reply-all-mail-message',
      'create-forward-draft',
      'create-reply-draft',
      'create-reply-all-draft',
      'send-draft-message',
      'create-mail-folder',
      'create-mail-child-folder',
      'update-mail-folder',
      'delete-mail-folder',
    ],
  },
  'outlook-calendar': {
    'endpoint': 'https://graph.microsoft.com/v1.0/me/calendars',
    'org': false,
    'check': 'list-calendars',
    'arguments': {
      'top': 1,
    },
    'scopes': [
      'Calendars.ReadWrite',
      'User.Read',
    ],
    'read': [
      'get-current-user',
      'list-calendars',
      'list-calendar-events',
      'get-calendar-event',
      'list-specific-calendar-events',
      'get-specific-calendar-event',
      'get-calendar-view',
      'get-specific-calendar-view',
      'list-calendar-event-instances',
      'get-schedule',
    ],
    'write': [
      'create-calendar',
      'update-calendar',
      'delete-calendar',
      'create-calendar-event',
      'update-calendar-event',
      'delete-calendar-event',
      'create-specific-calendar-event',
      'update-specific-calendar-event',
      'delete-specific-calendar-event',
      'accept-calendar-event',
      'decline-calendar-event',
      'tentatively-accept-calendar-event',
      'cancel-calendar-event',
      'forward-calendar-event',
      'snooze-calendar-event-reminder',
      'dismiss-calendar-event-reminder',
    ],
  },
  'onedrive': {
    'endpoint': 'https://graph.microsoft.com/v1.0/me/drive',
    'org': false,
    'check': 'list-drives',
    'arguments': {},
    'scopes': [
      'Files.ReadWrite',
      'User.Read',
    ],
    'read': [
      'get-current-user',
      'list-drives',
      'get-drive-root-item',
      'list-folder-files',
      'get-drive-item',
      'search-onedrive-files',
      'list-drive-item-thumbnails',
      'list-drive-item-permissions',
      'list-drive-item-versions',
      'get-drive-delta',
    ],
    'write': [
      'upload-file-content',
      'create-upload-session',
      'delete-onedrive-file',
      'move-rename-onedrive-item',
      'create-onedrive-folder',
      'share-drive-item',
      'create-drive-item-share-link',
      'copy-drive-item',
      'delete-drive-item-permission',
      'create-drive-item-preview',
    ],
  },
  'sharepoint': {
    'endpoint': 'https://graph.microsoft.com/v1.0/sites',
    'org': true,
    'check': 'search-sharepoint-sites',
    'arguments': {
      'search': '*',
      'top': 1,
    },
    'scopes': [
      'Files.ReadWrite',
      'User.Read',
      'Sites.Read.All',
      'Sites.ReadWrite.All',
    ],
    'read': [
      'get-current-user',
      'search-sharepoint-sites',
      'get-sharepoint-site',
      'get-sharepoint-site-by-path',
      'list-sharepoint-site-drives',
      'get-sharepoint-site-drive-by-id',
      'list-sharepoint-site-items',
      'get-sharepoint-site-item',
      'list-sharepoint-site-lists',
      'get-sharepoint-site-list',
      'list-sharepoint-site-list-items',
      'get-sharepoint-site-list-item',
      'list-folder-files',
      'get-drive-item',
      'list-drive-item-versions',
      'list-drive-item-permissions',
    ],
    'write': [
      'create-sharepoint-list-item',
      'update-sharepoint-list-item',
      'delete-sharepoint-list-item',
      'upload-file-content',
      'create-upload-session',
      'create-onedrive-folder',
      'move-rename-onedrive-item',
      'copy-drive-item',
      'delete-onedrive-file',
      'share-drive-item',
      'create-drive-item-share-link',
      'delete-drive-item-permission',
    ],
  },
  'teams': {
    'endpoint': 'https://graph.microsoft.com/v1.0/me/chats',
    'org': true,
    'check': 'list-chats',
    'arguments': {
      'top': 1,
    },
    'scopes': [
      'User.Read',
      'ChatMember.Read',
      'ChatMessage.Read',
      'Chat.ReadWrite',
      'ChatMessage.Send',
      'Team.ReadBasic.All',
      'Channel.ReadBasic.All',
      'Channel.Create',
      'ChannelMessage.Read.All',
      'ChannelMessage.ReadWrite',
      'ChannelMessage.Send',
      'Chat.Create',
    ],
    'read': [
      'get-current-user',
      'list-chats',
      'get-chat',
      'list-chat-members',
      'list-chat-messages',
      'get-chat-message',
      'list-joined-teams',
      'get-team',
      'list-team-channels',
      'get-team-channel',
      'list-channel-messages',
      'get-channel-message',
      'list-channel-message-replies',
    ],
    'write': [
      'create-chat',
      'send-chat-message',
      'update-chat-message',
      'send-channel-message',
      'reply-to-channel-message',
      'update-channel-message',
      'update-channel-message-reply',
      'create-team-channel',
    ],
  },
} as const

/**
 * Resolve a Microsoft provider's Graph resource, delegated permissions, and allowed tools.
 * @param provider - account connector provider.
 * @returns Microsoft configuration, or undefined for another provider.
 */
export function microsoftService(provider: ConnectorProvider): typeof microsoftConnectors[keyof typeof microsoftConnectors] | undefined {
  switch (provider) {
    case 'outlook': return microsoftConnectors.outlook
    case 'outlook-calendar': return microsoftConnectors['outlook-calendar']
    case 'onedrive': return microsoftConnectors.onedrive
    case 'sharepoint': return microsoftConnectors.sharepoint
    case 'teams': return microsoftConnectors.teams
    default: return undefined // Other providers mount their own bridges.
  }
}

/**
 * Build a private Graph bridge process that receives only a broker-issued access token.
 * @param provider - selected Microsoft provider.
 * @param token - current delegated Graph token; refresh remains on the Aeven API.
 * @param directory - account-owned process and token-cache directory.
 * @param timeoutMs - MCP request budget.
 * @returns isolated stdio configuration with a tool allowlist that excludes local authentication.
 */
export async function microsoftConnection(provider: ConnectorProvider, token: string, directory: string, timeoutMs: number): Promise<Omit<StdioConfig, 'serverName'>> {
  const service = microsoftService(provider)
  if (service === undefined) throw new Error('not a Microsoft connector')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const allowedTools = [...service.read, ...service.write]
  return {
    transport: 'stdio', command: process.execPath,
    args: [fileURLToPath(import.meta.resolve('@softeria/ms-365-mcp-server')),
      ...service.org ? ['--org-mode'] : [], '--enabled-tools', `^(?:${allowedTools.join('|')})$`,
      '--allowed-scopes', service.scopes.join(' ')],
    cwd: directory,
    env: {
      MS365_MCP_OAUTH_TOKEN: token,
      MS365_MCP_OUTPUT_FORMAT: 'json',
      MS365_MCP_TOKEN_CACHE_PATH: join(directory, 'token-cache.json'),
      MS365_MCP_SELECTED_ACCOUNT_PATH: join(directory, 'selected-account.json'),
    },
    allowedTools, toolCallTimeoutMs: timeoutMs, failOnStartupError: true, reconnect: { enabled: false },
  }
}

/**
 * Verify account identity and one service read through the Graph bridge before saving a row.
 * @param provider - selected Microsoft provider.
 * @param config - private child configuration.
 * @param accountId - account Graph reported during broker consent.
 * @param timeoutMs - verification budget.
 * @returns readiness after both reads succeed; rejects access or identity failures.
 */
export async function verifyMicrosoft(provider: ConnectorProvider, config: Omit<StdioConfig, 'serverName'>, accountId: string, timeoutMs: number): Promise<void> {
  const service = microsoftService(provider)
  if (service === undefined) throw new Error('not a Microsoft connector')
  const client = new Client({ name: 'aeven-microsoft-connectors', version: '1.0.0' })
  try {
    await client.connect(new StdioClientTransport({ command: config.command, args: config.args, cwd: config.cwd, env: config.env, stderr: 'pipe' }), { timeout: timeoutMs })
    const listed = await client.listTools({}, { timeout: timeoutMs })
    if (!listed.tools.some(tool => tool.name === service.check)) throw new Error('Microsoft verification tool is unavailable')
    const identity = await client.callTool({ name: 'get-current-user', arguments: { select: ['id'] } }, undefined, { timeout: timeoutMs })
    const content = identity.content as { type: string; text?: string }[]
    const text = content.find(block => block.type === 'text')?.text
    if (identity.isError === true || text === undefined || (JSON.parse(text) as { id?: unknown }).id !== accountId) {
      throw new Error('Microsoft account identity verification failed')
    }
    const result = await client.callTool({ name: service.check, arguments: service.arguments }, undefined, { timeout: timeoutMs })
    if (result.isError === true) throw new Error('Microsoft account API access verification failed')
  } finally { await client.close() }
}
