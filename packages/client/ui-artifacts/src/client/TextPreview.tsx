/**
 * A text or Markdown artifact drawn in its card: the file's opening set as ink on paper, Markdown headings larger.
 * Only the first few kilobytes are fetched, once the card nears the page, so a long document costs no more than a
 * short one; nothing is drawn on the Host.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Artifact } from '@aeven/host-artifacts/types'
import css from './ArtifactsPage.module.css'

/** Distance from the viewport at which a card starts loading its text. */
const LOAD_MARGIN = '400px'

/** Lines set on the card; more never fit its height. */
const MAX_LINES = 40

/**
 * Whether an artifact is drawn as text in its card.
 * @param artifact - the artifact.
 * @returns true for Markdown and plain text files.
 */
export function isTextArtifact(artifact: Artifact): boolean {
  return /\.(md|markdown|txt)$/iu.test(artifact.path)
}

/**
 * The opening of a text as card lines: Markdown headings become headings, emphasis marks drop away, and a plain
 * text file stays literal.
 * @param text - the file's opening.
 * @param markdown - whether to read Markdown.
 * @returns the lines to set.
 */
export function textLines(text: string, markdown: boolean): ReactNode[] {
  return text.split(/\r?\n/u).slice(0, MAX_LINES).map((line, index) => {
    const heading = markdown ? /^(#{1,3})\s+(.*)$/u.exec(line) : null
    if (heading !== null) {
      const level = heading[1]?.length ?? 1
      return <span key={index} className={css.textHeading} data-level={level}>{heading[2]}</span>
    }
    if (line.trim() === '') return <span key={index} className={css.textGap} />
    return <span key={index} className={css.textLine}>{markdown ? line.replace(/[*_`]/gu, '').replace(/^\s*[-+]\s+/u, '• ') : line}</span>
  })
}

/**
 * Render a text artifact's opening.
 * @param props - the artifact, the loader for its opening, and the callbacks for loaded and failed.
 * @returns the paper the card shows.
 */
export function TextPreview({ artifact, load, onReady, onFail }: {
  artifact: Artifact
  load: (artifact: Artifact, signal: AbortSignal) => Promise<string | undefined>
  onReady: () => void
  onFail: () => void
}) {
  const paper = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)
  const [text, setText] = useState<string | undefined>(undefined)

  useEffect(() => {
    const element = paper.current
    if (element === null || near) return
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true)
      return
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) setNear(true)
    }, { rootMargin: LOAD_MARGIN })
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [near])

  useEffect(() => {
    if (!near) return
    const controller = new AbortController()
    load(artifact, controller.signal).then((loaded) => {
      if (controller.signal.aborted) return
      if (loaded === undefined) onFail()
      else {
        setText(loaded)
        onReady()
      }
    }, () => { if (!controller.signal.aborted) onFail() })
    return () => { controller.abort() }
  }, [near, artifact, load, onReady, onFail])

  return (
    <div ref={paper} className={css.text} aria-hidden="true">
      {text !== undefined && textLines(text, !artifact.path.toLowerCase().endsWith('.txt'))}
      <span className={css.textShade} />
    </div>
  )
}
