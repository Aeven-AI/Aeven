// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import type { ChatSnapshot, UseChat } from '@aeven/client-ui-chat/client'
import type { PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ApprovalCommand, commandOf } from '../src/client/chat/ApprovalCommand.tsx'
import { apply as nodeApply } from '../src/index.ts'

function props(
  nodes: readonly unknown[],
  callId = 'call-1',
): PropsRuntime<'conversation.approval.detail'> & PropsLocale<'approval'> {
  const snapshot = {
    nodes: { values: () => nodes },
  } as unknown as ChatSnapshot
  const useChat = ((selector: (value: ChatSnapshot) => unknown) => selector(snapshot)) as UseChat
  // Detail labels stay verbatim: these specs assert the correlated call text, not copy.
  const t = ((key: string) => key) as PropsLocale<'approval'>['t']
  return { callId, useChat, t } as PropsRuntime<'conversation.approval.detail'> & PropsLocale<'approval'>
}

describe('commandOf', () => {
  it('accepts only a string command from valid JSON arguments', () => {
    expect(commandOf(undefined)).toBeUndefined()
    expect(commandOf({ callId: 'c1', argsRaw: '{' })).toBeUndefined()
    expect(commandOf({ callId: 'c1', argsRaw: '{}' })).toBeUndefined()
    expect(commandOf({ callId: 'c1', argsRaw: '{"command":42}' })).toBeUndefined()
    expect(commandOf({ callId: 'c1', argsRaw: '{"command":"pnpm test"}' })).toBe('pnpm test')
  })
})

describe('ApprovalCommand', () => {
  it('renders the running correlated Tool command', () => {
    render(<ApprovalCommand {...props([
      { kind: 'assistant-step', data: {} },
      {
        kind: 'tool-call',
        data: { root: { callId: 'other', name: 'bash', argsRaw: '{"command":"wrong"}', subCalls: [] } },
      },
      {
        kind: 'tool-call',
        data: { root: { callId: 'call-1', name: 'bash', argsRaw: '{"command":"pnpm test"}', subCalls: [] } },
      },
    ] as never)} />)

    expect(screen.getByText('pnpm test')).toBeTruthy()
  })

  it('finds a correlated call dispatched inside another Tool call', () => {
    render(<ApprovalCommand {...props([
      {
        kind: 'tool-call',
        data: {
          root: {
            callId: 'root',
            name: 'bash',
            argsRaw: '{"command":"wrong"}',
            subCalls: [{ callId: 'call-1', name: 'bash', argsRaw: '{"command":"pnpm lint"}', subCalls: [] }],
          },
        },
      },
    ] as never)} />)

    expect(screen.getByText('pnpm lint')).toBeTruthy()
  })

  it('renders the message a send call would deliver, whatever the tool name', () => {
    render(<ApprovalCommand {...props([
      {
        kind: 'tool-call',
        data: {
          root: {
            callId: 'call-1',
            name: 'mail_send',
            argsRaw: JSON.stringify({
              account: 'olivier@aeven.io',
              to: ['elizabeth@aeven.io'],
              subject: 'Hi',
              text: 'Hi Elizabeth,\n\nJust wanted to say hi — and that I love you.',
            }),
            subCalls: [],
          },
        },
      },
    ] as never)} />)

    expect(screen.getByText('to')).toBeTruthy()
    expect(screen.getByText('elizabeth@aeven.io')).toBeTruthy()
    expect(screen.getByText('subject')).toBeTruthy()
    expect(screen.getByText('Hi')).toBeTruthy()
    expect(screen.getByText('message')).toBeTruthy()
    expect(screen.getByText(/Just wanted to say hi/)).toBeTruthy()
  })

  it('omits a call whose arguments carry no message', () => {
    const { container } = render(<ApprovalCommand {...props([
      {
        kind: 'tool-call',
        data: {
          root: {
            callId: 'call-1',
            name: 'todo_write',
            argsRaw: '{"todos":[{"content":"write the plan"}]}',
            subCalls: [],
          },
        },
      },
    ] as never)} />)
    expect(container.textContent).toBe('')
  })

  it('keeps rendering every argument of a connector call', () => {
    render(<ApprovalCommand {...props([
      {
        kind: 'tool-call',
        data: {
          root: {
            callId: 'call-1',
            name: 'mcp__slack_abcd1234__slack_search_channels',
            argsRaw: '{"query":"general"}',
            subCalls: [],
          },
        },
      },
    ] as never)} />)

    expect(screen.getByText('general')).toBeTruthy()
  })

  it('omits absent, uncorrelated, and settled Tool calls', () => {
    const { container, rerender } = render(<ApprovalCommand {...props([
      { kind: 'assistant-step', data: {} },
      { kind: 'tool-call', data: { root: undefined } },
      { kind: 'tool-call', data: { root: { callId: 'other', name: 'bash', argsRaw: '{}', subCalls: [] } } },
      {
        kind: 'tool-call',
        data: {
          root: {
            kind: 'tool-result', callId: 'call-1', name: 'bash', argsRaw: '{"command":"ignored"}', subCalls: [],
          },
        },
      },
    ] as never)} />)
    expect(container.textContent).toBe('')

    rerender(<ApprovalCommand {...props([
      { kind: 'tool-call', data: { root: { callId: 'call-1', name: 'bash', argsRaw: '{}', subCalls: [] } } },
    ] as never)} />)
    expect(container.textContent).toBe('')
  })
})

describe('ui-chat package entries', () => {
  it('keeps the Host half optional', () => {
    const ctx = new Context()
    expect(() => { nodeApply(ctx) }).not.toThrow()
  })
})
