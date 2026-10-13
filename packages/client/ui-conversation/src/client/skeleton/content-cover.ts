/** Cover the conversation column until its Session view has painted. */

import { useEffect, useState } from 'react'
import type { OpenState } from '@aeven/api-session-controller/client'
import type { SessionId } from '@aeven/session/types'

/** Static page-preloader id from `apps/web/index.html`. */
export const PAGE_PRELOADER_ELEMENT_ID = 'avn-preloader'

/** Inputs that decide whether the conversation column stays covered. */
export interface ContentCoverInput {
  /** Selected Session, or undefined when the shell has no selection. */
  sessionId: SessionId | undefined
  /** True when the column is the proven-blank hero. */
  hero: boolean
  /** Selected Session open lifecycle, absent without a Session snapshot. */
  openState: OpenState | undefined
}

/** Overlay activity and which Session body is mounted. */
export interface ContentCover {
  /** True when the transcript overlay should cover ChatView. */
  loaderActive: boolean
  /** Session whose `conversation.session` slot is currently mounted. */
  mountedSessionId: SessionId | undefined
}

/**
 * Whether the static page preloader still occupies the screen.
 * @returns true while `#avn-preloader` is in the document and not `.screen-hidden`.
 */
export function isPagePreloaderVisible(): boolean {
  const el = document.getElementById(PAGE_PRELOADER_ELEMENT_ID)
  return el !== null && !el.classList.contains('screen-hidden')
}

/**
 * Follow `#avn-preloader` visibility, including the fade that precedes
 * `.screen-hidden`.
 * @returns true while the page preloader still occupies the screen.
 */
export function usePagePreloaderVisible(): boolean {
  const [visible, setVisible] = useState(isPagePreloaderVisible)
  useEffect(() => {
    const el = document.getElementById(PAGE_PRELOADER_ELEMENT_ID)
    if (el === null) {
      setVisible(false)
      return
    }
    const sync = (): void => {
      setVisible(!el.classList.contains('screen-hidden'))
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(el, { attributes: true, attributeFilter: ['class'] })
    return () => { observer.disconnect() }
  }, [])
  return visible
}

/**
 * Run `work` after two animation frames, or immediately when `requestAnimationFrame`
 * is missing. Two frames is the usual "the previous commit has been presented"
 * wait; one frame still races the overlay against ChatView's commit.
 * @param work - Callback to run after the wait.
 * @returns a disposer that cancels a pending wait.
 */
function afterPresented(work: () => void): () => void {
  if (typeof requestAnimationFrame !== 'function') {
    work()
    return () => {}
  }
  let second = 0
  const first = requestAnimationFrame(() => {
    second = requestAnimationFrame(work)
  })
  return () => {
    cancelAnimationFrame(first)
    if (second !== 0) cancelAnimationFrame(second)
  }
}

/**
 * Cover the transcript until the selected Session view has painted, without
 * stacking that overlay on the page preloader.
 *
 * ConversationRoot stays mounted across Session switches. A switch drops
 * `conversation.session` on the overlay frame (`conversation.session` reads
 * the current Session from the slot scope, so calling it remounts ChatView
 * immediately) and remounts that slot two animation frames later, once the
 * spinner has been presented. Painting completes two animation frames after
 * the body is mounted and `openState` is `open` or `error`.
 * @param input - Selected Session identity, hero posture, and open lifecycle.
 * @returns overlay activity and the Session id currently mounted in the body.
 */
export function useContentCover(input: ContentCoverInput): ContentCover {
  const { sessionId, hero, openState } = input
  const pagePreloaderVisible = usePagePreloaderVisible()
  const [mountedSessionId, setMountedSessionId] = useState<SessionId | undefined>(() => (
    hero || isPagePreloaderVisible() ? sessionId : undefined
  ))
  const [paintedFor, setPaintedFor] = useState<SessionId | undefined>(undefined)
  const awaitingPaint = sessionId !== undefined && !hero
    && (paintedFor !== sessionId || mountedSessionId !== sessionId)
  const loaderActive = awaitingPaint && !pagePreloaderVisible

  if (sessionId !== mountedSessionId) {
    if (loaderActive) {
      if (mountedSessionId !== undefined) setMountedSessionId(undefined)
    } else {
      setMountedSessionId(sessionId)
    }
  }

  useEffect(() => {
    if (mountedSessionId === sessionId) return
    if (!loaderActive) {
      setMountedSessionId(sessionId)
      return
    }
    return afterPresented(() => { setMountedSessionId(sessionId) })
  }, [loaderActive, mountedSessionId, sessionId])

  useEffect(() => {
    if (sessionId === undefined || hero) return
    if (mountedSessionId !== sessionId) return
    if (openState !== 'open' && openState !== 'error') return
    if (paintedFor === sessionId) return
    return afterPresented(() => { setPaintedFor(sessionId) })
  }, [sessionId, mountedSessionId, openState, hero, paintedFor])

  return { loaderActive, mountedSessionId }
}
