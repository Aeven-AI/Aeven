/** Recorded failure recovery through a real Loader, workspace registry, and agent loop. */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@aeven/agent'
import AgentLoop from '@aeven/agent-loop'
import LlmRuntime, { createUserMessage } from '@aeven/llm'
import * as LlmAeven from '@aeven/llm-aeven'
import * as Retry from '@aeven/llm-retry'
import SessionStore, { SessionId } from '@aeven/session'
import SessionPersistence from '@aeven/session-persistence-jsonl'
import SessionProjections from '@aeven/session-projection'
import Storage from '@aeven/storage'
import * as StorageJson from '@aeven/storage-json'
import * as StorageDomain from '@aeven/storage-domain'
import SystemPrompt from '@aeven/system-prompt'
import ToolRuntime from '@aeven/tools'
import * as DirectoryTool from '@aeven/tool-working-directory'
import WorkingDirectory, { sessionDirectory } from '@aeven/working-directory'
import WorkspaceRegistry from '@aeven/workspace'

let ctx: Context | undefined
let root: string | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function boot(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'avn-session-recovery-'))
  vi.stubEnv('AVN_HOME', root)
  vi.stubEnv('AEVEN_TOKEN', 'test-token')
  const plugins = new Map<string, unknown>([
    ['@aeven/session', SessionStore],
    ['@aeven/session-projection', SessionProjections],
    ['@aeven/session-persistence-jsonl', SessionPersistence],
    ['@aeven/storage', Storage],
    ['@aeven/storage-json', StorageJson],
    ['@aeven/storage-domain', StorageDomain],
    ['@aeven/workspace', WorkspaceRegistry],
    ['@aeven/llm', LlmRuntime],
    ['@aeven/llm-aeven', LlmAeven],
    ['@aeven/llm-retry', Retry],
    ['@aeven/system-prompt', SystemPrompt],
    ['@aeven/tools', ToolRuntime],
    ['@aeven/working-directory', WorkingDirectory],
    ['@aeven/tool-working-directory', DirectoryTool],
    ['@aeven/agent', AgentRegistry],
    ['@aeven/agent-loop', AgentLoop],
  ])
  const configs: Record<string, unknown> = {
    '@aeven/session-persistence-jsonl': { root: join(root, 'sessions'), compression: 'none' },
    '@aeven/storage-json': { root: join(root, 'storage') },
    '@aeven/storage-domain': { backend: 'json' },
    '@aeven/agent-loop': { agents: [] },
  }
  const yaml = [...plugins.keys()].map(name =>
    `- name: '${name}'\n  config: ${JSON.stringify(configs[name] ?? {})}`,
  ).join('\n') + '\n'
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, yaml)
  ctx = new Context()
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = {
    version: 'v2',
    async import(name: string) {
      if (!plugins.has(name)) throw new Error(`unexpected Loader import: ${name}`)
      return plugins.get(name)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  expect([...ctx.loader.entries()].filter(entry => !entry.disabled && entry.fiber === undefined)).toEqual([])
  return ctx
}

function response(delta: Record<string, unknown>, finishReason: string): Response {
  return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: finishReason }] })}\n\ndata: [DONE]\n\n`, {
    headers: { 'content-type': 'text/event-stream' },
  })
}

describe('session failure recovery', () => {
  it('continues a Chats turn after working_directory succeeds', async () => {
    const loaded = await boot()
    let requests = 0
    vi.stubGlobal('fetch', async () => ++requests === 1
      ? response({ tool_calls: [{ index: 0, id: 'directory-call', type: 'function', function: {
        name: 'working_directory', arguments: JSON.stringify({ path: root }),
      } }] }, 'tool_calls')
      : response({ content: 'Website folder ready.' }, 'stop'))
    const agent = loaded.agentLoop.create(SessionId('chat-directory'), { provider: LlmAeven.PROVIDER, model: 'Aeven-1.0-Flash' })
    const workspaceId = loaded.workspaceRegistry.defaultWorkspaceId
    if (workspaceId === undefined) throw new Error('Chats workspace missing')
    await loaded.workspaceRegistry.get(workspaceId)?.attachSession(agent.session.id)
    // The next model step must resolve the same directory file and sandbox consumers use.
    loaded.on('agent/pre-step', async (payload, next) => {
      if (payload.agent === agent && requests > 0) expect(sessionDirectory(loaded, agent.session)).toBe(root)
      return next()
    })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Build the startup website in a new folder.' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    expect(requests).toBe(2)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'turn/end').at(-1)?.data.reason).toEqual({ kind: 'completed' })
    expect(agent.session.deriveMessages().at(-1)?.content).toEqual([{ type: 'text', text: 'Website folder ready.' }])
  })

  // Use the provider's actual delay; advancing a fake clock would also alter Loader and persistence timers.
  it('retries a gateway HTTP failure after its Retry-After', { timeout: 10_000 }, async () => {
    const loaded = await boot()
    let requests = 0
    vi.stubGlobal('fetch', async () => ++requests === 1
      ? new Response('{"error":{"message":"temporary gateway failure"}}', { status: 520, headers: { 'retry-after': '1' } })
      : response({ content: 'Recovered reply.' }, 'stop'))
    const agent = loaded.agentLoop.create(SessionId('gateway-retry'), { provider: LlmAeven.PROVIDER, model: 'Aeven-1.0-Flash' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Continue after the gateway recovers.' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    expect(requests).toBe(2)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'llm/retry').map(event => event.data))
      .toMatchObject([{ delayMs: 1_000, failure: { status: 520, providerRetryAfterMs: 1_000 } }])
    expect(agent.session.snapshotEvents().filter(event => event.type === 'turn/end').at(-1)?.data.reason).toEqual({ kind: 'completed' })
    expect(agent.session.deriveMessages().at(-1)?.content).toEqual([{ type: 'text', text: 'Recovered reply.' }])
  })
})
