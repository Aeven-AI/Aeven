// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@aeven/client-test-runtime'
import { zh as commonZh } from '@aeven/client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locale.ts'
import { AssistantMarkdown, type AssistantMarkdownProps } from '../src/client/chat/AssistantMarkdown.tsx'

afterEach(() => {
  cleanup()
})

const t = makeTranslate(zh, commonZh)
const renderMessageImages: AssistantMarkdownProps['renderMessageImages'] = () => null

function view(props: Partial<AssistantMarkdownProps> & Pick<AssistantMarkdownProps, 'blocks'>) {
  return render(
    <AssistantMarkdown
      t={t}
      streaming={false}
      renderMessageImages={renderMessageImages}
      {...props}
    />,
  )
}

/** The one Think row a step renders for its reasoning. */
function thinkRow(container: HTMLElement): HTMLElement {
  const row = container.querySelector<HTMLElement>('[data-variant="think"]')
  if (row === null) throw new Error('the step rendered no Think row')
  return row
}

describe('reasoning as the step\'s own Think row', () => {
  it('renders a reasoning block as a Think disclosure, not as engine markdown', () => {
    const rendered = view({ blocks: [{ kind: 'reasoning', text: 'Inspect the session' }] })
    const row = thinkRow(rendered.container)

    // The row carries the disclosure chrome: the title the reader toggles, the
    // collapsed trace, and no engine instance behind it.
    expect(rendered.getByText('思考')).toBeTruthy()
    expect(row.dataset.state).toBe('ok')
    expect(row.textContent).toContain('Inspect the session')
    expect(rendered.container.querySelectorAll('.hypermarkdown')).toHaveLength(0)
  })

  it('collapses a settled block and opens it on request', () => {
    const rendered = view({
      blocks: [{ kind: 'reasoning', text: 'Inspect the session\nCheck persistence' }],
    })
    const row = thinkRow(rendered.container)
    const header = rendered.getByRole('button')

    // A settled block starts closed: the answer is what the reader came for.
    expect(row.hasAttribute('data-expanded')).toBe(false)
    expect(header.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(header)
    expect(row.hasAttribute('data-expanded')).toBe(true)
    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(row.textContent).toContain('Check persistence')
  })

  it('runs the block while the step streams and settles it when the step settles', () => {
    const live = view({
      blocks: [{ kind: 'reasoning', text: 'Inspect the session' }],
      streaming: true,
    })
    expect(thinkRow(live.container).dataset.state).toBe('running')
    expect(live.getByText('运行中')).toBeTruthy()

    live.rerender(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'Inspect the session' }]}
        streaming={false}
        renderMessageImages={renderMessageImages}
      />,
    )
    expect(thinkRow(live.container).dataset.state).toBe('ok')
    expect(live.queryByText('运行中')).toBeNull()
  })

  it('renders reasoning markdown as markdown', () => {
    const rendered = view({
      blocks: [{ kind: 'reasoning', text: 'Steps:\n\n- one\n- two\n' }],
    })
    fireEvent.click(rendered.getByRole('button'))

    expect(rendered.container.querySelectorAll('li')).toHaveLength(2)
  })
})

describe('a step as one engine source', () => {
  it('keeps the authored order of reasoning and prose', () => {
    const rendered = view({
      blocks: [
        { kind: 'text', text: 'First answer.' },
        { kind: 'reasoning', text: 'Second thoughts.' },
        { kind: 'text', text: 'Last answer.' },
      ],
    })
    const container = rendered.container
    const reasoning = thinkRow(container)
    const paragraphs = [...container.querySelectorAll('p')]
    const first = paragraphs.find(node => node.textContent === 'First answer.')
    const last = paragraphs.find(node => node.textContent === 'Last answer.')

    // 4 is DOCUMENT_POSITION_FOLLOWING: the reasoning row sits after the
    // first paragraph and before the last one, in the order they were authored.
    expect(first?.compareDocumentPosition(reasoning)).toBe(4)
    expect(reasoning.compareDocumentPosition(last!)).toBe(4)
  })

  it('sends consecutive text blocks through one renderer', () => {
    const rendered = view({
      blocks: [{ kind: 'text', text: 'First answer.' }, { kind: 'text', text: ' Second thought.' }],
    })

    // Both blocks land in the same engine instance, so the step has one stream
    // rather than one renderer per block.
    expect(rendered.container.querySelectorAll('.hypermarkdown')).toHaveLength(1)
  })

  it('splits the engine around a block it cannot render', () => {
    const rendered = view({
      blocks: [
        { kind: 'text', text: 'Before the image.' },
        { kind: 'image', attachment: { id: 'a-1' } },
        { kind: 'text', text: 'After the image.' },
      ] as AssistantMarkdownProps['blocks'],
      renderMessageImages: () => <div data-testid="gallery" />,
    })
    const container = rendered.container

    expect(container.querySelectorAll('.hypermarkdown')).toHaveLength(2)
    const gallery = container.querySelector('[data-testid="gallery"]')
    expect(gallery).not.toBeNull()
    expect(container.textContent).toContain('Before the image.')
    expect(container.textContent).toContain('After the image.')
  })

  it('still renders a tool-call-only step as nothing', () => {
    const rendered = view({
      blocks: [{ kind: 'tool-call', callId: 'c-1', name: 'read', argsRaw: '{}' }],
    })

    expect(rendered.container.firstChild).toBeNull()
  })

  it('keeps the stopped marker on an interrupted step', () => {
    const rendered = view({
      blocks: [{ kind: 'text', text: 'Partway through' }],
      interrupted: true,
    })

    expect(rendered.getByText('已停止')).toBeTruthy()
  })
})
