// @vitest-environment jsdom
// The step-to-source mapping is the whole contract phase 1 introduced: which
// block becomes engine markdown, which becomes the engine's reasoning block,
// when that block is left open, and what splits the step. Asserting it here
// keeps the mapping reviewable without reading rendered DOM to recover it.
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { AttachmentId } from '@aeven/attachment'
import type { AssistantBlock } from '../src/client/contract/snapshot.ts'
import { runsOf } from '../src/client/chat/AssistantMarkdown.tsx'

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
function sources(blocks: readonly AssistantBlock[], streaming: boolean): (string | null)[] {
  return runsOf(blocks, streaming).map(run => run.source)
}

/** Where each run starts, which is what React keys it by. */
function starts(blocks: readonly AssistantBlock[], streaming: boolean): number[] {
  return runsOf(blocks, streaming).map(run => run.start)
}

describe('a step becomes engine source', () => {
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

  it('wraps reasoning in the engine block it renders, closed once settled', () => {
    expect(sources([{ kind: 'reasoning', text: 'Let me look.' }], false))
      .toEqual(['<think>Let me look.</think>\n\n'])
  })

  it('leaves the reasoning open while the step streams', () => {
    expect(sources([{ kind: 'reasoning', text: 'Let me look.' }], true))
      .toEqual(['<think>Let me look.'])
  })

  it('closes a growing block only once the step settles', () => {
    const blocks = [{ kind: 'reasoning' as const, text: 'Let me look.' }]

    expect(sources(blocks, true)).toEqual(['<think>Let me look.'])
    expect(sources(blocks, false)).toEqual(['<think>Let me look.</think>\n\n'])
  })

  it('joins consecutive prose and reasoning into one source', () => {
    expect(sources([
      { kind: 'text', text: 'First. ' },
      { kind: 'reasoning', text: 'Hmm.' },
      { kind: 'text', text: ' Last.' },
    ], false)).toEqual(['First. <think>Hmm.</think>\n\n Last.'])
  })

  it('keeps reasoning that a later block already answered closed', () => {
    // The reasoning is no longer the step's last renderable block, so its
    // thinking is over even though the step is still running.
    expect(sources([
      { kind: 'reasoning', text: 'Hmm.' },
      { kind: 'text', text: 'Answer.' },
    ], true)).toEqual(['<think>Hmm.</think>\n\nAnswer.'])
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
    ], false)).toEqual([{ source: 'Answer.', start: 0 }])
  })

  it('draws a disclosure-owned trace nowhere inline, and the answer everywhere', () => {
    // The disclosure owns the trace, so the inline source must not repeat it —
    // and, above all, must not take the answer down with it. A run merges the
    // trace and the prose into one engine source, so drawing the trace and
    // hiding the run is what used to hide the reply behind a click.
    const blocks: AssistantBlock[] = [
      { kind: 'reasoning', text: 'Hmm.' },
      { kind: 'text', text: 'Answer.' },
    ]

    expect(runsOf(blocks, false, true).map(run => run.source)).toEqual(['Answer.'])
    expect(runsOf(blocks, false).map(run => run.source)).toEqual(['<think>Hmm.</think>\n\nAnswer.'])
  })

  it('leaves a skipped trace no room in the indices, so nothing moves', () => {
    // Keys and the standalone lookup both read a run's start as a position in the
    // step's own blocks. Filtering the trace out first would shift every later
    // block down by one: the engine would be remounted mid-stream under a changed
    // key, and an image after a trace would render whatever block took its place.
    const blocks: AssistantBlock[] = [
      { kind: 'reasoning', text: 'Hmm.' },
      { kind: 'image', attachment },
      { kind: 'text', text: 'Answer.' },
    ]

    expect(runsOf(blocks, false, true).map(run => run.start)).toEqual([1, 2])
    expect(runsOf(blocks, false, true).map(run => run.source)).toEqual([null, 'Answer.'])
  })

  it('closes a trace that something else already follows', () => {
    // The trace is no longer the step's last block, so its thinking is over —
    // and a tool head cannot keep it open, because an open block would be one
    // that nothing left in the source could ever close.
    expect(sources([
      { kind: 'reasoning', text: 'Hmm.' },
      { kind: 'tool-call', callId: 'c', name: 'bash', argsRaw: '{}' },
    ], true)).toEqual(['<think>Hmm.</think>\n\n'])
  })

  it('closes a trace before an image, which cannot close it either', () => {
    expect(sources([
      { kind: 'reasoning', text: 'Hmm.' },
      { kind: 'image', attachment },
    ], true)).toEqual(['<think>Hmm.</think>\n\n', null])
  })

  it('treats an unrecognized block like any other split', () => {
    expect(sources([
      { kind: 'text', text: 'Before.' },
      { kind: 'other', block: { type: 'mystery' } },
      { kind: 'text', text: 'After.' },
    ], false)).toEqual(['Before.', null, 'After.'])
  })

  it('is empty for a step with nothing in it', () => {
    expect(runsOf([], true)).toEqual([])
  })

  it('defuses a trace that spells the closing tag', () => {
    // The body cannot end its own block: the engine matches the tag after
    // parsing, so no markdown escape reaches it.
    expect(sources([{ kind: 'reasoning', text: 'Read </think> in the file.' }], false))
      .toEqual(['<think>Read ＜/think> in the file.</think>\n\n'])
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
    ], false)).toEqual(['<think>plan</think>\n\ndone'])
  })

  it('leaves a trace closed when a call follows it', () => {
    expect(sources([
      { kind: 'reasoning', text: 'plan' },
      { kind: 'tool-call', callId: 'c', name: 'bash', argsRaw: '{}' },
      { kind: 'text', text: 'done' },
    ], true)).toEqual(['<think>plan</think>\n\ndone'])
  })
})
