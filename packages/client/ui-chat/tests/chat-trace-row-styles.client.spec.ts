/**
 * The live Turn's trace row keeps one place. jsdom has no layout, so this
 * reads the declarations that hold it there: the stand-in row the process
 * header holds and the reasoning row that replaces it in the Answer Step's
 * flow item must take the same gap, or the Think row jumps down as the model's
 * first token lands.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../src/client/chat/${name}`, import.meta.url)), 'utf8')

function declarationsFrom(source: string, selector: string): string[] {
  const declarationText = source.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const rule = new RegExp(`(?:^|[{}])\\s*${selector.replace(/[.[\]():*+^$\\]/g, '\\$&')}\\s*\\{([^{}]*)\\}`).exec(declarationText)
  if (rule === null) throw new Error(`no \`${selector}\` rule`)
  return (rule[1] ?? '').split(';').map(part => part.trim()).filter(Boolean)
}

describe('live Turn trace row', () => {
  it('the stand-in row holds the box the reasoning row lands in', () => {
    const chat = read('ChatView.module.css')
    // The chat column owns the number, so the stand-in rendered inside it
    // inherits the gap its replacement takes from the column's own rule.
    expect(declarationsFrom(chat, '.column')).toEqual(expect.arrayContaining([
      '--avn-chat-work-row-gap: 8px',
    ]))
    expect(declarationsFrom(chat, '.flowItem[data-chat-work-row]')).toEqual(expect.arrayContaining([
      '--avn-chat-flow-gap: var(--avn-chat-work-row-gap)',
    ]))
    const gap = /--avn-chat-work-row-gap:\s*([^;]+);/.exec(chat)?.[1]?.trim()
    expect(declarationsFrom(read('TurnProcessNodeView.module.css'), '.awaiting')).toEqual(
      expect.arrayContaining([`margin-top: var(--avn-chat-work-row-gap, ${String(gap)})`]),
    )
  })
})
