/** Shared sidebar PTYs exercised through the real Loader and tool pipeline. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry, { Inbox, type Agent } from '@aeven/agent'
import { ToolCallId } from '@aeven/llm'
import { Session, SessionId } from '@aeven/session'
import SystemPrompt from '@aeven/system-prompt'
import ToolRuntime from '@aeven/tools'
import SandboxPolicyService, { setSandboxMode } from '@aeven/sandbox-policy'
import SessionProjectionRegistry from '@aeven/session-projection'
import LocalSubprocessRuntime from '@aeven/subprocess-local'
import TypertRegistry from '@aeven/typert-registry'
import ApprovalService from '@aeven/user-approval'
import TerminalController from '../src/index.ts'
import type { TerminalAttachmentId, TerminalFrame, WebTerminalId } from '../src/types.ts'

let root: string
let ctx: Context
let owner: Agent
let call = 0
const streams: AbortController[] = []

function agent(id: string): Agent {
  const scope = ctx.plugin(() => {})
  const session = Session.create(SessionId(id))
  const value: Agent = {
    id: session.id, options: {}, session, ctx: scope.ctx, status: 'idle',
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    send: () => {}, followup: () => {}, steer: () => {}, inject: () => {}, cancel: () => {},
    runMaintenance: job => job(new AbortController().signal), whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(value)
  return value
}

async function run(args: Record<string, unknown>, caller = owner) {
  const result = await ctx.tools.execute({
    name: 'sidebar_terminal', callId: ToolCallId(`sidebar-${++call}`), arguments: args,
    agent: caller, signal: new AbortController().signal,
  })
  return { result, text: result.content.filter(block => block.type === 'text').map(block => block.text).join('') }
}

const suite = process.platform === 'darwin' || process.platform === 'linux' ? describe : describe.skip
suite('sidebar terminal model control', () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'aeven-sidebar-terminal-'))
    ctx = new Context()
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@aeven/agent', AgentRegistry], ['@aeven/system-prompt', SystemPrompt], ['@aeven/tools', ToolRuntime],
      ['@aeven/session-projection', SessionProjectionRegistry], ['@aeven/sandbox-policy', SandboxPolicyService],
      ['@aeven/subprocess-local', LocalSubprocessRuntime], ['@aeven/typert-registry', TypertRegistry],
      ['@aeven/user-approval', ApprovalService], ['@aeven/api-terminal-controller', TerminalController],
    ])
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`Unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      ...[...modules.keys()].filter(name => name !== '@aeven/sandbox-policy' && name !== '@aeven/api-terminal-controller')
        .map(name => `- name: '${name}'`),
      "- name: '@aeven/sandbox-policy'", '  config:', '    mode: danger-full-access', `    workspaceRoot: ${JSON.stringify(root)}`,
      "- name: '@aeven/api-terminal-controller'", '  config:', '    shell:', '      path: /bin/sh', '      name: sh', '      args: [-i]',
      '',
    ].join('\n'))
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()
    owner = agent('sidebar-owner')
    await ctx.terminalController.create(owner, { id: 'main' as WebTerminalId, cols: 80, rows: 24 }, new AbortController().signal)
  })

  afterEach(async () => {
    for (const stream of streams.splice(0)) stream.abort()
    await ctx?.fiber.dispose()
    if (root !== undefined) await rm(root, { recursive: true, force: true })
  })

  it('shares shell state and output while the browser keeps input ownership', async () => {
    const lifetime = new AbortController()
    streams.push(lifetime)
    const frames: TerminalFrame[] = []
    const watching = (async () => {
      try {
        for await (const frame of ctx.terminalController.follow(owner, 'main' as WebTerminalId, 'browser' as TerminalAttachmentId, lifetime.signal)) frames.push(frame)
      } catch (error) { if (!lifetime.signal.aborted) throw error }
    })()
    await expect.poll(() => frames.length).toBeGreaterThan(0)
    await ctx.terminalController.write(owner, 'main' as WebTerminalId, 'browser' as TerminalAttachmentId, 'export SHARED=sidebar\r')
    const sent = await run({ action: 'send', terminalId: 'main', text: 'printf "AGENT_%s\\n" "$SHARED"' })
    expect(sent.result.isError).toBeFalsy()
    expect(JSON.parse(sent.text)).toMatchObject({ accepted: true, info: { controllerId: 'browser' } })
    await expect.poll(async () => (await run({ action: 'read', terminalId: 'main' })).text).toContain('AGENT_sidebar')
    expect(frames.some(frame => frame.type === 'output' && frame.data.includes('AGENT_sidebar'))).toBe(true)
    await ctx.terminalController.write(owner, 'main' as WebTerminalId, 'browser' as TerminalAttachmentId, 'printf "USER_STILL_WRITABLE\\n"\r')
    await expect.poll(async () => (await run({ action: 'read', terminalId: 'main' })).text).toContain('USER_STILL_WRITABLE')
    await run({ action: 'send', terminalId: 'main', text: "printf 'WAITING_FOR_INTERRUPT\\n'; sleep 30" })
    const readLines = async (): Promise<string[]> => {
      const read = await run({ action: 'read', terminalId: 'main' })
      return (JSON.parse(read.text) as { text: string }).text.split('\n')
    }
    await expect.poll(readLines).toContain('WAITING_FOR_INTERRUPT')
    await run({ action: 'send', terminalId: 'main', text: '\u0003', submit: false })
    await run({ action: 'send', terminalId: 'main', text: "printf 'AFTER_INTERRUPT\\n'" })
    await expect.poll(readLines).toContain('AFTER_INTERRUPT')
    await run({ action: 'rename', terminalId: 'main', title: 'Shared shell' })
    expect(JSON.parse((await run({ action: 'list' })).text)).toMatchObject([{ id: 'main', title: 'Shared shell' }])
    await run({ action: 'resize', terminalId: 'main', cols: 100, rows: 30 })
    expect(ctx.terminalController.list(owner.id)[0]).toMatchObject({ cols: 100, rows: 30, controllerId: 'browser' })
    lifetime.abort()
    await watching
    await run({ action: 'close', terminalId: 'main' })
    expect(JSON.parse((await run({ action: 'list' })).text)).toEqual([])
  })

  it('refuses other sessions and invalid inputs before touching the shell', async () => {
    const other = agent('other-owner')
    expect(JSON.parse((await run({ action: 'list' }, other)).text)).toEqual([])
    expect((await run({ action: 'send', terminalId: 'main', text: 'echo forbidden' }, other)).result.isError).toBe(true)
    for (const args of [
      { action: 'send', terminalId: 'main' }, { action: 'read', terminalId: 'main', count: 0 },
      { action: 'resize', terminalId: 'main', cols: 1, rows: 24 }, { action: 'rename', terminalId: 'main', title: '' },
      { action: 'send', terminalId: 'main', text: 'x'.repeat(65537) },
    ]) expect((await run(args)).result.isError).toBe(true)
  })

  it('requires terminal-and-operation approval in restricted sessions', async () => {
    setSandboxMode(owner.session, 'workspace-write')
    owner.session.append('turn/start', { turn: 1 })
    expect((await run({ action: 'send', terminalId: 'main', text: 'echo denied' })).result.isError).toBe(true)
    let asks = 0
    ctx.on('approval/request', async () => { asks++; return 'allowed-session' })
    expect((await run({ action: 'send', terminalId: 'main', text: 'echo approved' })).result.isError).toBeFalsy()
    expect((await run({ action: 'send', terminalId: 'main', text: 'echo approved_again' })).result.isError).toBeFalsy()
    expect(asks).toBe(1)
    await run({ action: 'read', terminalId: 'main' })
    expect(asks).toBe(2)
    owner.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  })
})
