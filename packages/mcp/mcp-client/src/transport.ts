/**
 * Transport factory: creates the appropriate MCP transport based on the
 * plugin's resolved config. Stdio spawns a child process (with credential
 * scrubbing); Streamable HTTP connects to a URL.
 *
 * @module
 */

import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { Readable } from 'node:stream'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { scrubbedParentEnv } from '@aeven/subprocess'
import type { Config } from './index.ts'

/**
 * The subprocess seam's scrubbed parent env (credential-shaped and stale
 * `AVN_*` names dropped), plus the spec's explicit env. The MCP SDK owns the
 * actual spawn, so this transport shares the scrub definition rather than the
 * spawn path.
 */
function buildChildEnv(extra: Record<string, string>): Record<string, string> {
  return { ...scrubbedParentEnv(), ...extra }
}

/**
 * Create an MCP transport from the resolved plugin config.
 *
 * @param config - Resolved plugin config discriminated on `transport`.
 * @param onDiagnostic - Optional receiver for complete non-empty stdio diagnostic lines.
 * @returns A connected-ready MCP Transport (stdio or Streamable HTTP).
 */
export function createTransport(config: Config, onDiagnostic?: (line: string) => void): Transport {
  switch (config.transport) {
    case 'stdio': {
      // Piped, not inherited: a server that greets on stderr — or the `npx`
      // that warns before it execs one — otherwise writes those lines straight
      // over the Host's own startup output, which the Host did not author and
      // cannot format. `onDiagnostic` keeps them, under the server's label.
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: buildChildEnv(config.env),
        cwd: config.cwd,
        stderr: 'pipe',
      })
      if (onDiagnostic !== undefined) forwardDiagnostics(transport, onDiagnostic)
      return transport
    }
    case 'streamable-http':
      // The MCP SDK's StreamableHTTPClientTransport has optional callback
      // properties typed without `| undefined` (exactOptionalPropertyTypes
      // mismatch with the Transport interface); the SDK constructed the
      // object, so the cast records only that widening.
      return new StreamableHTTPClientTransport(
        new URL(config.url),
        { requestInit: { headers: config.headers } },
      ) as Transport
  }
}

/**
 * Forward a stdio server's stderr to `onDiagnostic`, one complete line at a
 * time, including a last line the server wrote without a trailing newline.
 * @param transport - stdio transport constructed with `stderr: 'pipe'`.
 * @param onDiagnostic - receives each non-empty line.
 */
function forwardDiagnostics(transport: StdioClientTransport, onDiagnostic: (line: string) => void): void {
  // The SDK declares the base `Stream`; under `stderr: 'pipe'` it constructs a
  // PassThrough, so the readable face the cast records is the object's own.
  const stderr = transport.stderr as Readable | null
  /* v8 ignore next -- `stderr: 'pipe'` above makes the SDK expose the stream immediately. */
  if (stderr === null) return
  let pending = ''
  const emit = (line: string): void => {
    if (line.trim() !== '') onDiagnostic(line)
  }
  stderr.setEncoding('utf8')
  stderr.on('data', (chunk: string) => {
    const text = pending + chunk
    const lastBreak = text.lastIndexOf('\n')
    if (lastBreak === -1) {
      pending = text
      return
    }
    pending = text.slice(lastBreak + 1)
    for (const line of text.slice(0, lastBreak).split('\n')) emit(line)
  })
  stderr.on('end', () => {
    const last = pending
    pending = ''
    emit(last)
  })
}
