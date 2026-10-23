/**
 * What the reviewer is shown when a turn is large: long text keeps its head and
 * tail, the oldest tool calls and results make room for newer ones, failed
 * results are marked as such, and the user's messages and the replies are never
 * dropped, even when keeping them alone exceeds the budget.
 */

import { describe, expect, it } from 'vitest'
import { textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { mountReview, reviewConfig, transcriptOf } from './harness.ts'

const CLEAN = '{"complete": true, "issues": []}'
const CLIPPED = reviewConfig({ maxEntryChars: 100 })

/** The middle-cut form of a text longer than the entry budget. */
function clipped(text: string, max = 100): string {
  const half = Math.floor((max - 20) / 2)
  return `${text.slice(0, half)}\n…[${text.length - 2 * half} chars cut]…\n${text.slice(-half)}`
}

describe('long entries', () => {
  it('keeps the head and tail of a long tool call and a long reply', async () => {
    const arguments_ = JSON.stringify({ body: 'x'.repeat(300) })
    const reply = `Wrote notes.md.${'y'.repeat(300)}`
    const review = await mountReview([
      toolCallResponse('c1', 'write', { body: 'x'.repeat(300) }),
      textResponse(reply),
      textResponse(CLEAN),
    ], CLIPPED)

    await review.turn()

    expect(transcriptOf(review.ofType('turn-review/request')[0]!.data)).toEqual([
      { user: 'write the notes file' },
      { call: 'write', arguments: clipped(arguments_) },
      { result: 'wrote notes.md' },
      { assistant: clipped(reply) },
    ])
  })

  it('marks a failed tool result as an error', async () => {
    const review = await mountReview([
      toolCallResponse('c1', 'str_replace_editor', {}),
      toolCallResponse('c2', 'write', {}),
      textResponse('Wrote notes.md after the failed edit.'),
      textResponse(CLEAN),
    ])

    await review.turn()

    expect(transcriptOf(review.ofType('turn-review/request')[0]!.data)).toEqual([
      { user: 'write the notes file' },
      { call: 'str_replace_editor', arguments: '{}' },
      { result: 'Error: the text to replace is absent', error: true },
      { call: 'write', arguments: '{}' },
      { result: 'wrote notes.md' },
      { assistant: 'Wrote notes.md after the failed edit.' },
    ])
  })
})

describe('a transcript longer than its budget', () => {
  it('drops the oldest tool calls and results until the newest ones fit', async () => {
    const bodies = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    const review = await mountReview([
      ...bodies.map((body, index) => toolCallResponse(`c${index + 1}`, 'write', { body: body.repeat(300) })),
      textResponse('Wrote all seven.'),
      textResponse(CLEAN),
    ], reviewConfig({ maxEntryChars: 100, maxTranscriptChars: 1000 }))

    await review.turn()

    const transcript = transcriptOf(review.ofType('turn-review/request')[0]!.data) as Record<string, string>[]
    expect(JSON.stringify(transcript).length).toBeLessThanOrEqual(1000)
    expect(transcript[0]).toEqual({ user: 'write the notes file' })
    expect(transcript.at(-1)).toEqual({ assistant: 'Wrote all seven.' })
    // Whole entries leave from the oldest end until the newest calls fit.
    expect(transcript.filter(entry => entry.call !== undefined)).toHaveLength(5)
    expect(transcript.filter(entry => entry.result !== undefined)).toHaveLength(6)
    expect(transcript.some(entry => entry.arguments?.includes('"body":"cccc'))).toBe(true)
    expect(transcript.some(entry => entry.arguments?.includes('"body":"gggg'))).toBe(true)
  })

  it('keeps the messages and replies even when they alone exceed the budget', async () => {
    const step = 'z'.repeat(300)
    const review = await mountReview([
      ...Array.from({ length: 9 }, (_, index) => toolCallResponse(`c${index + 1}`, 'write', {}, step)),
      textResponse('Wrote nine files.'),
      textResponse(CLEAN),
    ], reviewConfig({ maxEntryChars: 100, maxTranscriptChars: 1000 }))

    await review.turn()

    const transcript = transcriptOf(review.ofType('turn-review/request')[0]!.data) as Record<string, string>[]
    expect(JSON.stringify(transcript).length).toBeGreaterThan(1000)
    expect(transcript.filter(entry => entry.call !== undefined || entry.result !== undefined)).toEqual([])
    expect(transcript).toHaveLength(11)
    expect(transcript[0]).toEqual({ user: 'write the notes file' })
    expect(transcript.at(-1)).toEqual({ assistant: 'Wrote nine files.' })
    expect(transcript[1]).toEqual({ assistant: clipped(step) })
  })
})
