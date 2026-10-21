/** Verbatim auxiliary prompts used for relevance and capture judgments. */
import { describe, expect, it } from 'vitest'
import { RELEVANCE_PROMPT } from '../src/filter.ts'
import { TurnJudgeContext } from '../src/domain.ts'

// The expected files carry the one trailing newline the repository requires; neither prompt text ends with one.
describe('memory judgment guidance', () => {
  it('pins relevance rules for task complaints and personal support across every candidate kind', async () => {
    await expect(`${RELEVANCE_PROMPT}\n`).toMatchFileSnapshot('./expected/relevance-prompt.md')
  })

  it('pins attribution and factual-replacement rules in the final-reply summary request', async () => {
    const judges = new TurnJudgeContext()
    await judges.run({ project: '/workspace', previousReply: 'ExampleCo is ahead.' }, async () => {
      const request = judges.extend({
        op: 'capture.summarize',
        messages: [{ role: 'user', content: 'USER:\nThat ranking is unsupported.\n\nASSISTANT:\nThe ranking is retracted; overlap remains.' }],
      })
      const rules = request?.input.messages.at(-1)?.content ?? ''
      await expect(`${rules}\n`).toMatchFileSnapshot('./expected/capture-judgment.md')
    })
  })
})
