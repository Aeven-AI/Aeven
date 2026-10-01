/** Per-session turn assembly from committed session events into {@link MemoryTurn} records. */
import type { MemoryOutcomeEvidence, MemoryScope, MemoryToolCall, MemoryTurn } from '@aeven/memory'
import type { ContentBlock, UserMessage } from '@aeven/llm'
import type {} from '@aeven/llm-retry'
import type {} from '@aeven/goal'
import type { Session, SessionEvent, SessionId } from '@aeven/session'
import type {} from '@aeven/tools'

interface ToolState {
  callId: string
  name: string
  input: unknown
  output?: string
  errorCode?: string
  startedAt?: number
  endedAt?: number
}

/** Mutable state of one open turn. */
export interface TurnState {
  readonly turn: number
  startedAt: number
  scope: MemoryScope
  /** Direct-user text of the turn; the pre-step decision is authoritative once `promptResolved`. */
  userText: string
  promptResolved: boolean
  recallAttempted: boolean
  /** Bounded turn-start recall reused before later requests, without another provider lookup. */
  recallReminder: string
  readonly userMessageIds: Set<string>
  readonly userTexts: string[]
  readonly assistantText: string[]
  readonly reasoningText: string[]
  readonly tools: ToolState[]
  readonly retryCodes: string[]
  completedGoal?: string
}

/**
 * Scope of a session read from its header and latest request header, without a live agent.
 * @param session - session whose owner, working directory, and persisted route apply.
 * @returns scope with the persisted route when one exists; undefined when the session has no owner.
 */
export function scopeOfSession(session: Session): MemoryScope | undefined {
  const owner = session.header.owner
  if (owner === undefined) return undefined
  const config = session.requestHeader()?.config
  return {
    owner,
    sessionId: session.id,
    ...session.header.cwd === undefined ? {} : { cwd: session.header.cwd },
    ...config === undefined ? {} : {
      route: { provider: config.provider, model: config.model, ...config.reasoningEffort === undefined ? {} : { reasoningEffort: config.reasoningEffort } },
    },
  }
}

/**
 * Join the text blocks of one kind.
 * @param content - message content.
 * @param type - `text` or `reasoning`.
 * @returns trimmed concatenation, empty when the content has none.
 */
export function textOf(content: readonly ContentBlock[], type: 'text' | 'reasoning'): string {
  return content.map(block => block.type === type ? block.text : '').filter(Boolean).join('\n\n').trim()
}

/**
 * Text of the direct-user messages in a batch; plugin, tool, and model messages are excluded.
 * @param messages - messages entering a step.
 * @returns joined user text, empty when the batch has none.
 */
export function userTextOf(messages: readonly UserMessage[]): string {
  return messages.filter(message => message.source.kind === 'user').map(message => textOf(message.content, 'text')).filter(Boolean).join('\n\n').trim()
}

function parseArguments(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    // The model produced non-JSON arguments; the raw string is the faithful record.
    return raw
  }
}

function pushUnique(target: string[], value: string): void {
  if (value && target[target.length - 1] !== value) target.push(value)
}

function correctionOf(text: string): string | undefined {
  const trimmed = text.trim()
  return /^(?:that's (?:wrong|incorrect)|that (?:was|is) (?:wrong|incorrect)|don't (?:use|do|repeat) (?:that|the (?:same|previous|old))|stop (?:using|doing) (?:that|the (?:same|previous|old))|不对|不要再|别再)/iu.test(trimmed)
    ? trimmed
    : undefined
}

function verificationOf(text: string, tools: readonly ToolState[]): MemoryOutcomeEvidence['verification'] {
  const successful = tools.filter(tool => tool.endedAt !== undefined && tool.errorCode === undefined)
  if (successful.length === 0) return undefined
  const sentence = text.split(/(?<=[.!?。！？])\s+/u).find(part => /\b(?:I|we)\s+(?:(?:(?:have|had)\s+)?(?:verified|tested|checked|confirmed)|did\s+(?:verify|test|check|confirm)|am\s+(?:verifying|testing|checking|confirming))\b|\bI['’]m\s+(?:verifying|testing|checking|confirming)\b|\b(?:tests?|checks?)\s+passed\b|(?:已验证|已测试|已检查|已确认)/iu.test(part))
  return sentence === undefined ? undefined : { statement: sentence.slice(0, 500), toolCallIds: successful.map(tool => tool.callId) }
}

/** Open turns of every live session, keyed by session and turn number. */
export class TurnTracker {
  private readonly turns = new Map<SessionId, Map<number, TurnState>>()
  private readonly active = new Map<SessionId, number>()

  /**
   * Read or open one turn's state.
   * @param session - owning session.
   * @param turn - turn number.
   * @param scope - memory scope of the session's owner.
   * @returns the turn state.
   */
  ensure(session: Session, turn: number, scope: MemoryScope): TurnState {
    let sessionTurns = this.turns.get(session.id)
    if (!sessionTurns) {
      sessionTurns = new Map()
      this.turns.set(session.id, sessionTurns)
    }
    let state = sessionTurns.get(turn)
    if (!state) {
      state = {
        turn,
        startedAt: Date.now(),
        scope,
        userText: '',
        promptResolved: false,
        recallAttempted: false,
        recallReminder: '',
        userMessageIds: new Set(),
        userTexts: [],
        assistantText: [],
        reasoningText: [],
        tools: [],
        retryCodes: [],
      }
      sessionTurns.set(turn, state)
    }
    return state
  }

  private get(sessionId: SessionId, turn: number | undefined): TurnState | undefined {
    return turn === undefined ? undefined : this.turns.get(sessionId)?.get(turn)
  }

  private delete(sessionId: SessionId, turn: number): void {
    const sessionTurns = this.turns.get(sessionId)
    sessionTurns?.delete(turn)
    if (sessionTurns?.size === 0) this.turns.delete(sessionId)
  }

  /**
   * Drop every open turn of a session.
   * @param sessionId - session that is no longer live.
   */
  forget(sessionId: SessionId): void {
    this.turns.delete(sessionId)
    this.active.delete(sessionId)
  }

  /**
   * Fold one committed event into its turn.
   * @param session - session that committed the event.
   * @param event - committed event.
   * @returns the completed turn when the event is its `turn/end` and the turn had direct-user text.
   */
  observe(session: Session, event: SessionEvent): MemoryTurn | undefined {
    // Memory is per signed-in user; a session without an owner is never captured.
    const scope = scopeOfSession(session)
    if (scope === undefined) return undefined
    switch (event.type) {
      case 'turn/start': {
        this.ensure(session, event.data.turn, scope).startedAt = event.time
        this.active.set(session.id, event.data.turn)
        return undefined
      }
      case 'user/message': {
        const state = this.get(session.id, this.active.get(session.id))
        if (!state || event.data.source.kind !== 'user' || state.userMessageIds.has(event.data.id)) return undefined
        const text = textOf(event.data.content, 'text')
        if (!text) return undefined
        state.userMessageIds.add(event.data.id)
        state.userTexts.push(text)
        if (!state.promptResolved) state.userText = state.userTexts.join('\n\n')
        return undefined
      }
      case 'assistant/message': {
        const state = this.get(session.id, event.data.turn)
        if (!state) return undefined
        pushUnique(state.assistantText, textOf(event.data.message.content, 'text'))
        pushUnique(state.reasoningText, textOf(event.data.message.content, 'reasoning'))
        return undefined
      }
      case 'tool/call': {
        const state = this.get(session.id, event.data.turn)
        if (!state || state.tools.some(tool => tool.callId === event.data.callId)) return undefined
        state.tools.push({ callId: event.data.callId, name: event.data.name, input: parseArguments(event.data.arguments), startedAt: event.time })
        return undefined
      }
      case 'tool/result': {
        const state = this.get(session.id, event.data.turn)
        if (!state) return undefined
        const callId = event.data.message.source.callId
        let tool = state.tools.find(candidate => candidate.callId === callId)
        if (!tool) {
          tool = { callId, name: 'unknown', input: undefined }
          state.tools.push(tool)
        }
        const [block] = event.data.message.content
        tool.output = textOf(block.content, 'text')
        // A surface replacement rewrites presentation of an existing result; it is not a second execution.
        if (typeof event.surfaceOp === 'object') return undefined
        const errorCode = event.data.error?.code ?? (block.isError === true ? 'TOOL_ERROR' : undefined)
        if (errorCode === undefined) delete tool.errorCode
        else tool.errorCode = errorCode
        tool.endedAt = event.time
        return undefined
      }
      case 'tool/code-dispatch-start': {
        const state = this.get(session.id, this.active.get(session.id))
        if (!state || state.tools.some(tool => tool.callId === event.data.subCallId)) return undefined
        state.tools.push({ callId: event.data.subCallId, name: event.data.name, input: event.data.arguments, startedAt: event.time })
        return undefined
      }
      case 'tool/code-dispatch': {
        const tool = this.get(session.id, this.active.get(session.id))?.tools.find(candidate => candidate.callId === event.data.subCallId)
        if (!tool) return undefined
        tool.output = textOf(event.data.content, 'text')
        if (event.data.isError) tool.errorCode = 'TOOL_ERROR'
        else delete tool.errorCode
        tool.endedAt = event.time
        return undefined
      }
      case 'llm/retry': {
        const state = this.get(session.id, event.data.turn)
        if (state) state.retryCodes.push(event.data.failure.code)
        return undefined
      }
      case 'goal/change': {
        if (event.data.operation !== 'complete') return undefined
        const state = this.get(session.id, this.active.get(session.id))
        if (state) state.completedGoal = event.data.goal.objective
        return undefined
      }
      case 'turn/end': {
        const state = this.get(session.id, event.data.turn)
        if (this.active.get(session.id) === event.data.turn) this.active.delete(session.id)
        if (!state) return undefined
        this.delete(session.id, event.data.turn)
        if (!state.userText) return undefined
        // The route persisted by the turn's own request is the one its capture should call.
        const turnScope = scope.route === undefined ? state.scope : { ...state.scope, route: scope.route }
        const reasoningText = state.reasoningText.join('\n\n').trim()
        const assistantText = state.assistantText.join('\n\n').trim()
        const correction = correctionOf(state.userText)
        const verification = verificationOf(assistantText, state.tools)
        const outcome: MemoryOutcomeEvidence = {
          retryCodes: state.retryCodes,
          ...correction === undefined ? {} : { correction },
          ...verification === undefined ? {} : { verification },
          ...state.completedGoal === undefined ? {} : { completedGoal: state.completedGoal },
        }
        return {
          scope: turnScope,
          turn: state.turn,
          userText: state.userText,
          assistantText,
          ...reasoningText ? { reasoningText } : {},
          toolCalls: state.tools.map((tool): MemoryToolCall => ({ ...tool })),
          startedAt: state.startedAt,
          endedAt: event.time,
          endReason: event.data.reason.kind,
          ...(outcome.retryCodes.length > 0 || correction !== undefined || verification !== undefined || state.completedGoal !== undefined ? { outcome } : {}),
        }
      }
      default:
        // Other events carry nothing a memory turn records.
        return undefined
    }
  }
}
