#!/usr/bin/env node
/**
 * Executable entry of the Discord connector server.
 *
 * One process serves one guild: the connector spawns this entry per connected
 * guild and passes that guild in the environment, so no tool accepts a guild id.
 * stdout carries the MCP stream and nothing else; every log line goes to stderr.
 */

import { existsSync, realpathSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { registerAdminTools } from './admin.ts'
import { GuildLookups, type DiscordContext } from './lookups.ts'
import { registerModerationTools } from './moderation.ts'
import { DiscordRest } from './rest.ts'
import { registerCuratedTools } from './tools.ts'

/** The process environment the connector populated. */
export type DiscordEnvironment = Readonly<Record<string, string | undefined>>

/** Validated configuration of one guild's server process. */
export interface DiscordConfig {
  /** `Authorization` header value every Discord request carries. */
  authorization: string
  /** The one guild this process serves. */
  guildId: string
  /** Name the connector passed for output headers, when it passed one. */
  guildName: string | undefined
  /** Whether the administration tool surface is registered. */
  adminTools: boolean
  /** Most messages one `search_messages` call scans in total. */
  maxScanMessages: number
  /** Largest file `send_file` may upload, in bytes. */
  maxFileBytes: number
  /** Network budget of one logical Discord call, in milliseconds. */
  requestTimeoutMs: number
  /** Discord REST base. */
  apiBase: string
}

/** Values used when the connector sets no override. */
const DEFAULTS = {
  maxScanMessages: 500,
  maxFileBytes: 10_485_760,
  requestTimeoutMs: 20_000,
  apiBase: 'https://discord.com/api/v10',
} as const

/** Largest accepted search budget: the fan-out has to finish inside one tool call. */
const SCAN_MESSAGES_MAX = 5_000
/** Largest accepted upload: Discord's own ceiling for a boosted server. */
const FILE_BYTES_MAX = 536_870_912
/** Largest accepted network budget for one call. */
const REQUEST_TIMEOUT_MS_MAX = 300_000

/** Identifies this server in the MCP handshake. */
const SERVER_INFO = { name: 'aeven-discord', version: '0.1.0' } as const

/**
 * Read an environment variable the process cannot start without.
 * @param env - the process environment.
 * @param name - the variable to read.
 * @returns the variable's value.
 * @throws when the variable is absent or empty.
 */
function readRequired(env: DiscordEnvironment, name: string): string {
  const raw = env[name]
  if (raw === undefined || raw === '') throw new Error(`${name} is required`)
  return raw
}

/**
 * Read an environment variable that has a default.
 * @param env - the process environment.
 * @param name - the variable to read.
 * @param fallback - the value used when the variable is absent or empty.
 * @returns the variable's value or the default.
 */
function readOptional(env: DiscordEnvironment, name: string, fallback: string): string {
  const raw = env[name]
  return raw === undefined || raw === '' ? fallback : raw
}

/**
 * Read a bounded positive integer from the environment.
 * @param env - the process environment.
 * @param name - the variable to read.
 * @param fallback - the value used when the variable is absent or empty.
 * @param max - the largest accepted value.
 * @returns the value.
 * @throws when the value is not an integer within `1..max`.
 */
function readCount(env: DiscordEnvironment, name: string, fallback: number, max: number): number {
  const raw = env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`${name} must be an integer from 1 to ${String(max)}`)
  }
  return value
}

/**
 * Read and validate the connector's environment.
 * @param env - the process environment the connector populated.
 * @returns the validated configuration.
 * @throws when a required value is absent or empty, or a bounded value is out of range.
 */
export function readDiscordConfig(env: DiscordEnvironment): DiscordConfig {
  return {
    authorization: readRequired(env, 'DISCORD_AUTHORIZATION'),
    guildId: readRequired(env, 'DISCORD_GUILD_ID'),
    guildName: env['DISCORD_GUILD_NAME'] === undefined || env['DISCORD_GUILD_NAME'] === ''
      ? undefined
      : env['DISCORD_GUILD_NAME'],
    adminTools: env['DISCORD_ADMIN_TOOLS'] === '1',
    maxScanMessages: readCount(env, 'DISCORD_MAX_SCAN_MESSAGES', DEFAULTS.maxScanMessages, SCAN_MESSAGES_MAX),
    maxFileBytes: readCount(env, 'DISCORD_MAX_FILE_BYTES', DEFAULTS.maxFileBytes, FILE_BYTES_MAX),
    requestTimeoutMs: readCount(env, 'DISCORD_REQUEST_TIMEOUT_MS', DEFAULTS.requestTimeoutMs, REQUEST_TIMEOUT_MS_MAX),
    apiBase: readOptional(env, 'DISCORD_API_BASE', DEFAULTS.apiBase),
  }
}

/**
 * Build the MCP server for one Discord guild.
 * @param env - the process environment the connector populated.
 * @returns the server carrying the curated surface, and the administration surface when enabled.
 * @throws when the environment is missing a required value or names an out-of-range one.
 */
export function createDiscordServer(env: DiscordEnvironment): McpServer {
  const config = readDiscordConfig(env)
  const rest = new DiscordRest({
    authorization: config.authorization,
    baseUrl: config.apiBase,
    timeoutMs: config.requestTimeoutMs,
  })
  const ctx: DiscordContext = {
    rest,
    guildId: config.guildId,
    lookups: new GuildLookups({ rest, guildId: config.guildId, nameHint: config.guildName }),
    maxScanMessages: config.maxScanMessages,
    maxFileBytes: config.maxFileBytes,
  }
  const server = new McpServer({ ...SERVER_INFO })
  registerCuratedTools(server, ctx)
  if (config.adminTools) {
    registerAdminTools(server, ctx)
    registerModerationTools(server, ctx)
  }
  return server
}

/**
 * Serve the configured guild over stdio until the connector closes stdin.
 * @returns a promise that settles once the transport is connected.
 */
async function main(): Promise<void> {
  console.log = (...args: unknown[]): void => { console.error(...args) }
  console.info = (...args: unknown[]): void => { console.error(...args) }
  console.debug = (): void => {}

  const server = createDiscordServer(process.env)
  await server.connect(new StdioServerTransport())

  let stopping = false
  const shutdown = (): void => {
    if (stopping) return
    stopping = true
    void server.close().then(() => { process.exit(0) })
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  // The connector holds stdin open for the server's lifetime; EOF means it exited.
  createInterface({ input: process.stdin }).on('close', shutdown)
}

const entry = process.argv[1]
if (entry !== undefined && existsSync(entry) && realpathSync(entry) === fileURLToPath(import.meta.url)) {
  await main()
}
