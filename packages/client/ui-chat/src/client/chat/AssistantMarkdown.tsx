import { Fragment, memo, useMemo } from 'react'
import type { ReactNode } from 'react'
import { JsonBlock, MarkdownText, reasoningSource } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNodeOwnerProps, ChatViewSlotProps } from '../contract/slots.ts'
import type { AssistantBlock } from '../contract/snapshot.ts'
import { markdownLabels } from '../markdown-labels.ts'
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
  /** Reveal the owning Turn-level process disclosure. */
  revealProcess?: (() => void) | undefined
  /** Resolved prose file mentions for this Assistant's closing turn. */
  mentions?: MarkdownFileMentions | undefined
  /** The owning view's locale seat, passed down as a plain prop. */
  t: ChatViewSlotProps['t']
}

/**
 * One run of the step's content, in the order the model produced it.
 *
 * Prose and reasoning are what the Markdown engine renders, and they travel to
 * it as one source so it owns their order, their block boundaries and its own
 * caches. Everything it cannot render — an image gallery, an unrecognized block
 * — ends the run in progress and is emitted between the runs.
 */
export interface StepRun {
  /** The run's accumulated markdown, for a run the engine renders. */
  source: string | null
  /** Index of the block that opened a run the engine does not render. */
  start: number
}

/**
 * Index of the block the step ends on.
 *
 * Reasoning stays open only as the step's *last* block, because that is the
 * block still being written. Anything after it — prose, an image, a tool head —
 * means this trace is finished, and an image or a tool head keeps it closed too
 * rather than leaving a block that nothing left in the source could close. A
 * step ending in tool heads alone has no such block, and opens nothing.
 * @param blocks - Assistant content blocks in authored order.
 * @returns The index of the last block, or -1 for an empty step.
 */
function lastEngineBlock(blocks: readonly AssistantBlock[]): number {
  const last = blocks.length - 1

  return blocks[last]?.kind === 'tool-call' ? -1 : last
}

/**
 * Split a step's blocks into ordered runs.
 *
 * React renders these; the function is exported because it is the whole of how
 * a step becomes Markdown, and a step's source is worth asserting on directly
 * rather than only through the DOM it produces.
 */
export function runsOf(
  blocks: readonly AssistantBlock[],
  streaming: boolean,
): StepRun[] {
  const runs: StepRun[] = []
  let open: StepRun | null = null

  // The last block the engine draws decides which reasoning is still running;
  // a tool head after it belongs to another node and never closes a block here.
  const tail = lastEngineBlock(blocks)

  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]
    if (block === undefined) continue

    if (block.kind === 'tool-call') {
      // A tool head renders as its own Chat node row, never here — so it is not
      // a split. It puts nothing between the two halves of the prose, and
      // treating it as one costs an engine instance for every call in the step
      // while drawing exactly the same thing.
      continue
    }

    if (block.kind === 'text' || block.kind === 'reasoning') {
      // Reasoning is left open while the step runs and closed once it settles:
      // an open block is the engine's "still thinking", and a step's thinking
      // is over when its answer is, not when the trace stops arriving.
      const source = block.kind === 'text'
        ? block.text
        : reasoningSource(block.text, streaming && index === tail)

      if (open !== null && open.source !== null) {
        open.source += source
        continue
      }

      open = { source, start: index }
      runs.push(open)
      continue
    }

    open = { source: null, start: index }
    runs.push(open)

    while (blocks[index + 1]?.kind === 'image') {
      // One gallery covers the whole run of images, so no second run is opened
      // for images this one already holds.
      index += 1
    }
  }

  return runs
}

/**
 * Render one Assistant step: its reasoning and its prose, as one engine source.
 *
 * The step used to render each block with a renderer of its own — prose through
 * the Markdown engine, reasoning through a disclosure component beside it — so
 * a step had as many renderers as it had blocks and the engine's reasoning
 * pipeline went unused. Now the step's content is one source, and the engine
 * draws all of it.
 *
 * Reasoning reaches the engine as the `<think>` block it already implements,
 * which is what a model's own inline reasoning produces; a block that is neither
 * prose nor reasoning ends the run in progress, so the authored order survives
 * the split. Keys are the index of the block that opened each run, so an append
 * extends a run instead of remounting everything after it — the engine keys its
 * rendered blocks by identity, and a shifted key throws that work away.
 */
export const AssistantMarkdown = memo(function AssistantMarkdown({
  blocks, streaming, interrupted, renderMessageImages,
  reasoningHidden = false, revealProcess, mentions, t,
}: AssistantMarkdownProps) {
  // Stable per locale revision (t identity changes on switch): a fresh object
  // per render would rebuild MarkdownText's component table every chunk.
  const labels = useMemo(() => markdownLabels(t), [t])
  const runs = useMemo(() => runsOf(blocks, streaming), [blocks, streaming])
  // Hook order is fixed: the hidden-reasoning attribute is attached to every
  // prose run whether or not one is rendered on this pass.
  const hidden = useSearchableHidden(reasoningHidden, revealProcess ?? NOOP)
  // Tool-call heads render as tool rows in the chat view's grouping pass, so
  // a node that is only those heads (or empty) would paint an empty root
  // between tool groups — skip the shell unless something visible remains.
  const hasVisible = streaming
    || interrupted === true
    || blocks.some(block => block.kind !== 'tool-call')
  if (!hasVisible) return null

  return (
    <div className={css.root} data-streaming={streaming || undefined}>
      <div className={css.body}>
        {runs.map(run => run.source !== null
          ? (
            <div
              key={`run-${run.start}`}
              ref={hidden}
              data-turn-process-inline={reasoningHidden || undefined}
            >
              <MarkdownText
                text={run.source}
                streaming={streaming}
                labels={labels}
                fileMentions={mentions}
              />
            </div>
          )
          : (
            <Fragment key={`block-${run.start}`}>
              {renderStandalone(blocks, run.start, renderMessageImages, t)}
            </Fragment>
          ))}
        {interrupted && <span className={css.stopped}>{t('message.stopped')}</span>}
      </div>
    </div>
  )
})

/**
 * Render one block the engine does not handle.
 *
 * Consecutive image blocks share one gallery so several images tile into rows
 * instead of each opening a one-image group of its own; the run's start index
 * is what keeps that group's key stable as the group grows.
 * @param blocks - Assistant content blocks in authored order.
 * @param start - Index of the block that opened the run.
 * @param renderMessageImages - The owning view's attachment gallery slot.
 * @param t - Chat locale seat.
 * @returns The gallery for an image run, or the unknown-block fallback.
 */
function renderStandalone(
  blocks: readonly AssistantBlock[],
  start: number,
  renderMessageImages: ChatNodeOwnerProps['renderMessageImages'],
  t: ChatViewSlotProps['t'],
): ReactNode {
  const block = blocks[start]

  /* v8 ignore next -- a run is only opened by a block that exists. */
  if (block === undefined) return null

  if (block.kind === 'other') {
    return (
      <JsonBlock
        label={t('message.unknownBlock')}
        payload={block.block}
        truncatedLabel={total => t('json.truncated', { total })}
      />
    )
  }

  /* v8 ignore next -- text, reasoning and tool calls never open this kind of run. */
  if (block.kind !== 'image') return null

  const images = [block]
  for (let index = start + 1; index < blocks.length; index++) {
    const next = blocks[index]
    if (next === undefined || next.kind !== 'image') break
    images.push(next)
  }

  return renderMessageImages({
    images: images.map(({ attachment }) => ({ attachment })),
    align: 'start',
  })
}

const NOOP = (): void => {}
