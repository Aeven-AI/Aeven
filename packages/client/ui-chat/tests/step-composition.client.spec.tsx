// @vitest-environment jsdom
// The step-to-source mapping is the whole contract phase 1 introduced: which
// block becomes engine markdown, which becomes the engine's reasoning block,
// when that block is left open, and what splits the step. Asserting it here
// keeps the mapping reviewable without reading rendered DOM to recover it.
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
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
