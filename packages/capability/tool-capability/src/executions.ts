/** Per-session tracking of capability use, assembled from committed session events into execution records. */
import type { CapabilityExecution, CapabilityReport } from '@aeven/capability'
import type { Session, SessionEvent } from '@aeven/session'
import type {} from '@aeven/llm-retry'
import type {} from '@aeven/skill'
import type {} from '@aeven/tools'

/** One capability used in one turn, ready to record. */
export interface UsedCapability {
  readonly name: string
  readonly execution: Omit<CapabilityExecution, 'kind' | 'id' | 'revision' | 'environment'>
}

interface TurnUse {
  readonly turn: number
  readonly startedAt: number
  /** Tool names of the turn's calls, by call id. */
  readonly calls: Map<string, string>
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

/** Capability use of every live session this agent runs. */
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
   * @returns the capabilities the turn used, when the event ends a turn that loaded any.
   */
  observe(session: Session, event: SessionEvent): UsedCapability[] | undefined {
    const use = this.turns.get(session.id)
    switch (event.type) {
      case 'turn/start':
        this.turns.set(session.id, {
          turn: event.data.turn,
          startedAt: event.time,
          calls: new Map(),
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
        return undefined
      case 'tool/call': {
        if (!use) return undefined
        use.calls.set(event.data.callId, event.data.name)
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
        if (use && event.data.usage) {
          use.input += event.data.usage.inputTokens
          use.output += event.data.usage.outputTokens
        }
        return undefined
      case 'turn/end': {
        if (!use || use.turn !== event.data.turn) return undefined
        this.turns.delete(session.id)
        if (use.loaded.size === 0) return undefined
        const config = session.requestHeader()?.config
        return [...use.loaded].map(([name, tools]): UsedCapability => {
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
              ...use.input + use.output > 0 ? { tokens: { input: use.input, output: use.output } } : {},
              ...report === undefined ? {} : { report },
            },
          }
        })
      }
      default:
        // Other events carry no capability evidence.
        return undefined
    }
  }
}
