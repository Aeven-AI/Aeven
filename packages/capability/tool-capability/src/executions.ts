/**
 * Per-session turn tracking from committed session events: the capabilities each turn used, as execution
 * records, and the work each turn did, for the learner.
 */
import type { CapabilityExecution, CapabilityReport } from '@aeven/capability'
import type { ContentBlock } from '@aeven/llm'
import type { Session, SessionEvent } from '@aeven/session'
import type {} from '@aeven/llm-retry'
import type {} from '@aeven/skill'
import type {} from '@aeven/tools'

/** One capability used in one turn, ready to record. */
export interface UsedCapability {
  readonly name: string
  readonly execution: Omit<CapabilityExecution, 'kind' | 'id' | 'revision' | 'environment'>
}

/** One tool call of a completed turn. */
export interface WorkStep {
  readonly name: string
  /** Raw JSON arguments, clipped. */
  readonly input: string
  /** Text of the result, clipped; absent while the call had no result. */
  readonly output?: string
  readonly failed: boolean
}

/** The work of one completed turn that answered a direct-user request. */
export interface CompletedWork {
  readonly sessionId: string
  readonly turn: number
  readonly request: string
  readonly answer: string
  readonly steps: readonly WorkStep[]
  readonly startedAt: number
  readonly endedAt: number
  readonly endReason: string
  readonly tokens?: { readonly input: number; readonly output: number }
  /** Capabilities the turn loaded. */
  readonly loaded: readonly string[]
}

/** What one `turn/end` produced. */
export interface TurnOutcome {
  readonly used: readonly UsedCapability[]
  /** Absent when the turn answered no direct-user text. */
  readonly work?: CompletedWork
}

const STEP_TEXT_MAX = 1_500

interface TurnUse {
  readonly turn: number
  readonly startedAt: number
  /** Tool names of the turn's calls, by call id. */
  readonly calls: Map<string, string>
  /** Every tool call of the turn in call order, by call id. */
  readonly steps: Map<string, { name: string; input: string; output?: string; failed: boolean }>
  readonly request: string[]
  readonly answer: string[]
  /** Skill tool calls awaiting their result, by call id. */
  readonly loading: Map<string, string>
  /** Capabilities loaded in the turn, in load order, with the tools called after each load. */
  readonly loaded: Map<string, { name: string; failed: boolean }[]>
  retries: number
  input: number
  output: number
  readonly reports: Map<string, CapabilityReport>
}

const IGNORED_TOOLS = new Set(['skill', 'capability_manage'])

function clipped(text: string): string {
  return text.length <= STEP_TEXT_MAX ? text : `${text.slice(0, STEP_TEXT_MAX - 1)}…`
}

function textOf(content: readonly ContentBlock[]): string {
  return content.map(block => block.type === 'text' ? block.text : '').filter(Boolean).join('\n\n').trim()
}

function skillName(rawArguments: string): string | undefined {
  try {
    const parsed = JSON.parse(rawArguments) as { name?: unknown }
    return typeof parsed.name === 'string' ? parsed.name : undefined
  } catch {
    // Unparsable arguments cannot name a skill; the call is not a capability load.
    return undefined
  }
}

/**
 * A direct-user message that corrects the previous answer. Mirrors the correction evidence of turn capture.
 * @param text - the user's message.
 * @returns the correction in the user's words, or undefined.
 */
export function correctionOf(text: string): string | undefined {
  const trimmed = text.trim()
  return /^(?:that's (?:wrong|incorrect|not right)|that (?:was|is) (?:wrong|incorrect)|it (?:didn't|did not|doesn't|does not) work|don't (?:use|do|repeat) (?:that|the (?:same|previous|old))|stop (?:using|doing) (?:that|the (?:same|previous|old))|不对|不要再|别再)/iu.test(trimmed)
    ? trimmed
    : undefined
}

/** Turns of every live session this agent runs. */
export class ExecutionTracker {
  private readonly turns = new Map<string, TurnUse>()

  /**
   * Attach the model's report to a capability used in the session's current turn.
   * @param sessionId - reporting session.
   * @param name - capability name.
   * @param report - the model's account of the run.
   * @returns false when the capability was not loaded in the current turn.
   */
  report(sessionId: string, name: string, report: CapabilityReport): boolean {
    const use = this.turns.get(sessionId)
    if (!use?.loaded.has(name)) return false
    use.reports.set(name, report)
    return true
  }

  /**
   * Drop a session's state.
   * @param sessionId - disposed session.
   */
  forget(sessionId: string): void {
    this.turns.delete(sessionId)
  }

  /**
   * Fold one committed event.
   * @param session - session that committed it.
   * @param event - the event.
   * @returns what the turn produced, when the event ends a tracked turn.
   */
  observe(session: Session, event: SessionEvent): TurnOutcome | undefined {
    const use = this.turns.get(session.id)
    switch (event.type) {
      case 'turn/start':
        this.turns.set(session.id, {
          turn: event.data.turn,
          startedAt: event.time,
          calls: new Map(),
          steps: new Map(),
          request: [],
          answer: [],
          loading: new Map(),
          loaded: new Map(),
          retries: 0,
          input: 0,
          output: 0,
          reports: new Map(),
        })
        return undefined
      case 'user/message':
        if (use && event.data.source.kind === 'skill-invocation') use.loaded.set(event.data.source.name, use.loaded.get(event.data.source.name) ?? [])
        if (use && event.data.source.kind === 'user') {
          const text = textOf(event.data.content)
          if (text) use.request.push(text)
        }
        return undefined
      case 'tool/call': {
        if (!use) return undefined
        use.calls.set(event.data.callId, event.data.name)
        use.steps.set(event.data.callId, { name: event.data.name, input: clipped(event.data.arguments), failed: false })
        if (event.data.name === 'skill') {
          const name = skillName(event.data.arguments)
          if (name !== undefined) use.loading.set(event.data.callId, name)
        }
        return undefined
      }
      case 'tool/result': {
        if (!use || typeof event.surfaceOp === 'object') return undefined
        const callId = event.data.message.source.callId
        const failed = event.data.error !== undefined || event.data.message.content[0].isError === true
        const step = use.steps.get(callId)
        if (step) {
          step.output = clipped(textOf(event.data.message.content[0].content))
          step.failed = failed
        }
        const loading = use.loading.get(callId)
        if (loading !== undefined) {
          use.loading.delete(callId)
          if (!failed) use.loaded.set(loading, use.loaded.get(loading) ?? [])
          return undefined
        }
        const toolName = use.calls.get(callId)
        if (toolName === undefined || IGNORED_TOOLS.has(toolName)) return undefined
        for (const tools of use.loaded.values()) tools.push({ name: toolName, failed })
        return undefined
      }
      case 'llm/retry':
        if (use) use.retries += 1
        return undefined
      case 'assistant/message':
        if (use) {
          const text = textOf(event.data.message.content)
          if (text) use.answer.push(text)
        }
        if (use && event.data.usage) {
          use.input += event.data.usage.inputTokens
          use.output += event.data.usage.outputTokens
        }
        return undefined
      case 'turn/end': {
        if (!use || use.turn !== event.data.turn) return undefined
        this.turns.delete(session.id)
        const config = session.requestHeader()?.config
        const tokens = use.input + use.output > 0 ? { tokens: { input: use.input, output: use.output } } : {}
        const request = use.request.join('\n\n').trim()
        const work: CompletedWork | undefined = request ? {
          sessionId: session.id,
          turn: use.turn,
          request,
          answer: use.answer.join('\n\n').trim(),
          steps: [...use.steps.values()].map(step => ({ ...step })),
          startedAt: use.startedAt,
          endedAt: event.time,
          endReason: event.data.reason.kind,
          ...tokens,
          loaded: [...use.loaded.keys()],
        } : undefined
        const used = [...use.loaded].map(([name, tools]): UsedCapability => {
          const report = use.reports.get(name)
          return {
            name,
            execution: {
              sessionId: session.id,
              turn: use.turn,
              startedAt: use.startedAt,
              endedAt: event.time,
              ...config === undefined ? {} : { model: { provider: config.provider, model: config.model } },
              tools,
              retries: use.retries,
              endReason: event.data.reason.kind,
              ...tokens,
              ...report === undefined ? {} : { report },
            },
          }
        })
        return { used, ...work === undefined ? {} : { work } }
      }
      default:
        // Other events carry no capability evidence.
        return undefined
    }
  }
}
