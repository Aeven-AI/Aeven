/** Composer read-aloud toggle: one button that starts and stops reading this Session's replies. */
import { useEffect, useMemo, useRef } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import { IconLucideVolume2, IconLucideVolumeX, Spinner, Tooltip } from '@aeven/client-ui-primitives'
import type {} from '@aeven/client-ui-conversation/client'
import type { ReadAloudSnapshot } from './engine.ts'
import { toSpeechText } from './sentences.ts'
import { NS } from './locales.ts'
import { latestReadAloudRequest, readEnabled } from './voices.ts'
import css from './ReadAloud.module.css'

/** Read-aloud operations the toggle calls, without exposing a Cordis Context to React. */
export interface ReadAloudActions {
  /** @param shown - flattened text already on screen, which enabling skips past. */
  setEnabled: (sessionId: string, enabled: boolean, key: string, shown: string) => void
  sync: (sessionId: string, key: string, text: string) => void
  /** Speak what the step left unterminated. */
  finish: (sessionId: string) => void
}

/** Entry-injected read-aloud state and operations. */
export interface ReadAloudInjected extends ReadAloudActions {
  hooks: {
    readAloud: HostObservable<ReadAloudSnapshot>
  }
}

/** Composer seat, dictionaries, and the plugin's read-aloud face. */
export type ReadAloudProps = Pick<PropsRuntime<'conversation.input.left'>, 'sessionId' | 'useChat'>
  & PropsLocale<typeof NS> & InjectFace<ReadAloudInjected>

/**
 * Render the read-aloud toggle and feed the current step's text to the engine as it streams.
 * @param props - composer seat, chat snapshot selector, engine operations, and dictionaries.
 * @returns the toggle button.
 */
export function ReadAloudToggle({ sessionId, useChat, setEnabled, sync, finish, useReadAloud, t }: ReadAloudProps) {
  const state = useReadAloud(value => value)
  const partial = useChat(snapshot => snapshot.legacy.partial)
  const request = useChat(snapshot => latestReadAloudRequest(snapshot.legacy.nodes))
  const applied = useRef('')
  const text = useMemo(() => partial === null ? '' : toSpeechText(partial.blocks
    .flatMap(block => block.kind === 'text' ? [block.text] : [])
    .join('\n\n')), [partial])
  const key = partial === null ? '' : `${partial.turn}.${partial.step}`
  const enabled = state.enabled.includes(sessionId)
  const failed = state.failed.includes(sessionId)
  const loading = state.loading.includes(sessionId)

  // Reading is a standing choice, not a per-Session one: a Session opened while the reader keeps it on
  // starts reading too, once, without reopening a Session whose own tap already turned it off.
  const restored = useRef('')
  useEffect(() => {
    if (restored.current === sessionId) return
    if (enabled || !readEnabled()) return
    restored.current = sessionId
    setEnabled(sessionId, true, key, text)
  }, [enabled, key, sessionId, setEnabled, text])

  // An agent that asked to read — language practice, a hands-free conversation — moves the toggle
  // itself; the newest settled request is applied once, and a later tap overrides it.
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

  const label = failed ? t('failed') : loading ? t('loading') : enabled ? t('stop') : t('read')
  return <Tooltip label={label} side="top">
    <button type="button" className={css.button} aria-label={label} aria-pressed={enabled}
      aria-busy={loading ? true : undefined}
      data-failed={failed ? '' : undefined} onClick={() => { setEnabled(sessionId, !enabled, key, text) }}>
      <span className={css.icon}>{loading
        ? <Spinner className={css.spinner} />
        : enabled ? <IconLucideVolumeX /> : <IconLucideVolume2 />}</span>
    </button>
  </Tooltip>
}
