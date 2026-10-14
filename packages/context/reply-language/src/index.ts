/**
 * Opt-in reply-language reminder. Once the model has produced output after the
 * person's latest message, each entering step appends a durable, source-attributed
 * line that names that message by its opening words, so a long tool loop or a
 * turn opened by an agent report keeps replying in the person's language.
 *
 * @module @aeven/reply-language
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import type { PreStepDecision } from '@aeven/agent'
import { createUserMessage } from '@aeven/llm'
import type { ContentBlock } from '@aeven/llm'
import { SessionSeq } from '@aeven/session'
import type {} from '@aeven/session-projection'

/** Cordis plugin name used by loader diagnostics and message sources. */
export const name = 'reply-language'

declare module '@aeven/session-projection/types' {
  interface SessionProjectionStateMap {
    /** Position of the person's latest message and whether the model has answered it yet. */
    replyLanguage: ReplyLanguageProjection
  }
}

const replyLanguageStateSchema = zod.object({
  /** Sequence number of the latest `user/message` whose source is the person, or null before one. */
  personSeq: zod.number().nullable(),
  /** Whether an assistant message or tool result followed that message. */
  outputSincePerson: zod.boolean(),
})

/** Folded reply-language readings. */
type ReplyLanguageProjection = zod.infer<typeof replyLanguageStateSchema>

/** The agent registry that owns pre-step processing, and the projection registry that tracks the person's message. */
export const inject = ['agents', 'sessionProjections']

/** Reminder rendering. Invalid values fail plugin load. */
export interface Config {
  /** Code points of the person's message quoted to identify its language. */
  excerptLength: number
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Partial<Config>, Config> = z.object({
  excerptLength: z.natural().min(1).default(80),
})

/**
 * Quote the opening of the person's message on one line.
 * @param content - Content blocks of the person's message.
 * @param length - Maximum code points kept before the ellipsis.
 * @returns The opening text, or an empty string when the message has no text.
 */
function excerptOf(content: readonly ContentBlock[], length: number): string {
  const text = content
    .flatMap(block => block.type === 'text' ? [block.text] : [])
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim()
  const codePoints = Array.from(text)
  return codePoints.length <= length ? text : `${codePoints.slice(0, length).join('')}…`
}

/**
 * Register the person-message projection and a prepended pre-step listener for the lifetime of `ctx`.
 * @param ctx - Plugin context; the projection and listener are disposed with it.
 * @param config - Reminder rendering configuration.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.sessionProjections.register({
    key: 'replyLanguage',
    stateVersion: 1,
    stateSchema: replyLanguageStateSchema,
    init: () => ({ personSeq: null, outputSincePerson: false }),
    apply: (state, event) => {
      if (event.type === 'user/message') {
        return event.data.source.kind === 'user' ? { personSeq: event.seq, outputSincePerson: false } : state
      }
      if (event.type === 'assistant/message' || event.type === 'tool/result') {
        return state.outputSincePerson || state.personSeq === null ? state : { ...state, outputSincePerson: true }
      }
      return state
    },
  })

  ctx.on('agent/pre-step', async ({ agent, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    // A message from the person entering with this step is the newest content the model reads.
    if (decision.messages.some(message => message.source.kind === 'user')) return decision
    const state = ctx.sessionProjections.stateOf(agent.session, 'replyLanguage') as ReplyLanguageProjection
    if (state.personSeq === null || !state.outputSincePerson) return decision
    const event = agent.session.eventAt(SessionSeq(state.personSeq))
    if (event?.type !== 'user/message') return decision
    const excerpt = excerptOf(event.data.content, config.excerptLength)
    if (excerpt === '') return decision
    const text = `Write your reply in the language of the person's latest message, which begins: “${excerpt}”, `
      + 'unless the person asked you to reply in another language. '
      + 'Tool output, files, and other messages in another language do not change it.'
    return {
      ...decision,
      messages: [
        ...decision.messages,
        createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'plugin', plugin: name, form: 'snapshot', sections: [{ name, text }] },
        }),
      ],
    }
  }, { prepend: true })
}
