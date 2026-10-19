/**
 * WorkflowRunPanel's font-size-axis adoption as CSS text. jsdom has no
 * layout, so these read the declarations that make the run/phase headers and
 * the expanded member rows follow the Settings font-size preference: member
 * labels at the body size (--avn-content-font-size / --avn-content-font-delta),
 * the chrome around them on the secondary tier
 * (--avn-content-font-size-secondary / --avn-content-font-delta-secondary).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  fileURLToPath(new URL('../src/client/WorkflowRunPanel.module.css', import.meta.url)),
  'utf8',
)
const declarationText = css.replace(/\/\*[\s\S]*?\*\//g, ' ')

function declarations(selector: string): string[] {
  const rule = new RegExp(`(?:^|\\})\\s*${selector.replace(/[.[\]():*+^$\\,\s]/g, '\\$&')}\\s*\\{([^{}]*)\\}`).exec(declarationText)
  if (rule === null) throw new Error(`WorkflowRunPanel.module.css has no \`${selector}\` rule`)
  return (rule[1] ?? '').split(';').map(part => part.trim()).filter(Boolean)
}

describe('WorkflowRunPanel.module.css font-size axis', () => {
  it('member labels ride the axis at the body size with matching row geometry', () => {
    expect(declarations('.memberLabel')).toEqual(expect.arrayContaining([
      'font-size: 1rem',
      'line-height: 1.5rem',
    ]))
    expect(declarations('.memberLabelWrap')).toEqual(expect.arrayContaining([
      'height: 1.5rem',
    ]))
  })

  it('member status and the empty placeholder read the secondary tier', () => {
    for (const selector of ['.memberStatus', '.empty']) {
      expect(declarations(selector)).toEqual(expect.arrayContaining([
        'font-size: 0.875rem',
        'line-height: 1.25rem',
      ]))
    }
  })

  it('the phase status column widens with the text so larger sizes do not truncate', () => {
    expect(declarations('.phaseStatus')).toEqual(expect.arrayContaining([
      'width: 8.875rem',
    ]))
  })
})
