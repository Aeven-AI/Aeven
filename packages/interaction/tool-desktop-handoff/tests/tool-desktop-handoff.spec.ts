import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@aeven/llm'
import AgentRegistry, { type Agent } from '@aeven/agent'
import SystemPrompt from '@aeven/system-prompt'
import ToolRuntime from '@aeven/tools'
import * as toolDesktopHandoff from '@aeven/tool-desktop-handoff'
import type { DesktopHandoffOfferEvent, DesktopHandoffResult } from '@aeven/tool-desktop-handoff'

const testToolSignal = new AbortController().signal

async function setup(answerTimeoutMs = 10_000) {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(toolDesktopHandoff, { answerTimeoutMs })
  return ctx
}

function stubAgent(id: string): Agent {
  const agentId = id as Agent['id']
  return { id: agentId, session: { id: agentId, header: { delegationDepth: 0 } } } as unknown as Agent
}

async function offer(ctx: Context, reason: unknown) {
  const agent = stubAgent('root')
  ctx.agents.enter(agent, undefined)
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: ToolCallId('offer-1'),
    name: 'offer_desktop',
    arguments: { reason },
    agent,
  })
}

describe('offer_desktop tool', () => {
  it('registers a schema whose required reason lists what the request needs', async () => {
    const ctx = await setup()
    const schema = ctx.tools.schemas().find(tool => tool.name === 'offer_desktop')

    expect(schema).toMatchObject({
      name: 'offer_desktop',
      parameters: {
        type: 'object',
        properties: { reason: { type: 'string', enum: ['computer', 'files', 'terminal', 'device', 'models'] } },
        required: ['reason'],
      },
    })
  })

  it('tells the model the dialog opened when the window showing the session answers', async () => {
    const ctx = await setup()
    const seen: DesktopHandoffOfferEvent[] = []
    ctx.on('desktop-handoff/offer', (request) => {
      seen.push(request)
      return Promise.resolve<DesktopHandoffResult>('shown')
    })

    const result = await offer(ctx, 'computer')

    expect(result).toMatchObject({
      isError: false,
      content: [{ type: 'text', text: expect.stringContaining('A dialog in the user\'s window now offers to continue this conversation in Aeven Desktop') }],
    })
    expect(seen.map(request => request.reason)).toEqual(['computer'])
  })

  it('reports no window when every listener delegates', async () => {
    const ctx = await setup()
    ctx.on('desktop-handoff/offer', (_request, next) => next())

    const result = await offer(ctx, 'files')

    expect(result).toMatchObject({
      isError: false,
      content: [{ type: 'text', text: expect.stringContaining('No window is showing this conversation') }],
    })
  })

  it('reports no window when no window answers within answerTimeoutMs', async () => {
    const ctx = await setup(20)
    ctx.on('desktop-handoff/offer', () => new Promise<DesktopHandoffResult>(() => {}))

    const result = await offer(ctx, 'terminal')

    expect(result).toMatchObject({
      isError: false,
      content: [{ type: 'text', text: expect.stringContaining('No window is showing this conversation') }],
    })
  })
})
