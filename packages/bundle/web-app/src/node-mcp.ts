/**
 * Runs an MCP server that ships as an npm dependency of this bundle under the Host's own Node.js executable, through
 * `@aeven/mcp-client` over stdio. The server's entry script is resolved from the installed bundle, so starting it
 * needs no network and no npm process stays resident beside it, which an `npx` launch costs for the server's whole
 * lifetime.
 * @module @aeven/web-app/node-mcp
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import * as McpClient from '@aeven/mcp-client'

/** Stable Cordis plugin name. */
export const name = 'node-mcp'

/** The `@aeven/mcp-client` stdio fields this plugin passes through; it supplies `transport` and `command` itself. */
export type ServerConfig = Partial<Omit<McpClient.StdioConfig, 'transport' | 'command' | 'serverName'>>
  & Pick<McpClient.StdioConfig, 'serverName'>

/** Which installed server to run and how `@aeven/mcp-client` connects to it. */
export interface Config {
  /** npm package that ships the server; it must be a dependency of `@aeven/web-app`. */
  package: string
  /** Key of the package's `bin` map that names the server's entry script. */
  bin: string
  /** `@aeven/mcp-client` stdio config without `transport` and `command`; `args` follow the entry script. */
  server: ServerConfig
}

export const Config: z<Config> = z.object({
  package: z.string().required(),
  bin: z.string().required(),
  // `@aeven/mcp-client`'s own schema validates these fields when apply builds the child config.
  server: z.any().required() as z<ServerConfig>,
})

/**
 * Resolve the entry script a package's `bin` map names.
 * @param pkg - package name, resolved from this bundle.
 * @param bin - key of the package's `bin` map.
 * @returns absolute path of the entry script.
 */
function entryScript(pkg: string, bin: string): string {
  const manifestPath = fileURLToPath(import.meta.resolve(`${pkg}/package.json`))
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { bin?: string | Record<string, string> }
  const target = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[bin]
  if (target === undefined) throw new Error(`node-mcp: ${pkg} declares no bin named ${bin}`)
  return join(dirname(manifestPath), target)
}

/**
 * Start `@aeven/mcp-client` on the resolved entry script under `process.execPath`.
 * @param ctx - plugin context.
 * @param config - package, bin, and the server's stdio config.
 */
export function apply(ctx: Context, config: Config): void {
  const { args = [], ...server } = config.server
  ctx.plugin(McpClient, McpClient.Config({
    ...server,
    transport: 'stdio',
    command: process.execPath,
    args: [entryScript(config.package, config.bin), ...args],
  }))
}
