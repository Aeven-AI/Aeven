import { Fragment, memo, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { JsonBlock, MarkdownText } from '@aeven/client-ui-primitives'
import type { MarkdownFileMentions } from '@aeven/client-ui-primitives'
import type { ChatNodeOwnerProps, ChatViewSlotProps } from '../contract/slots.ts'
import type { AssistantBlock } from '../contract/snapshot.ts'
import { markdownLabels } from '../markdown-labels.ts'
import { ReasoningRow } from './ReasoningRow.tsx'
import { useSearchableHidden } from './searchable-hidden.ts'
import css from './AssistantMarkdown.module.css'

export interface AssistantMarkdownProps {
  blocks: readonly AssistantBlock[]
  streaming: boolean
  /** Frozen partial of an aborted turn: rendered with a stopped marker. */
  interrupted?: boolean | undefined
  /** Render consecutive image blocks through the attachment slot. */
  renderMessageImages: ChatNodeOwnerProps['renderMessageImages']
  /** Hide reasoning that belongs to the Turn-level process disclosure. */
  reasoningHidden?: boolean | undefined
  /** Reveal the disclosure that hides this reasoning. */
  revealProcess?: (() => void) | undefined
  /** Resolved prose file mentions for this Assistant's closing turn. */
  mentions?: MarkdownFileMentions | undefined
  /** Keep the transcript on its live tail after an engine render. */
  scrollDown?: ChatNodeOwnerProps['scrollDown']
  /** A block in this step took the viewport, or gave it back. */
  onFullscreenChange?: ChatNodeOwnerProps['onFullscreenChange']
  /** The owning view's locale seat, passed down as a plain prop. */
  t: ChatViewSlotProps['t']
}

/**
 * One run of the step's content, in the order the model produced it.
 *
 * Consecutive prose blocks travel to the Markdown engine as one source so it
 * owns their block boundaries and caches. Reasoning, image galleries and
 * unrecognized blocks end the run in progress and render between the runs.
 */
export interface StepRun {
  /** The run's accumulated markdown, for a run the engine renders. */
  source: string | null
  /** Index of the block that opened a run the engine does not render. */
  start: number
}

/**
 * Split a step's blocks into ordered runs.
 *
 * React renders these; the function is exported because it is the whole of how
 * a step becomes Markdown, and a step's source is worth asserting on directly
 * rather than only through the DOM it produces.
 */
export function runsOf(blocks: readonly AssistantBlock[]): StepRun[] {
  const runs: StepRun[] = []
  let open: StepRun | null = null

  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]
    if (block === undefined) continue

    if (block.kind === 'tool-call' || (block.kind === 'reasoning' && block.text.trim() === '')) {
      // A tool head renders as its own Chat node row, and an empty trace has
      // nothing to show, so neither splits the prose around it.
      continue
    }

    if (block.kind === 'text') {
      if (open !== null && open.source !== null) {
        open.source += block.text
        continue
      }

      open = { source: block.text, start: index }
      runs.push(open)
      continue
    }

    open = { source: null, start: index }
    runs.push(open)

    while (block.kind === 'image' && blocks[index + 1]?.kind === 'image') {
      // One gallery covers the whole run of images, so no second run is opened
      // for images this one already holds.
      index += 1
    }
  }

  return runs
}

/**
 * Render one Assistant step: prose through the Markdown engine and each
 * reasoning block as a Think row between the prose runs.
 *
 * Runs are keyed by the index of the block that opened them, so a streaming
 * append extends the tail run instead of remounting the runs before it.
 */
export const AssistantMarkdown = memo(function AssistantMarkdown({
  blocks, streaming, interrupted, renderMessageImages,
  reasoningHidden = false, revealProcess, mentions, scrollDown, onFullscreenChange, t,
}: AssistantMarkdownProps) {
  // Stable per locale revision (t identity changes on switch): a fresh object
  // per render would rebuild MarkdownText's component table every chunk.
  const labels = useMemo(() => markdownLabels(t), [t])
  const runs = useMemo(() => runsOf(blocks), [blocks])
  // Runs that have faded in. Latching keeps the class (and its animation) after
  // the step settles, which would otherwise abort a fade still in flight.
  const fadedRuns = useRef(new Set<number>())
  for (const run of runs) {
    if (streaming && run.source !== null && run.source !== '') fadedRuns.current.add(run.start)
  }
  // Tool-call heads render as tool rows in the chat view's grouping pass, so
  // a node that is only those heads (or empty) would paint an empty root
  // between tool groups — skip the shell unless something visible remains.
  const hasVisible = interrupted === true
    || blocks.some(block => block.kind !== 'tool-call'
      && !(block.kind === 'reasoning' && block.text.trim() === ''))
  if (!hasVisible) return null

  return (
    <div
      className={css.root}
      data-streaming={streaming || undefined}
    >
      <div className={css.body}>
        {runs.map(run => run.source !== null
          ? (
            <div
              key={`run-${run.start}`}
              className={fadedRuns.current.has(run.start) ? css.enter : undefined}
            >
              <MarkdownText
                text={run.source}
                streaming={streaming}
                labels={labels}
                fileMentions={mentions}
                scrollDown={scrollDown}
                onFullscreenChange={onFullscreenChange}
              />
            </div>
          )
          : (
            <Fragment key={`block-${run.start}`}>
              {renderStandalone(blocks, run.start, {
                streaming, reasoningHidden, revealProcess, mentions, renderMessageImages, t,
              })}
            </Fragment>
          ))}
        {interrupted && <span className={css.stopped}>{t('message.stopped')}</span>}
      </div>
    </div>
  )
})

/** What a standalone block needs from its step. */
interface StandaloneContext {
  streaming: boolean
  reasoningHidden: boolean
  revealProcess: (() => void) | undefined
  mentions: MarkdownFileMentions | undefined
  renderMessageImages: ChatNodeOwnerProps['renderMessageImages']
  t: ChatViewSlotProps['t']
}

/**
 * Render one block the engine does not handle.
 *
 * Reasoning renders as a Think row, running only while it is the step's last
 * block. Consecutive image blocks share one gallery so several images tile
 * into rows; the run's start index keeps that group's key stable as it grows.
 * @param blocks - Assistant content blocks in authored order.
 * @param start - Index of the block that opened the run.
 * @param context - The step's streaming state, disclosure ownership and slots.
 * @returns The Think row, the gallery for an image run, or the unknown-block fallback.
 */
function renderStandalone(
  blocks: readonly AssistantBlock[],
  start: number,
  context: StandaloneContext,
): ReactNode {
  const block = blocks[start]
  const { t } = context

  /* v8 ignore next -- a run is only opened by a block that exists. */
  if (block === undefined) return null

  if (block.kind === 'reasoning') {
    return (
      <ProcessReasoning hidden={context.reasoningHidden} reveal={context.revealProcess}>
        <ReasoningRow
          text={block.text}
          running={context.streaming && start === blocks.length - 1}
          mentions={context.mentions}
          t={t}
        />
      </ProcessReasoning>
    )
  }

  if (block.kind === 'other') {
    return (
      <JsonBlock
        label={t('message.unknownBlock')}
        payload={block.block}
        truncatedLabel={total => t('json.truncated', { total })}
      />
    )
  }

  /* v8 ignore next -- text and tool calls never open this kind of run. */
  if (block.kind !== 'image') return null

  const images = [block]
  for (let index = start + 1; index < blocks.length; index++) {
    const next = blocks[index]
    if (next === undefined || next.kind !== 'image') break
    images.push(next)
  }

  return context.renderMessageImages({
    images: images.map(({ attachment }) => ({ attachment })),
    align: 'start',
    layout: 'gallery',
  })
}

/** Keep a Turn-process-owned trace mounted but searchable-hidden while the disclosure is closed. */
function ProcessReasoning({ hidden, reveal, children }: {
  hidden: boolean
  reveal: (() => void) | undefined
  children: ReactNode
}) {
  const ref = useSearchableHidden(hidden, reveal ?? NOOP)
  return <div ref={ref} data-turn-process-inline={hidden || undefined}>{children}</div>
}

const NOOP = (): void => {}
