/**
 * The chat flow's font-size-axis adoption as CSS text. jsdom has no layout,
 * so these read the declarations that make think rows, compaction rows, the
 * turn-process summary, message clock, and the icon-action buttons follow the
 * Settings font-size preference through --avn-content-font-size /
 * --avn-content-font-delta.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../src/client/chat/${name}`, import.meta.url)), 'utf8')

/**
 * Declarations of the first rule whose comma-separated selector list contains
 * exactly this selector; a shared rule may group a drifted selector with the
 * one it mirrors.
 * @param source - CSS module source text.
 * @param selector - one selector of the rule to read.
 * @returns the rule's declarations, trimmed and without the trailing empty part.
 */
function declarationsFrom(source: string, selector: string): string[] {
  const declarationText = source.replace(/\/\*[\s\S]*?\*\//g, ' ')
  for (const rule of declarationText.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (rule[1] ?? '').split(',').map(part => part.trim())
    if (!selectors.includes(selector)) continue
    return (rule[2] ?? '').split(';').map(part => part.trim()).filter(Boolean)
  }
  throw new Error(`no \`${selector}\` rule`)
}

describe('chat flow font-size axis', () => {
  it('the turn-process summary reads the conversation content size', () => {
    expect(declarationsFrom(read('TurnProcessNodeView.module.css'), '.label')).toEqual(expect.arrayContaining([
      'font-size: 1rem',
      'line-height: 1.75rem',
    ]))
  })

  it('think rows read the conversation content size', () => {
    // Reasoning renders as this package's own Think row, so its summary line
    // and its collapsed height are this package's rules rather than an
    // override in the Markdown engine's host sheet.
    const css = read('ReasoningRow.module.css')
    expect(declarationsFrom(css, '.summary')).toEqual(expect.arrayContaining([
      'font-size: 1rem',
      'line-height: 1.75rem',
    ]))
    expect(declarationsFrom(css, '.root:not([data-expanded])')).toEqual(expect.arrayContaining([
      'height: 1.5rem',
    ]))
  })

  it('command and context summaries read the conversation content size', () => {
    expect(declarationsFrom(read('GenericCommandCard.module.css'), '.summary')).toEqual(expect.arrayContaining([
      'font-size: 1rem',
      'line-height: 1.75rem',
    ]))
    const context = read('ContextInjectionRow.module.css')
    for (const selector of ['.source', '.summary']) {
      expect(declarationsFrom(context, selector)).toEqual(expect.arrayContaining([
        'font-size: 1rem',
        'line-height: 1.75rem',
      ]))
    }
  })

  it('the message clock reads the body tier while action glyphs keep one metric', () => {
    const actions = read('MessageIconActions.module.css')
    // Both clocks read the body tier, so each clock stamps its message at the
    // size of the text it belongs to. The action glyphs beside them do not
    // scale: one fixed 16px metric keeps the row the same at every size, and
    // the CSS edge overrides each svg's own width/height attributes.
    expect(declarationsFrom(actions, '.timeStart')).toEqual(expect.arrayContaining([
      'font-size: 1rem',
    ]))
    expect(declarationsFrom(actions, '.timeEnd')).toEqual(expect.arrayContaining([
      'font-size: 1rem',
    ]))
    expect(declarationsFrom(actions, '.action svg')).toEqual(expect.arrayContaining([
      'width: 16px',
      'height: 16px',
    ]))
  })

  it('compaction rows follow the axis like the disclosure rows they mirror', () => {
    const css = read('MessageItem.module.css')
    for (const selector of ['.compactionTitle', '.compactionSummary', '.compactionBody']) {
      expect(declarationsFrom(css, selector)).toEqual(expect.arrayContaining([
        'font-size: 0.875rem',
        'line-height: 1.5rem',
      ]))
    }
    expect(declarationsFrom(css, '.compactionLeading svg')).toEqual(expect.arrayContaining([
      'width: 0.875rem',
      'height: 0.875rem',
    ]))
  })

  it('expanded bodies indent by 22px + delta so content stays under the shifted title start', () => {
    // The DisclosureRow title starts at leading (16 + delta) + gap 6; a fixed
    // 22px indent would misalign at every non-default size.
    const indent = '1.375rem'
    expect(declarationsFrom(read('MessageItem.module.css'), '.compactionBody'))
      .toEqual(expect.arrayContaining([`padding: 4px 0 4px ${indent}`]))
    expect(declarationsFrom(read('ContextInjectionRow.module.css'), '.body'))
      .toEqual(expect.arrayContaining([`margin: 4px 0 0 ${indent}`]))
  })

  it('the usage-details trigger reads the conversation content size', () => {
    const css = read('TurnUsagePanel.module.css')
    expect(declarationsFrom(css, '.trigger')).toEqual(expect.arrayContaining([
      'font-size: 1rem',
      'line-height: 1.75rem',
    ]))
  })

  it('the usage pill sizes its glyph and hit height like the sibling action buttons', () => {
    // The pill sits in the icon row right of the branch action; its data glyph
    // is the row's fixed 18px metric and its 28px hit height follows the same
    // delta rule as `.action`, so the row stays one height at every font size.
    const css = read('TurnUsagePanel.module.css')
    expect(declarationsFrom(css, '.trigger')).toEqual(expect.arrayContaining([
      'height: 1.75rem',
      'white-space: nowrap',
      'min-width: 0',
    ]))
    expect(declarationsFrom(css, '.trigger svg')).toEqual(expect.arrayContaining([
      'width: 18px',
      'height: 18px',
    ]))
    // A narrow column trims the pill label to an ellipsis instead of letting
    // it overflow or widen the chat column.
    expect(declarationsFrom(css, '.label')).toEqual(expect.arrayContaining([
      'min-width: 0',
      'overflow: hidden',
      'text-overflow: ellipsis',
    ]))
  })

  it('narrow viewports collapse the stat pills to the action-button circle', () => {
    // Below 480px the label hides and the pill takes the sibling `.action`
    // geometry (28px width, 6px padding, centered glyph); the -6px
    // label-padding rebate between adjacent pills resets so the icon pair
    // keeps the row's plain 8px rhythm instead of overlapping.
    const css = read('TurnUsagePanel.module.css')
    const narrow = /@media \(max-width: 480px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
    expect(narrow).toMatch(/\.trigger \{[^}]*justify-content: center/)
    expect(narrow).toMatch(/\.trigger \{[^}]*width: 1\.75rem/)
    expect(narrow).toMatch(/\.trigger \{[^}]*padding: 6px/)
    expect(narrow).toMatch(/\.trigger \.label \{[^}]*display: none/)
    expect(narrow).toMatch(/\.root \+ \.root \{[^}]*margin-left: 0/)
  })

  it('keeps every message actions row visible regardless of recency', () => {
    // Recency no longer gates the row: no hover-only reveal for earlier turn
    // tails or earlier user-authored rows, on any device.
    const css = read('MessageIconActions.module.css')
    expect(css).not.toContain('data-actions-reveal')
    expect(css).not.toContain('data-chat-flow-kind')
    expect(css).not.toMatch(/\.actions \{\s*opacity: 0/)
  })

  it('the interrupted-turn tag stays fixed like the dense token variants', () => {
    // 11px would fall to an illegible 9px at the 12px floor; the tag is
    // exempt from the axis the same way small/code tokens are.
    expect(declarationsFrom(read('AssistantMarkdown.module.css'), '.stopped')).toEqual(expect.arrayContaining([
      'font-size: 0.6875rem',
      'line-height: 1.125rem',
    ]))
  })
})
