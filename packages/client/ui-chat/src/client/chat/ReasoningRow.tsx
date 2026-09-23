/** Assistant reasoning disclosure, independent of Tool-call presentation. */
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { DisclosureRow, IconThinkOutline14, MarkdownText, useTextAnimation } from '@aeven/client-ui-primitives'
import type { MarkdownFileMentions } from '@aeven/client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { markdownLabels } from '../markdown-labels.ts'
import a11yCss from './accessibility.module.css'
import css from './ReasoningRow.module.css'

const THINK_ICON = <IconThinkOutline14 size={14} />

/** One summary line and the offset of the paragraph it opens, which keys its words. */
interface SummaryLine {
  readonly start: number
  readonly text: string
}

const PARAGRAPH_SEPARATOR = /\r?\n(?:[\t ]*\r?\n)+/g

/**
 * The first line of the paragraph starting at `start`, trimmed.
 * @param text - complete or streaming reasoning text.
 * @param start - offset of the paragraph's first character.
 * @returns the paragraph's first line.
 */
function lineAt(text: string, start: number): SummaryLine {
  const newline = text.indexOf('\n', start)
  const line = newline === -1 ? text.slice(start) : text.slice(start, newline)
  return { start, text: line.trim().replaceAll('**', '') }
}

/**
 * The line a reasoning row summarizes: the trace's opening line once settled,
 * and the first line of the paragraph being written while it streams. A
 * paragraph that has not produced a word yet leaves the previous one showing.
 * @param text - complete or streaming reasoning text.
 * @param running - whether this block is the streaming tail.
 * @returns the summary line and the paragraph offset that keys its words.
 */
function summaryLine(text: string, running: boolean): SummaryLine {
  const first = text.length - text.trimStart().length
  if (!running) return lineAt(text, first)
  const starts = [first]
  PARAGRAPH_SEPARATOR.lastIndex = 0
  for (let match = PARAGRAPH_SEPARATOR.exec(text); match !== null; match = PARAGRAPH_SEPARATOR.exec(text)) {
    starts.push(match.index + match[0].length)
  }
  for (let index = starts.length - 1; index >= 0; index--) {
    const line = lineAt(text, starts[index] ?? first)
    if (line.text !== '') return line
  }
  return { start: first, text: '' }
}

/**
 * Split a summary line into words that fade in once each. Keys are the
 * paragraph offset and the word's position, so a growing word or a re-render
 * keeps its span (and its finished fade) and only newly arrived words mount.
 * @param line - the summary line.
 * @param wordClassName - class carrying the fade-in animation.
 * @returns the line as alternating word spans and whitespace.
 */
function fadingWords(line: SummaryLine, wordClassName: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let word = 0
  for (const part of line.text.split(/(\s+)/)) {
    if (part === '') continue
    if (/^\s+$/.test(part)) {
      nodes.push(part)
      continue
    }
    nodes.push(<span key={`${line.start}-${word}`} className={wordClassName}>{part}</span>)
    word += 1
  }
  return nodes
}

/**
 * Render one assistant reasoning block as a single Think row, collapsed until
 * the reader opens it. The collapsed summary omits double-asterisk markers.
 * While streaming it shows the first line of the paragraph being written,
 * follows its newest words, and fades each word in once when the enclosing
 * text-animation preference is on. Expanded content renders the complete
 * Markdown through the compact engine variant.
 * @param props.text - complete or streaming reasoning text.
 * @param props.running - whether this block is the streaming tail.
 * @param props.mentions - resolved prose file mentions forwarded to the body.
 * @param props.t - conversation locale seat for status and Markdown actions.
 * @returns the reasoning disclosure.
 */
export const ReasoningRow = memo(function ReasoningRow({ text, running, mentions, t }: {
  text: string
  running: boolean
  mentions?: MarkdownFileMentions | undefined
  t: ChatViewSlotProps['t']
}) {
  const [expanded, setExpanded] = useState(false)
  const toggle = useCallback(() => { setExpanded(value => !value) }, [])
  const labels = useMemo(() => markdownLabels(t), [t])
  const animation = useTextAnimation()
  const line = summaryLine(text, running)
  const lineStart = line.start
  const lineText = line.text
  const preview = !expanded && lineText !== ''
  const summaryRef = useRef<HTMLSpanElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const [overflowing, setOverflowing] = useState(false)
  useLayoutEffect(() => {
    // An end-aligned line overflows toward its start, which scrollWidth does
    // not count; the text box's own width against the row's does.
    const box = summaryRef.current
    const line = textRef.current
    const next = running && box !== null && line !== null && line.offsetWidth > box.clientWidth
    setOverflowing(value => value === next ? value : next)
  }, [running, lineText])
  const collapsedContent = useMemo(() => {
    const words = running && animation
      ? fadingWords({ start: lineStart, text: lineText }, css.word ?? '')
      : lineText
    return (
      <>
        <span className={css.separator} aria-hidden />
        <span
          ref={summaryRef}
          className={css.summary}
          data-streaming={running || undefined}
          data-overflowing={overflowing || undefined}
        >
          <span ref={textRef} className={css.summaryText}>{words}</span>
        </span>
      </>
    )
  }, [animation, lineStart, lineText, overflowing, running])
  const content = useMemo(() => expanded ? (
    <div className={css.thinkBody}>
      <MarkdownText text={text} streaming={running} labels={labels} fileMentions={mentions} variant="compact" />
    </div>
  ) : undefined, [expanded, labels, mentions, running, text])

  return (
    <div
      className={css.root}
      data-variant="think"
      data-state={running ? 'running' : 'ok'}
      data-expanded={expanded || undefined}
      data-preview={preview || undefined}
    >
      {running && <span className={a11yCss.visuallyHidden}>{t('row.running')}</span>}
      <DisclosureRow
        rowClassName={css.row}
        leadingClassName={css.leading}
        titleClassName={css.title}
        chevronClassName={css.chevron}
        icon={THINK_ICON}
        title={t('message.think')}
        open={expanded}
        expandable
        expandOnRowClick
        running={running}
        onToggle={toggle}
        collapsedContent={collapsedContent}
      >
        {content}
      </DisclosureRow>
    </div>
  )
})
