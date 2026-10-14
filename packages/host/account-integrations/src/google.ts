/** Account-scoped Workspace MCP bridge; delegated scopes follow OpenAI plugins at 5fd93af4cd0c623e020d0cc7e9ce178b4ac1f70f. */

import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { StdioConfig } from '@aeven/mcp-client'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { ConnectorProvider } from './types.ts'

const googleConnectors = {
  'gmail': {
    'endpoint': 'https://gmail.googleapis.com/gmail/v1/',
    'services': 'gmail',
    'check': 'gmail_list_labels',
    'arguments': {},
    'scopes': [
      'https://mail.google.com/',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.compose',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.metadata',
    ],
  },
  'google-drive': {
    'endpoint': 'https://www.googleapis.com/drive/v3/',
    'services': 'drive,docs,sheets,slides,forms',
    'check': 'drive_search',
    'arguments': { 'q': 'trashed = false', 'max': 1 },
    'scopes': [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/drive.file',
    ],
  },
  'google-calendar': {
    'endpoint': 'https://www.googleapis.com/calendar/v3/',
    'services': 'calendar',
    'check': 'calendar_list_calendars',
    'arguments': {},
    'scopes': [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.acls',
      'https://www.googleapis.com/auth/calendar.calendarlist',
      'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
      'https://www.googleapis.com/auth/calendar.calendars',
      'https://www.googleapis.com/auth/calendar.calendars.readonly',
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar.events.freebusy',
      'https://www.googleapis.com/auth/calendar.events.readonly',
      'https://www.googleapis.com/auth/calendar.freebusy',
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/calendar.settings.readonly',
    ],
  },
} as const

/**
 * Resolve a Google connector's resource, delegated scopes and Workspace services.
 * @param provider - account connector provider.
 * @returns the Google service configuration, or undefined for another provider.
 */
export function googleService(provider: ConnectorProvider): typeof googleConnectors[keyof typeof googleConnectors] | undefined {
  switch (provider) {
    case 'gmail': return googleConnectors.gmail
    case 'google-drive': return googleConnectors['google-drive']
    case 'google-calendar': return googleConnectors['google-calendar']
    default: return undefined // Other providers use deployment-configured MCP resources.
  }
}

/**
 * Build a private, account-bound Workspace MCP process configuration.
 * @param provider - connected Google provider.
 * @param token - refreshed account access token, supplied only to the child environment.
 * @param directory - account-owned working and discovery-cache directory.
 * @param timeoutMs - MCP request timeout.
 * @returns isolated MCP configuration for the provider's allowed services.
 */
export async function googleConnection(provider: ConnectorProvider, token: string, directory: string, timeoutMs: number): Promise<Omit<StdioConfig, 'serverName'>> {
  const service = googleService(provider)
  if (service === undefined) throw new Error('not a Google connector')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const cliRoot = dirname(fileURLToPath(import.meta.resolve('@googleworkspace/cli/package.json')))
  return {
    transport: 'stdio', command: process.execPath,
    args: [fileURLToPath(import.meta.resolve('@thenavidm/google-workspace-mcp-cli'))],
    cwd: directory,
    env: {
      GWS_BIN: join(cliRoot, 'bin', process.platform === 'win32' ? 'gws.exe' : 'gws'),
      GWS_SERVICES: service.services,
      GOOGLE_WORKSPACE_CLI_TOKEN: token,
      GOOGLE_WORKSPACE_CLI_CONFIG_DIR: directory,
    },
    toolCallTimeoutMs: timeoutMs, failOnStartupError: true, reconnect: { enabled: false },
  }
}

/**
 * Verify native Google access through the maintained Workspace MCP bridge before saving consent.
 * @param provider - selected Google connector.
 * @param config - private child-process configuration.
 * @param timeoutMs - verification request budget.
 */
export async function verifyGoogle(provider: ConnectorProvider, config: Omit<StdioConfig, 'serverName'>, timeoutMs: number): Promise<void> {
  const service = googleService(provider)
  if (service === undefined) throw new Error('not a Google connector')
  const client = new Client({ name: 'aeven-google-connectors', version: '1.0.0' })
  try {
    await client.connect(new StdioClientTransport({ command: config.command, args: config.args, cwd: config.cwd, env: config.env, stderr: 'pipe' }), { timeout: timeoutMs })
    await client.listTools({}, { timeout: timeoutMs })
    const result = await client.callTool({ name: service.check, arguments: service.arguments }, undefined, { timeout: timeoutMs })
    if (result.isError === true) throw new Error('Google account API access verification failed')
  } finally { await client.close() }
}
