/** Sidebar shell style contracts shared with its slot-owned controls. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/SidebarRoot.module.css', import.meta.url)), 'utf8')

/**
 * Declarations of one exact selector, keyed by property.
 * @param selector - exact selector text.
 * @returns the normalized declarations, or undefined when absent.
 */
function declarations(selector: string): Map<string, string> | undefined {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const found = new Map<string, string>()
  for (const [, selectorList = '', body = ''] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorList.split(',').map(value => value.trim()).includes(selector)) continue
    for (const part of body.split(';')) {
      const colon = part.indexOf(':')
      if (colon === -1) continue
      found.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim().replace(/\s+/g, ' '))
    }
  }
  return found.size === 0 ? undefined : found
}

describe('SidebarRoot.module.css', () => {
  it('uses the Aeven panel and row geometry', () => {
    const root = declarations('.root')
    expect(root?.get('--dsh-sidebar-inline-padding')).toBe('var(--dsw-aeven-sidebar-row-inset)')
    expect(root?.get('padding')).toBe('8px 0 0')
    expect(root?.get('border-radius')).toBe('0 var(--dsw-aeven-sidebar-panel-radius) 0 0')
    expect(root?.get('backdrop-filter')).toBe('blur(4px)')
    expect(declarations('.logoRow')?.get('height')).toBe('var(--dsw-aeven-control-size)')
    expect(declarations('.toggle')?.get('padding')).toBe('0 var(--dsh-sidebar-inline-padding)')
    expect(declarations('.regionArea')?.get('margin')).toBe('0')
    expect(declarations('.regionArea')?.get('padding')).toBe('0')
    expect(declarations('.collapsed .regionArea')?.get('margin-left')).toBe('0')
    expect(declarations('.collapsed .regionArea')?.get('padding-left')).toBe('0')
    expect(declarations('.collapsed .regionArea')?.get('margin-right')).toBe('0')
  })

  it('keeps only the Aeven hamburger available after a complete collapse', () => {
    const collapsed = declarations('.root.collapsed')
    expect(collapsed?.get('width')).toBe('0')
    expect(declarations('.collapsed .logoRow')?.get('position')).toBe('fixed')
    expect(declarations('.collapsed .logoRow')?.get('width')).toBe('var(--dsw-aeven-sidebar-toggle-width)')
    expect(declarations('.collapsed .iconButton')?.get('padding')).toBe('0 0 0 24px')
    for (const selector of [
      '.collapsed .newSession',
      '.collapsed .regionArea',
      '.collapsed .footArea',
    ]) {
      expect(declarations(selector)?.get('display')).toBe('none')
    }
  })

  it('anchors the collapsed toggle at Aeven x=24', () => {
    expect(declarations('.collapsed .logoRow')?.get('justify-content')).toBe('flex-start')
    expect(declarations('.collapsed .iconButton')?.get('width')).toBe('var(--dsw-aeven-sidebar-toggle-width)')
    expect(declarations('.collapsed .iconButton')?.get('height')).toBe('var(--dsw-aeven-control-size)')
  })

  it('keeps the slotted brand row at the full artwork height', () => {
    expect(declarations('.brandIdentity')?.get('height')).toBe('24px')
    expect(declarations('.brandName')?.get('height')).toBe('24px')
    expect(declarations('.brandName')?.get('line-height')).toBe('24px')
    expect(declarations('.brandName')?.get('font-size')).toBe('18px')
  })
})
