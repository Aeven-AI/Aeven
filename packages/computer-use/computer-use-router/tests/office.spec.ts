/**
 * The Office and LibreOffice recipes.
 *
 * These entries are `documented` rather than `verified`, and the invariant that
 * matters most here is that nothing quietly claims otherwise. A recipe set that
 * looked verified while never having run would be the most damaging possible
 * artifact: it would be trusted precisely because it looks measured.
 *
 * The second invariant is that each task prefers a semantic rung wherever one
 * exists, because that preference is the entire reason these recipes are worth
 * writing — a cell write is one COM or UNO call, where the ribbon route is a
 * sequence of clicks and dialogs.
 */

import { describe, expect, it } from 'vitest'
import {
  DOCUMENT_RECIPES,
  OFFICE_RECIPES,
  PRESENTATION_RECIPES,
  SPREADSHEET_RECIPES,
  STARTER_BOOK,
} from '../src/index.ts'
import { RecipeRouter } from '../src/router.ts'

describe('the Office set is honest about its evidence', () => {
  it('marks every entry documented, because none has been run on a real host', () => {
    for (const recipe of OFFICE_RECIPES) {
      for (const entry of recipe.on) {
        expect(entry.evidence, `${recipe.task} on ${entry.platform}`).toBe('documented')
      }
    }
  })

  it('gives every task at least one verification expectation', () => {
    for (const recipe of OFFICE_RECIPES) {
      expect(recipe.verify.length, recipe.task).toBeGreaterThan(0)
    }
  })

  it('names an operation for every invocation', () => {
    for (const recipe of OFFICE_RECIPES) {
      for (const entry of recipe.on) {
        expect(entry.invocation.operation.length, `${recipe.task} on ${entry.platform}`).toBeGreaterThan(0)
      }
    }
  })

  it('carries no recipe that duplicates another task name', () => {
    const tasks = OFFICE_RECIPES.map(recipe => recipe.task)
    expect(new Set(tasks).size).toBe(tasks.length)
  })

  it('only asserts a file format where the format is actually checkable', () => {
    // OOXML and ODF are containers, so a text search of their bytes would pass for
    // the wrong reason; only the PDF exports assert content.
    for (const recipe of OFFICE_RECIPES) {
      const contentChecks = recipe.verify.filter(expectation => expectation.kind === 'fileContains')
      const isPdfExport = recipe.task.endsWith('exportPdf')
      expect(contentChecks.length > 0, recipe.task).toBe(isPdfExport)
    }
  })
})

describe('each platform gets the mechanism that fits it', () => {
  const router = new RecipeRouter(OFFICE_RECIPES)

  it('uses COM on Windows for every Office task that has a Windows entry', () => {
    for (const recipe of OFFICE_RECIPES) {
      for (const entry of recipe.on.filter(candidate => candidate.platform === 'win32')) {
        expect(entry.invocation.mechanism, recipe.task).toBe('com')
      }
    }
  })

  it('uses the UNO API on Linux for every LibreOffice task', () => {
    for (const recipe of OFFICE_RECIPES) {
      for (const entry of recipe.on.filter(candidate => candidate.platform === 'linux')) {
        expect(entry.invocation.mechanism, recipe.task).toBe('dbus')
      }
    }
  })

  it('resolves a cell write to one semantic call on both Windows and Linux', () => {
    const windows = router.resolve({ task: 'spreadsheet.setCell', platform: 'win32', app: 'Excel.Application' })
    expect(windows.rung).toBe('semantic')
    expect(windows.invocation.operation).toContain('Range')

    const linux = router.resolve({ task: 'spreadsheet.setCell', platform: 'linux', app: 'libreoffice' })
    expect(linux.rung).toBe('semantic')
    expect(linux.invocation.operation).toContain('UNO')
  })

  it('refuses a cell write on macOS Numbers only when the app is not covered', () => {
    // Numbers is covered, so this resolves; PowerPoint on macOS is not.
    expect(() => router.resolve({ task: 'spreadsheet.setCell', platform: 'darwin', app: 'com.apple.Numbers' })).not.toThrow()
    expect(() => router.resolve({ task: 'slide.setText', platform: 'darwin', app: 'com.apple.Keynote' })).toThrow()
  })
})

describe('the macOS formatting carve-out is preserved', () => {
  const router = new RecipeRouter(OFFICE_RECIPES)

  it('resolves document.setFont to accessibility on macOS, because the semantic rung is blind', () => {
    const resolved = router.resolve({ task: 'document.setFont', platform: 'darwin', app: 'com.apple.Pages' })
    expect(resolved.rung).toBe('accessibility')
    expect(resolved.knownBlind).toContain('document.setFontSemantically')
  })

  it('keeps setFont semantic on Windows and Linux, where it genuinely is', () => {
    expect(router.resolve({ task: 'document.setFont', platform: 'win32', app: 'Word.Application' }).rung).toBe('semantic')
    expect(router.resolve({ task: 'document.setFont', platform: 'linux', app: 'libreoffice' }).rung).toBe('semantic')
  })
})

describe('the sets are exported separately and composed into the starter book', () => {
  it('exposes each group', () => {
    expect(SPREADSHEET_RECIPES.length).toBeGreaterThan(0)
    expect(DOCUMENT_RECIPES.length).toBeGreaterThan(0)
    expect(PRESENTATION_RECIPES.length).toBeGreaterThan(0)
    expect(OFFICE_RECIPES).toHaveLength(
      SPREADSHEET_RECIPES.length + DOCUMENT_RECIPES.length + PRESENTATION_RECIPES.length,
    )
  })

  it('includes every Office task in the starter book', () => {
    const bookTasks = new Set(STARTER_BOOK.map(recipe => recipe.task))
    for (const recipe of OFFICE_RECIPES) {
      expect(bookTasks.has(recipe.task), recipe.task).toBe(true)
    }
  })

  it('covers the Office programs named in the goal', () => {
    const windowsApps = new Set(OFFICE_RECIPES.flatMap(recipe => recipe.on.filter(entry => entry.platform === 'win32').flatMap(entry => entry.apps)))
    expect(windowsApps).toContain('Excel.Application')
    expect(windowsApps).toContain('Word.Application')
    expect(windowsApps).toContain('PowerPoint.Application')

    const linuxApps = new Set(OFFICE_RECIPES.flatMap(recipe => recipe.on.filter(entry => entry.platform === 'linux').flatMap(entry => entry.apps)))
    expect(linuxApps).toContain('libreoffice')
  })
})
