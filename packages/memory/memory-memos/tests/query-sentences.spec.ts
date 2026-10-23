/**
 * Splitting the person's current message into the sentences of a turn-start recall. A message that opens on one
 * subject and asks about another is retrieved whole, so it matches memories of whichever subject dominates it; its
 * sentences are what give each subject its own retrieval.
 */
import { describe, expect, it } from 'vitest'
import { messageSentences } from '../src/query.ts'

describe('splitting a message into recall sentences', () => {
  it('splits a message that opens on one subject and asks about another', () => {
    expect(messageSentences(
      'I have Oracle trial credit. What would you advise me? I like highly performant inference',
      3,
    )).toEqual([
      'I have Oracle trial credit.',
      'What would you advise me?',
      'I like highly performant inference',
    ])
  })

  it('splits a message on its line breaks, which need no punctuation', () => {
    expect(messageSentences('Training plan for the marathon\nBudget for new running shoes', 3))
      .toEqual(['Training plan for the marathon', 'Budget for new running shoes'])
  })

  it('drops a sentence of fewer than three words', () => {
    expect(messageSentences('I have Oracle trial credit. Yes. What would you advise?', 3))
      .toEqual(['I have Oracle trial credit.', 'What would you advise?'])
  })

  it('keeps two sentences that state the same text once, in the first spelling', () => {
    expect(messageSentences('Tell me about the budget. tell me about the budget. And also the roadmap?', 3))
      .toEqual(['Tell me about the budget.', 'And also the roadmap?'])
  })

  it('returns at most the requested number of sentences, the leading ones', () => {
    expect(messageSentences(
      'Training plan for the marathon. Budget for new shoes. Recipe for race day. Hotel near the start line.',
      2,
    )).toEqual(['Training plan for the marathon.', 'Budget for new shoes.'])
  })

  it('collapses the whitespace inside a sentence', () => {
    expect(messageSentences('I   have  Oracle trial credit.  What would   you advise?', 3))
      .toEqual(['I have Oracle trial credit.', 'What would you advise?'])
  })

  it('returns no sentence for a one-sentence message', () => {
    expect(messageSentences('I am exhausted after the move', 3)).toEqual([])
  })

  it('returns no sentence when only one sentence of the message clears the word minimum', () => {
    expect(messageSentences('I am exhausted after the move. Thanks.', 3)).toEqual([])
  })
})
