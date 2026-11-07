/**
 * Agent-switched reply reading: follows the newest settled `read_aloud` call in this Session and feeds
 * the live step's text to the engine while reading is on. Renders nothing; the composer carries no
 * read-aloud control.
 */
import { useEffect, useMemo, useRef } from 'react'
import type { HostObservable, InjectFace, PropsRuntime } from '@aeven/client-ui-slots'
import type {} from '@aeven/client-ui-conversation/client'
import type { ReadAloudSnapshot } from './engine.ts'
import { toSpeechText } from './sentences.ts'
import { latestReadAloudRequest } from './voices.ts'

/** Session reading operations the follower calls, without exposing a Cordis Context to React. */
export interface AgentReadAloudInjected {
  hooks: {
    readAloud: HostObservable<ReadAloudSnapshot>
  }
  /**
   * Switch this Session's reply reading on or off.
   * @param sessionId - Session whose replies are read.
   * @param enabled - whether replies are read aloud.
   * @param key - live step identity the shown text belongs to.
   * @param shown - flattened text already on screen, which enabling skips past.
   */
  setEnabled: (sessionId: string, enabled: boolean, key: string, shown: string) => void
  /**
   * Feed the growing flattened text of the live step.
   * @param sessionId - Session being read.
   * @param key - live step identity.
   * @param text - complete flattened text shown for that step.
   */
  sync: (sessionId: string, key: string, text: string) => void
  /**
   * Speak what the step left unterminated.
   * @param sessionId - Session being read.
   */
  finish: (sessionId: string) => void
}

/** Composer seat and the plugin's session reading face. */
export type AgentReadAloudProps = Pick<PropsRuntime<'conversation.input.left'>, 'sessionId' | 'useChat'>
  & InjectFace<AgentReadAloudInjected>

/**
 * Apply the newest settled `read_aloud` request once and stream the live step to the engine while on.
 * @param props - composer seat, chat snapshot selector, and engine operations.
 * @returns nothing.
 */
export function AgentReadAloud({ sessionId, useChat, setEnabled, sync, finish, useReadAloud }: AgentReadAloudProps) {
  const enabled = useReadAloud(value => value.enabled.includes(sessionId))
  const partial = useChat(snapshot => snapshot.legacy.partial)
  const request = useChat(snapshot => latestReadAloudRequest(snapshot.legacy.nodes))
  const applied = useRef('')
  const text = useMemo(() => partial === null ? '' : toSpeechText(partial.blocks
    .flatMap(block => block.kind === 'text' ? [block.text] : [])
    .join('\n\n')), [partial])
  const key = partial === null ? '' : `${partial.turn}.${partial.step}`

  useEffect(() => {
    if (request === '' || applied.current === request) return
    applied.current = request
    setEnabled(sessionId, request.endsWith(':on'), key, text)
  }, [key, request, sessionId, setEnabled, text])

  useEffect(() => {
    if (!enabled) return
    if (partial === null) {
      finish(sessionId)
      return
    }
    sync(sessionId, key, text)
  }, [enabled, finish, key, partial, sessionId, sync, text])

  return null
}
