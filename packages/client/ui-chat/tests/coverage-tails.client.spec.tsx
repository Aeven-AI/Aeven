// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { makeTranslate } from '@aeven/client-test-runtime'
import { zh as commonZh } from '@aeven/client-locale/src/locales/zh.ts'
import { AssistantMarkdown, type AssistantMarkdownProps } from '../src/client/chat/AssistantMarkdown.tsx'
import { zh } from '../src/client/locale.ts'

const t: AssistantMarkdownProps['t'] = makeTranslate(zh, commonZh)
const renderMessageImages: AssistantMarkdownProps['renderMessageImages'] = () => null

afterEach(cleanup)

describe('tails', () => {
  it('AssistantMarkdown renders reasoning as its own Think row and unknown blocks as JSON fallback', () => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[
          { kind: 'reasoning', text: 'thinking hard\nsecond line' },
          { kind: 'tool-call', callId: 'c', name: 'bash', argsRaw: '{}' },
          { kind: 'other', block: { type: 'mystery' } },
        ]}
        streaming
        renderMessageImages={renderMessageImages}
      />,
    )
    // The reasoning row is drawn by this package, and the step keeps runs on
    // either side of the block this renderer does not own.
    const row = view.container.querySelector<HTMLElement>('[data-variant="think"]')
    expect(row).not.toBeNull()
    // A tool head follows the trace, so the row is settled rather than left
    // running with nothing in the step to settle it.
    expect(row?.dataset.state).toBe('ok')
    expect(row?.textContent).toContain('thinking hard')
    expect(view.getByText(/未知内容块/)).toBeTruthy()
    const stopped = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'text', text: 'partial words' }]}
        streaming={false}
        interrupted
        renderMessageImages={renderMessageImages}
      />,
    )
    expect(stopped.getByText('已停止')).toBeTruthy()
  })

  it('AssistantMarkdown skips the root shell when only tool-call heads remain', () => {
    // Tool heads are drawn by ChatView's tool groups; an empty root between
    // groups is layout noise (no text, no pulse, no interrupted marker).
    const empty = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'tool-call', callId: 'c', name: 'todo_write', argsRaw: '{}' }]}
        streaming={false}
        renderMessageImages={renderMessageImages}
      />,
    )
    expect(empty.container.firstChild).toBeNull()
    const blank = render(
      <AssistantMarkdown t={t} blocks={[]} streaming={false} renderMessageImages={renderMessageImages} />,
    )
    expect(blank.container.firstChild).toBeNull()
  })

})
