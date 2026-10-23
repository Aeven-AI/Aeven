/**
 * Shared mounting for the turn-review suites: the real agent loop, a scripted
 * mock model, and tool fixtures whose calls do or do not make a turn reviewable.
 * Only the model is scripted; the loop, session log, and turn boundaries are the
 * shipping implementations.
 */

import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { createUserMessage } from '@aeven/llm'
import type { GenerateOptions, StreamChunk } from '@aeven/llm'
import { SessionId, type SessionEvent } from '@aeven/session'
import { defineContentToolFixture } from '@aeven/tools'
import type { Agent } from '@aeven/agent'
import AgentLoop from '@aeven/agent-loop'
import { mountAgentLoopTestDependencies } from '@aeven/agent-loop-testkit'
import SessionProjectionRegistry from '@aeven/session-projection'
import * as TurnReview from '@aeven/turn-review'
import type { Config, TurnReviewRequestEventData } from '@aeven/turn-review'
import { MockAdapter, type HangAfter } from '../../../core/agent-loop/tests/mock-adapter.ts'

/** One entry of the scripted model: chunks, a chunk producer, or a hang until aborted. */
export type ScriptEntry =
  | StreamChunk[]
  | ((options: GenerateOptions) => StreamChunk[])
  | 'hang'
  | 'hang-slow'
  | HangAfter

/** Fields a suite may override on the plugin's own defaults. */
export interface ReviewConfigOverrides {
  triggerTools?: string[]
  maxReviewsPerTurn?: number
  maxEntryChars?: number
  maxTranscriptChars?: number
  maxOutputTokens?: number
  timeoutMs?: number
  provider?: string
  model?: string
}

/** One mounted turn-review plugin with its loop, agent, and scripted model. */
export interface ReviewHarness {
  readonly ctx: Context
  readonly agent: Agent
  readonly adapter: MockAdapter
  /** The plugin's own fiber, for disposal tests. */
  readonly fiber: Fiber
  /** Drive one user turn through the loop to quiescence. */
  turn(prompt?: string): Promise<void>
  /** The whole session log, in order. */
  events(): readonly SessionEvent[]
  /** Log events of one type. */
  ofType<T extends SessionEvent['type']>(type: T): Extract<SessionEvent, { type: T }>[]
  /** User messages the plugin itself injected, as text and source. */
  injected(): { text: string; source: unknown }[]
}

/** The plugin's defaults with the caller's fields overridden. */
export function reviewConfig(overrides: ReviewConfigOverrides = {}): Config {
  const defaults = TurnReview.Config()
  return {
    triggerTools: overrides.triggerTools ?? defaults.triggerTools,
    maxReviewsPerTurn: overrides.maxReviewsPerTurn ?? defaults.maxReviewsPerTurn,
    maxEntryChars: overrides.maxEntryChars ?? defaults.maxEntryChars,
    maxTranscriptChars: overrides.maxTranscriptChars ?? defaults.maxTranscriptChars,
    maxOutputTokens: overrides.maxOutputTokens ?? defaults.maxOutputTokens,
    timeoutMs: overrides.timeoutMs ?? defaults.timeoutMs,
    ...overrides.provider === undefined ? {} : { provider: overrides.provider },
    ...overrides.model === undefined ? {} : { model: overrides.model },
  }
}

/** The quoted turn transcript carried by one review request. */
export function transcriptOf(request: TurnReviewRequestEventData): unknown {
  const block = request.messages[0]?.content[0]
  if (block?.type !== 'text') throw new Error('turn-review request carries no text prompt')
  return JSON.parse(block.text.replace(/^Review this turn:\n/, ''))
}

/**
 * Mount the review plugin with the loop and the scripted responses it will consume.
 * @param script - model responses in call order, including the review calls.
 * @param config - plugin configuration; the package defaults when omitted.
 * @returns the harness; the caller owns the context and must dispose it.
 */
export async function mountReview(
  script: ScriptEntry[],
  config: Config = reviewConfig(),
): Promise<ReviewHarness> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['mock', 'review-provider'], adapter)
  const fiber = await ctx.plugin(TurnReview, config)

  ctx.tools.register(defineContentToolFixture({
    name: 'write',
    description: 'writes a file',
    parameters: {},
    execute: () => Promise.resolve([{ type: 'text' as const, text: 'wrote notes.md' }]),
  }))
  ctx.tools.register(defineContentToolFixture({
    name: 'edit',
    description: 'edits a file and ends the turn',
    parameters: {},
    execute: (_args, exec) => {
      exec.concludeTurn()
      return Promise.resolve([{ type: 'text' as const, text: 'edited notes.md' }])
    },
  }))
  ctx.tools.register(defineContentToolFixture({
    name: 'str_replace_editor',
    description: 'fails to find the requested text',
    parameters: {},
    execute: () => Promise.reject(new Error('the text to replace is absent')),
  }))
  ctx.tools.register(defineContentToolFixture({
    name: 'read',
    description: 'returns a non-text observation',
    parameters: {},
    execute: () => Promise.resolve([{ type: 'reasoning' as const, text: 'internal reading' }]),
  }))

  const agent = ctx.agentLoop.create(SessionId('turn-review'), { provider: 'mock', model: 'mock' })

  return {
    ctx,
    agent,
    adapter,
    fiber,
    turn: async (prompt = 'write the notes file') => {
      agent.followup(createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }))
      await agent.whenIdle()
    },
    events: () => agent.session.snapshotEvents(),
    ofType: type => agent.session.snapshotEvents()
      .filter((event): event is Extract<SessionEvent, { type: typeof type }> => event.type === type),
    injected: () => agent.session.snapshotEvents()
      .filter((event): event is Extract<SessionEvent, { type: 'user/message' }> => event.type === 'user/message')
      .filter(event => event.data.source.kind !== 'user')
      .map(event => ({
        text: event.data.content.map(block => block.type === 'text' ? block.text : `[${block.type}]`).join('|'),
        source: event.data.source,
      })),
  }
}
