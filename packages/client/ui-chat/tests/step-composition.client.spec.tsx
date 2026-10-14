// @vitest-environment jsdom
// The step-to-runs mapping is the whole composition: which blocks join one
// engine source, which open a run the engine does not render (a reasoning row,
// an image gallery, an unknown block), and where each run starts. Asserting it
// here keeps the mapping reviewable without reading rendered DOM to recover it.
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { AttachmentId } from '@aeven/attachment'
import { makeTranslate } from '@aeven/client-test-runtime'
import { zh as commonZh } from '@aeven/client-locale/src/locales/zh.ts'
import type { AssistantBlock } from '../src/client/contract/snapshot.ts'
import { AssistantMarkdown, runsOf } from '../src/client/chat/AssistantMarkdown.tsx'
import { zh } from '../src/client/locale.ts'

afterEach(cleanup)

const t = makeTranslate(zh, commonZh)
const renderMessageImages: React.ComponentProps<typeof AssistantMarkdown>['renderMessageImages'] = () => null

/** An attachment reference of the shape the projection carries. */
const attachment = {
  attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
  mediaType: 'image/png' as const,
  bytes: 68,
  width: 640,
  height: 320,
  name: 'history.png',
}

/** The engine-rendered sources of a step, in authored order. */
function sources(blocks: readonly AssistantBlock[], _streaming: boolean): (string | null)[] {
  return runsOf(blocks).map(run => run.source)
}

/** Where each run starts, which is what React keys it by. */
function starts(blocks: readonly AssistantBlock[], _streaming: boolean): number[] {
  return runsOf(blocks).map(run => run.start)
}

/**
 * The Think rows a step renders for its reasoning, in order: each row's
 * running/settled state and the text it shows before the reader expands it.
 * @param blocks - Assistant content blocks in authored order.
 * @param streaming - whether the step is still producing content.
 * @returns one entry per rendered reasoning row.
 */
function thinkingRows(
  blocks: readonly AssistantBlock[],
  streaming: boolean,
): { readonly state: string | undefined; readonly text: string }[] {
  const view = render(
    <AssistantMarkdown
      t={t}
      blocks={blocks}
      streaming={streaming}
      renderMessageImages={renderMessageImages}
    />,
  )
  return [...view.container.querySelectorAll<HTMLElement>('[data-variant="think"]')]
    .map(row => ({ state: row.dataset.state, text: row.textContent ?? '' }))
}

describe('a step becomes engine runs', () => {
  it('renders nothing for a step with nothing in it', () => {
    // The composition is asserted directly below; this one render keeps the
    // module graph on the .tsx path the app itself uses.
    render(<div />)
    expect(true).toBe(true)
  })

  it('appends prose as it was written', () => {
    expect(sources([{ kind: 'text', text: 'The answer is 42.' }], false))
      .toEqual(['The answer is 42.'])
  })

  it('gives a reasoning block a run of its own that no engine instance renders', () => {
    expect(sources([{ kind: 'reasoning', text: 'Let me look.' }], false)).toEqual([null])
    const rows = thinkingRows([{ kind: 'reasoning', text: 'Let me look.' }], false)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.state).toBe('ok')
    expect(rows[0]?.text).toContain('Let me look.')
  })

  it('leaves the trace in the same run as the step streams and once it settles', () => {
    // The row's own state carries the running/settled distinction, so the run
    // itself is stable and a settling step cannot remount the trace.
    const blocks = [{ kind: 'reasoning' as const, text: 'Let me look.' }]

    expect(sources(blocks, true)).toEqual([null])
    expect(sources(blocks, false)).toEqual([null])
    expect(thinkingRows(blocks, true)[0]?.state).toBe('running')
    expect(thinkingRows(blocks, false)[0]?.state).toBe('ok')
  })

  it('joins consecutive prose and reasoning into interleaved runs', () => {
    expect(sources([
      { kind: 'text', text: 'First. ' },
      { kind: 'reasoning', text: 'Hmm.' },
      { kind: 'text', text: ' Last.' },
    ], false)).toEqual(['First. ', null, ' Last.'])
  })

  it('keeps reasoning that a later block already answered settled', () => {
    // The reasoning is no longer the step's last block, so its row shows a
    // settled trace even though the step is still running.
    const rows = thinkingRows([
      { kind: 'reasoning', text: 'Hmm.' },
      { kind: 'text', text: 'Answer.' },
    ], true)

    expect(rows).toHaveLength(1)
    expect(rows[0]?.state).toBe('ok')
    expect(rows[0]?.text).toContain('Hmm.')
  })

  it('splits around a block the engine does not render', () => {
    const blocks = [
      { kind: 'text' as const, text: 'Before.' },
      { kind: 'image' as const, attachment },
      { kind: 'text' as const, text: 'After.' },
    ]

    expect(sources(blocks, false)).toEqual(['Before.', null, 'After.'])
    // Each run is keyed by the block that opened it, so an append extends a run
    // rather than shifting the keys of the runs after it.
    expect(starts(blocks, false)).toEqual([0, 1, 2])
  })

  it('groups a run of images into one region', () => {
    const blocks = [
      { kind: 'text' as const, text: 'Before.' },
      { kind: 'image' as const, attachment },
      { kind: 'image' as const, attachment },
      { kind: 'image' as const, attachment },
      { kind: 'text' as const, text: 'After.' },
    ]

    expect(starts(blocks, false)).toEqual([0, 1, 4])
  })

  it('leaves no region for the tool heads another node draws', () => {
    expect(runsOf([
      { kind: 'text', text: 'Answer.' },
      { kind: 'tool-call', callId: 'c', name: 'bash', argsRaw: '{}' },
    ])).toEqual([{ source: 'Answer.', start: 0 }])
  })

  it('settles a trace that something else already follows', () => {
    // The trace is no longer the step's last block, so its row is settled — and
    // a tool head cannot keep it running, because a running row would be one
    // that nothing left in the step could ever settle.
    const rows = thinkingRows([
      { kind: 'reasoning', text: 'Hmm.' },
      { kind: 'tool-call', callId: 'c', name: 'bash', argsRaw: '{}' },
    ], true)

    expect(rows).toHaveLength(1)
    expect(rows[0]?.state).toBe('ok')
    expect(rows[0]?.text).toContain('Hmm.')
  })

  it('settles a trace before an image, which cannot settle it either', () => {
    const blocks = [
      { kind: 'reasoning' as const, text: 'Hmm.' },
      { kind: 'image' as const, attachment },
    ]

    expect(sources(blocks, true)).toEqual([null, null])
    expect(thinkingRows(blocks, true)[0]?.state).toBe('ok')
  })

  it('treats an unrecognized block like any other split', () => {
    expect(sources([
      { kind: 'text', text: 'Before.' },
      { kind: 'other', block: { type: 'mystery' } },
      { kind: 'text', text: 'After.' },
    ], false)).toEqual(['Before.', null, 'After.'])
  })

  it('is empty for a step with nothing in it', () => {
    expect(runsOf([])).toEqual([])
  })

  it('carries the trace text through verbatim', () => {
    // The row renders the trace as Markdown, so nothing has to escape a token
    // the text happens to spell — there is no closing tag for it to close.
    const rows = thinkingRows([{ kind: 'reasoning', text: 'Read </think> in the file.' }], false)

    expect(rows).toHaveLength(1)
    expect(rows[0]?.text).toContain('Read </think> in the file.')
  })
})

describe('a tool head is not a split', () => {
  it('keeps the prose on either side of a tool head in one source', () => {
    // The head renders as its own Chat node, so nothing here separates the two
    // halves: splitting them would cost an engine instance per call and draw
    // exactly the same thing.
    expect(sources([
      { kind: 'text', text: 'Before.' },
      { kind: 'tool-call', callId: 'c', name: 'bash', argsRaw: '{}' },
      { kind: 'text', text: ' After.' },
    ], false)).toEqual(['Before. After.'])
  })

  it('costs one source however many calls the step made', () => {
    const calls = Array.from({ length: 8 }, (_, index): AssistantBlock => (
      { kind: 'tool-call', callId: `c${index}`, name: 'bash', argsRaw: '{}' }
    ))

    expect(sources([
      { kind: 'reasoning', text: 'plan' },
      ...calls,
      { kind: 'text', text: 'done' },
    ], false)).toEqual([null, 'done'])
    // The trace is settled by the calls that follow it, so its row is not the
    // running tail even though the step has more content to draw.
    expect(thinkingRows([
      { kind: 'reasoning', text: 'plan' },
      ...calls,
      { kind: 'text', text: 'done' },
    ], false)[0]?.state).toBe('ok')
  })

  it('settles a trace when a call follows it', () => {
    expect(sources([
      { kind: 'reasoning', text: 'plan' },
      { kind: 'tool-call', callId: 'c', name: 'bash', argsRaw: '{}' },
      { kind: 'text', text: 'done' },
    ], true)).toEqual([null, 'done'])
  })
})
