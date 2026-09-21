/**
 * Normalizing the source domains.
 *
 * The rename report is what lets a catalog explain a count that shrank, so the
 * properties under test are that every raw spelling folded into a canonical name
 * is named once, and that a spelling already recorded is not repeated.
 */

import { describe, expect, it } from 'vitest'
import type { TaskIntent } from '../src/intent.ts'
import { renameReport } from '../src/normalize.ts'

/** An intent carrying nothing but the domains a case needs. */
const intent = (apps: readonly string[]): TaskIntent => ({
  source: 'osworld',
  id: 'x',
  instruction: 'do something',
  apps,
  checks: [],
  hasTrajectory: false,
  setupTypes: [],
})

describe('the rename report', () => {
  it('names every raw spelling that folded into one canonical domain', () => {
    const renames = renameReport([intent(['libreoffice calc']), intent(['libreoffice_calc'])])
    expect(renames.get('libreoffice-calc')).toEqual(['libreoffice calc', 'libreoffice_calc'])
  })

  it('names a spelling once however often the sources write it', () => {
    const renames = renameReport([intent(['vs_code']), intent(['vs_code'])])
    expect(renames.get('vscode')).toEqual(['vs_code'])
  })
})
