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

describe('reasoning inside the Markdown engine', () => {
  it('renders a reasoning block as the engine draws it, not as a host row', () => {
    const rendered = view({ blocks: [{ kind: 'reasoning', text: 'Inspect the session' }] })
    const wrapper = rendered.container.querySelector('.reasoning-wrapper')

    expect(wrapper).not.toBeNull()
    // The engine's own chrome carries the block: a header the reader toggles,
    // the collapsed body, and the block's own timing.
    expect(wrapper?.querySelector('.reasoning-header')).not.toBeNull()
    expect(wrapper?.textContent).toContain('思考了')
  })

  it('collapses a settled block and opens it on request', () => {
    const rendered = view({
      blocks: [{ kind: 'reasoning', text: 'Inspect the session\nCheck persistence' }],
    })
    const wrapper = rendered.container.querySelector('.reasoning-wrapper') as HTMLElement
    const header = rendered.getByRole('button')

    // A finished block starts closed: the answer is what the reader came for.
    expect(wrapper.className).toContain('collapsed')
    expect(header.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(header)
    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(rendered.container.querySelector('.reasoning-content')?.textContent)
      .toContain('Check persistence')
  })

  it('runs the block while the step streams and closes it when the step settles', () => {
    const live = view({
      blocks: [{ kind: 'reasoning', text: 'Inspect the session' }],
      streaming: true,
    })
    expect(live.container.querySelector('.reasoning-wrapper')?.className).toContain('stream-active')
    expect(live.getByText('思考')).toBeTruthy()

    live.rerender(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'Inspect the session' }]}
        streaming={false}
        renderMessageImages={renderMessageImages}
      />,
    )
    expect(live.container.querySelector('.reasoning-wrapper')?.className).not.toContain('stream-active')
    expect(live.getByText(/思考了 \d+ 秒/)).toBeTruthy()
  })

  it('renders reasoning markdown as markdown', () => {
    const rendered = view({
      blocks: [{ kind: 'reasoning', text: 'Steps:\n\n- one\n- two\n' }],
    })
    fireEvent.click(rendered.getByRole('button'))

    expect(rendered.container.querySelectorAll('.reasoning-content li')).toHaveLength(2)
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
    const reasoning = container.querySelector('.reasoning-wrapper')
    const paragraphs = [...container.querySelectorAll('p')]
    const first = paragraphs.find(node => node.textContent === 'First answer.')
    const last = paragraphs.find(node => node.textContent === 'Last answer.')

    expect(reasoning).not.toBeNull()
    // 4 is DOCUMENT_POSITION_FOLLOWING: the reasoning block sits after the
    // first paragraph and before the last one, in the order they were authored.
    expect(first?.compareDocumentPosition(reasoning!)).toBe(4)
    expect(reasoning?.compareDocumentPosition(last!)).toBe(4)
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
