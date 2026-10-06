/**
 * Turn judgment: the summarize request of a captured turn's final reply also files the turn and detects a
 * correction, and capture uses that answer instead of a separate classification call.
 */
import { describe, expect, it } from 'vitest'
import type { HostLlmCompleteInput } from '@memtensor/memos-local-plugin/dist/core/llm/host-bridge.js'
import { SUPERSEDED_TAG, TurnJudgeContext } from '../src/domain.ts'
import { LlmRouteContext } from '../src/host-llm.ts'
import { MemosMemory } from '../src/runtime.ts'
import { SCOPE } from './harness.ts'

const SUMMARY_RULES = 'You condense a single agent/user exchange into ONE short memory line.'

function summarizeRequest(content: string, op = 'capture.summarize'): HostLlmCompleteInput {
  return { op, messages: [{ role: 'system', content: SUMMARY_RULES }, { role: 'user', content }] }
}

const FINAL_REPLY = 'USER:\nno, I go by Ollie not my son\n\nASSISTANT:\nCorrected: your son goes by Alan.'

describe('TurnJudgeContext.extend', () => {
  const judges = new TurnJudgeContext()
  const input = { project: undefined, previousReply: 'Your son is Alan. He goes by Ollie.' }

  it('leaves a request outside a turn capture unchanged', () => {
    expect(judges.extend(summarizeRequest(FINAL_REPLY))).toBeUndefined()
  })

  it('leaves requests other than a summary unchanged', async () => {
    await judges.run(input, async () => {
      expect(judges.extend(summarizeRequest(FINAL_REPLY, 'capture.reflect'))).toBeUndefined()
    })
  })

  it('leaves the summary of a tool step without assistant text unchanged, because its trace is not the one the turn is filed under', async () => {
    await judges.run(input, async () => {
      expect(judges.extend(summarizeRequest('USER:\nfix it\n\nTOOLS:\nbash(ls)'))).toBeUndefined()
    })
  })

  it('extends a whole-turn summary that lists the turn\'s tool calls after its reply', async () => {
    await judges.run(input, async () => {
      expect(judges.extend(summarizeRequest(`${FINAL_REPLY}\n\nTOOLS:\nmemory_search({"query":"son"})`))).toBeDefined()
    })
  })

  it('gives the final reply its context after the MemOS instructions', async () => {
    await judges.run(input, async () => {
      const judged = judges.extend(summarizeRequest(FINAL_REPLY))
      const [system, user, rules] = judged?.input.messages ?? []
      expect(system).toEqual({ role: 'system', content: SUMMARY_RULES })
      expect(user?.content).toBe(`PROJECT: none\n\nPREVIOUS ASSISTANT:\nYour son is Alan. He goes by Ollie.\n\n${FINAL_REPLY}`)
      expect(rules?.role).toBe('system')
      expect(rules?.content).toContain('"corrects"')
    })
  })

  it('returns the judgment the answer states', async () => {
    const { result, judgment } = await judges.run(input, async () => {
      judges.extend(summarizeRequest(FINAL_REPLY))?.read('{"summary":"User goes by Ollie; son Alan has no nickname","domain":"person","corrects":true}')
      return 'captured'
    })
    expect(result).toBe('captured')
    expect(judgment).toEqual({ domain: 'person', corrects: true })
  })

  it('files a project answer without a project as experience', async () => {
    const { judgment } = await judges.run(input, async () => {
      judges.extend(summarizeRequest(FINAL_REPLY))?.read('{"summary":"s","domain":"project","corrects":false}')
    })
    expect(judgment).toEqual({ domain: 'experience', corrects: false })
  })

  it('returns no judgment when the answer names no domain, so the classification call runs', async () => {
    const { judgment } = await judges.run(input, async () => {
      judges.extend(summarizeRequest(FINAL_REPLY))?.read('{"summary":"s"}')
    })
    expect(judgment).toBeUndefined()
  })
})

describe('capture with a turn judgment', () => {
  /** A MemOS core whose turn-end capture answers its final-reply summarize request with `answers[turn]`. */
  function captureCore(judges: TurnJudgeContext, answers: Record<number, string>) {
    const tags = new Map<string, string[]>()
    const judgedRequests: string[] = []
    let remembered = 0
    const core = {
      prepareTurn: async () => ({ sessionId: 'memos-session', episodeId: 'episode-1' }),
      onTurnEnd: async (request: { contextHints: { turn: number } }) => {
        const turn = request.contextHints.turn
        const judged = judges.extend(summarizeRequest(`USER:\nmessage ${turn}\n\nASSISTANT:\nreply ${turn}`))
        if (judged) judgedRequests.push(judged.input.messages[1]?.content ?? '')
        judged?.read(answers[turn] ?? '{"summary":"s"}')
        // `remember` captures as turn 0; each write gets its own trace.
        const traceId = turn === 0 ? `tr_remembered_${++remembered}` : `tr_${turn}`
        tags.set(traceId, [])
        return { traceId, episodeId: 'episode-1' }
      },
      getTrace: async (id: string) => ({ id, summary: 's', tags: tags.get(id) ?? [] }),
      updateTrace: async (id: string, patch: { tags?: string[] }) => {
        if (patch.tags) tags.set(id, patch.tags)
      },
      closeSession: async () => {},
    }
    return { core, tags, judgedRequests }
  }

  function turn(index: number) {
    return { scope: SCOPE, turn: index, userText: `message ${index}`, assistantText: `reply ${index}`, toolCalls: [], startedAt: index, endedAt: index, endReason: 'completed' } as never
  }

  it('files the turn from the judgment, without the classification call', async () => {
    const judges = new TurnJudgeContext()
    const { core, tags } = captureCore(judges, { 1: '{"summary":"User\'s son: Alan","domain":"person","corrects":false}' })
    const classified: string[] = []
    const memory = new MemosMemory({
      core: core as never,
      routes: new LlmRouteContext(),
      toolLimits: { skills: 8, traces: 8, worldModels: 8 },
      judges,
      classify: async (input) => {
        classified.push(input.userText)
        return 'experience'
      },
      warn: () => {},
      info: () => {},
    })
    memory.capture(turn(1))
    await memory.closeSession('session-1' as never)
    expect(tags.get('tr_1')).toEqual(['domain:person'])
    expect(classified).toEqual([])
  })

  it('supersedes the previous reply when the judgment reports a correction no phrase matched', async () => {
    const judges = new TurnJudgeContext()
    const { core, tags } = captureCore(judges, {
      1: '{"summary":"Son Alan goes by Ollie","domain":"work","corrects":false}',
      2: '{"summary":"User goes by Ollie; son Alan has no nickname","domain":"person","corrects":true}',
    })
    const memory = new MemosMemory({
      core: core as never,
      routes: new LlmRouteContext(),
      toolLimits: { skills: 8, traces: 8, worldModels: 8 },
      judges,
      warn: () => {},
      info: () => {},
    })
    memory.capture(turn(1))
    memory.capture(turn(2))
    await memory.closeSession('session-1' as never)
    expect(tags.get('tr_1')).toEqual(['domain:experience', `${SUPERSEDED_TAG}tr_2`])
    // A judged correction states its referent, so automatic recall keeps it.
    expect(tags.get('tr_2')).toEqual(['domain:person'])
  })

  it('supersedes the facts the corrected turn remembered, and keeps that turn\'s reply for the next judgment', async () => {
    const judges = new TurnJudgeContext()
    const { core, tags, judgedRequests } = captureCore(judges, {
      2: '{"summary":"User\'s dog: Bram; Pixel is their sister\'s dog","domain":"person","corrects":true}',
    })
    const memory = new MemosMemory({
      core: core as never,
      routes: new LlmRouteContext(),
      toolLimits: { skills: 8, traces: 8, worldModels: 8 },
      judges,
      warn: () => {},
      info: () => {},
    })
    // The model saves a fact with the memory tool during turn 1; that turn's capture follows it on the queue.
    await memory.remember({ scope: SCOPE, text: 'my dog is called Pixel', signal: new AbortController().signal } as never)
    memory.capture(turn(1))
    // During turn 2 the model saves the corrected fact, which stays current.
    await memory.remember({ scope: SCOPE, text: 'my dog is called Bram', signal: new AbortController().signal } as never)
    memory.capture(turn(2))
    await memory.closeSession('session-1' as never)
    expect(tags.get('tr_remembered_1')).toEqual(['domain:person', `${SUPERSEDED_TAG}tr_2`])
    expect(tags.get('tr_remembered_2')).toEqual(['domain:person'])
    expect(tags.get('tr_1')).toEqual([`${SUPERSEDED_TAG}tr_2`])
    expect(judgedRequests.at(-1)).toContain('PREVIOUS ASSISTANT:\nreply 1')
  })
})
