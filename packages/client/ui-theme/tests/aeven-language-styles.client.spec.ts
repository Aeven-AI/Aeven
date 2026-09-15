/** Central Aeven visual constants stay in one theme-owned stylesheet. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  fileURLToPath(new URL('../src/styles/aeven-language.css', import.meta.url)),
  'utf8',
)

const conversationCss = readFileSync(
  fileURLToPath(
    new URL(
      '../../ui-conversation/src/client/skeleton/ConversationRoot.module.css',
      import.meta.url,
    ),
  ),
  'utf8',
)

const inputBarCss = readFileSync(
  fileURLToPath(
    new URL(
      '../../ui-conversation/src/client/input/InputBar.module.css',
      import.meta.url,
    ),
  ),
  'utf8',
)

const buttonCss = readFileSync(
  fileURLToPath(
    new URL('../../ui-primitives/src/Button.module.css', import.meta.url),
  ),
  'utf8',
)

describe('Aeven visual language', () => {
  it('owns the shared geometry and neutral light palette', () => {
    expect(css).toContain('--dsw-aeven-chat-width: 1024px')
    expect(css).toContain('--dsw-aeven-page-inset: 24px')
    expect(css).toContain('--dsw-aeven-sidebar-width: 300px')
    expect(css).toContain('--dsw-aeven-sidebar-row-inset: 24px')
    expect(css).toContain('--dsw-aeven-sidebar-bottom-inset: 40px')
    expect(css).toContain('--dsw-aeven-sidebar-toggle-width: 68px')
    expect(css).toContain('--dsw-aeven-sidebar-panel-radius: 20px')
    expect(css).toContain('--dsw-aeven-sidebar-transition-duration: 400ms')
    expect(css).toContain('--dsw-aeven-control-size: 40px')
    expect(css).toContain('--dsw-aeven-radius-surface: 30px')
    expect(css).toContain('--dsw-aeven-radius-control: 20px')
    expect(css).toContain('--dsw-alias-bg-base: rgb(242, 242, 242)')
    expect(css).toContain('--dsw-specific-bubble: rgb(255, 255, 255)')
  })

  it('narrows the shared page inset at the Aeven mobile breakpoint', () => {
    expect(css).toMatch(
      /@media \(max-width: 640px\)[\s\S]*--dsw-aeven-page-inset: 16px/,
    )
    expect(css).toMatch(
      /@media \(max-width: 640px\)[\s\S]*--dsw-aeven-sidebar-row-inset: 16px/,
    )
  })

  it('provides shared geometry to the primary conversation surfaces', () => {
    expect(conversationCss).toContain('var(--dsw-aeven-chat-width)')
    expect(conversationCss).toContain('var(--dsw-aeven-page-inset)')
    expect(inputBarCss).toContain('var(--dsw-aeven-radius-surface)')
    expect(inputBarCss).toContain('var(--dsw-aeven-control-size)')
    expect(buttonCss).toContain('var(--dsw-aeven-radius-control)')
  })
})
