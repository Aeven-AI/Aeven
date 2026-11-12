/**
 * The share dialog's thumbnail: a scaled-down copy of the response exactly as
 * the conversation renders it. The copy is taken from the chat's
 * own DOM when the dialog opens, stripped of controls, and made inert, so it
 * shows what the reader will see without re-rendering the message.
 * @module @aeven/client-ui-message-share/client/ShareThumb
 */

import { useLayoutEffect, useRef } from 'react'
import { IconLucideShare2 } from '@aeven/client-ui-primitives'
import css from './ShareAction.module.css'

/** Elements a thumbnail never shows: controls and media that could play. */
const STRIPPED = 'button, input, textarea, select, video, audio, iframe, [role="toolbar"], [contenteditable]'

/** Levels above the turn tail searched for the turn's answer. */
const TURN_SEARCH_DEPTH = 8

/**
 * Copy the rendered response of the turn a share action belongs to.
 * @param trigger - the share button inside the turn's action row.
 * @returns a detached copy of the closing response row; empty when the row is
 *   not in the DOM.
 */
export function captureTurn(trigger: HTMLElement | null): readonly HTMLElement[] {
  const tail = trigger?.closest<HTMLElement>('[data-chat-flow-kind="turn-tail"]')
  const turn = tail?.dataset['chatTurn']
  if (tail === null || tail === undefined || turn === undefined) return []
  const selector = (kind: string) => `[data-chat-turn="${CSS.escape(turn)}"][data-chat-flow-kind="${kind}"]`
  let scope: HTMLElement | null = tail.parentElement
  for (let depth = 0; scope !== null && depth < TURN_SEARCH_DEPTH && scope.querySelector(selector('assistant-step')) === null; depth += 1) {
    scope = scope.parentElement
  }
  if (scope === null) return []
  const before = (element: Element) => (element.compareDocumentPosition(tail) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
  const answer = [...scope.querySelectorAll<HTMLElement>(selector('assistant-step'))]
    .filter(element => before(element) && element.dataset['turnProcessHidden'] === undefined)
    .at(-1)
  return [answer]
    .filter((element): element is HTMLElement => element !== undefined)
    .map((element) => {
      const copy = element.cloneNode(true) as HTMLElement
      for (const stripped of copy.querySelectorAll(STRIPPED)) stripped.remove()
      for (const identified of copy.querySelectorAll('[id]')) identified.removeAttribute('id')
      copy.removeAttribute('id')
      return copy
    })
}

/**
 * The thumbnail frame.
 * @param props.nodes - copies from {@link captureTurn}; empty shows the share glyph.
 * @param props.label - accessible name of the preview.
 * @returns the framed, scaled, inert preview.
 */
export function ShareThumb({ nodes, label }: { nodes: readonly HTMLElement[]; label: string }) {
  const canvasRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    canvas.setAttribute('inert', '')
    canvas.replaceChildren(...nodes.map(node => node.cloneNode(true)))
    return () => { canvas.replaceChildren() }
  }, [nodes])

  return (
    <div className={css.thumb} role="img" aria-label={label}>
      {nodes.length === 0
        ? <span className={css.thumbEmpty}><IconLucideShare2 /></span>
        : <div ref={canvasRef} className={css.thumbCanvas} aria-hidden="true" />}
    </div>
  )
}
