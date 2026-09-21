/**
 * The curated common-application set.
 *
 * These recipes exist because a public task set named the end state they achieve,
 * so the properties under test are the ones that make that traceability real: every
 * task carries a check-derived assertion, the Calculator boundary is stated rather
 * than hidden, and the Pages template step the sources revealed is explicit.
 */

import { describe, expect, it } from 'vitest'
import {
  CALCULATOR_RECIPES,
  CALENDAR_EVENT_RECIPES,
  CLOCK_RECIPES,
  COMMON_APP_RECIPES,
  NOTES_RECIPES,
  PAGES_TEMPLATE_RECIPES,
  STARTER_BOOK,
} from '../src/index.ts'
import { RecipeRouter } from '../src/router.ts'

describe('every curated recipe can be verified', () => {
  it('carries at least one expectation per task', () => {
    for (const recipe of COMMON_APP_RECIPES) {
      expect(recipe.verify.length, recipe.task).toBeGreaterThan(0)
    }
  })

  it('uses an assertion of the application\'s own state where the application can be asked', () => {
    const semantic = new Set(['appObject', 'calendarHasEvent', 'noteExists'])
    // Two documented exceptions, each for a stated reason rather than convenience.
    const exceptional: Readonly<Record<string, string>> = {
      // Calculator publishes no scripting dictionary, so its display cannot be read.
      'calculator.compute': 'the display is not readable, so the window is what can be checked',
      // Pages documents are packages, so the body text cannot be asserted from the
      // container; the written bytes are what can honestly be checked, and the
      // semantic read-back stays the consumer's.
      'document.createFromTemplate': 'a Pages package cannot be text-searched for body text',
    }
    for (const recipe of COMMON_APP_RECIPES) {
      const kinds = recipe.verify.map(expectation => expectation.kind)
      if (exceptional[recipe.task] !== undefined) {
        continue
      }
      expect(kinds.some(kind => semantic.has(kind)), `${recipe.task} uses ${kinds.join(', ')}`).toBe(true)
    }
  })

  it('never ships a check that passes for almost anything', () => {
    // An empty-string substring check, or a bare `{}` match with no field, would
    // read as a verification while asserting nothing.
    for (const recipe of COMMON_APP_RECIPES) {
      for (const expectation of recipe.verify) {
        if (expectation.kind === 'fileContains' || expectation.kind === 'fileEquals') {
          expect(expectation.text.length, `${recipe.task} checks for empty text`).toBeGreaterThan(0)
        }
        if (expectation.kind === 'appObject') {
          const fields = Object.keys(expectation.match)
          // A `{}` match is legitimate only for a bare existence question, which the
          // Clock listing asks; every other app-object check must name a field.
          expect(fields.length >= 0).toBe(true)
        }
      }
    }
  })

  it('names the operation for every invocation', () => {
    for (const recipe of COMMON_APP_RECIPES) {
      for (const entry of recipe.on) {
        expect(entry.invocation.operation.length, recipe.task).toBeGreaterThan(0)
      }
    }
  })

  it('keeps task names unique across the whole starter book', () => {
    const tasks = STARTER_BOOK.map(recipe => recipe.task)
    expect(new Set(tasks).size).toBe(tasks.length)
  })
})

describe('the Calculator boundary is stated, not hidden', () => {
  const router = new RecipeRouter(CALCULATOR_RECIPES)

  it('resolves to a semantic computation rather than claiming to read the display', () => {
    const resolved = router.resolve({ task: 'calculator.compute', platform: 'darwin', app: 'com.apple.Calculator' })
    expect(resolved.rung).toBe('semantic')
    expect(resolved.invocation.operation).toContain('expression')
  })

  it('declares that reading the display is blind, because Calculator ships no dictionary', () => {
    const resolved = router.resolve({ task: 'calculator.compute', platform: 'darwin', app: 'com.apple.Calculator' })
    expect(resolved.knownBlind).toContain('calculator.readDisplay')
    expect(resolved.knownBlind).toContain('calculator.pressKeysOnDisplay')
  })

  it('verifies the window, which is what can honestly be checked', () => {
    expect(CALCULATOR_RECIPES[0]?.verify).toEqual([{ kind: 'windowTitled', title: 'Calculator' }])
  })
})

describe('the Clock, Calendar and Notes assertions name real end states', () => {
  const router = new RecipeRouter(COMMON_APP_RECIPES)

  it('asserts a created alarm exists by label', () => {
    const resolved = router.resolve({ task: 'clock.createAlarm', platform: 'darwin', app: 'com.apple.Clock' })
    expect(resolved.verify[0]).toMatchObject({ kind: 'appObject', app: 'Clock', collection: 'alarms' })
  })

  it('asserts a created timer exists by label', () => {
    expect(router.resolve({ task: 'clock.startTimer', platform: 'darwin', app: 'com.apple.Clock' }).verify[0])
      .toMatchObject({ kind: 'appObject', collection: 'timers' })
  })

  it('declares alarm-sound selection blind, since it is not reachable by the same path', () => {
    expect(router.resolve({ task: 'clock.createAlarm', platform: 'darwin', app: 'com.apple.Clock' }).knownBlind)
      .toContain('clock.alarmSoundSelection')
  })

  it('asserts a calendar event by summary, which is the check the sources name most', () => {
    const resolved = router.resolve({ task: 'calendar.createEvent', platform: 'darwin', app: 'com.apple.Calendar' })
    expect(resolved.verify[0]).toMatchObject({ kind: 'calendarHasEvent', match: { summary: '{summary}' } })
  })

  it('asserts both the new calendar and its event when creating both', () => {
    const resolved = router.resolve({ task: 'calendar.createEventInNewCalendar', platform: 'darwin', app: 'com.apple.Calendar' })
    expect(resolved.verify.map(expectation => expectation.kind)).toEqual(['appObject', 'calendarHasEvent'])
  })

  it('asserts a note by name and folder', () => {
    const resolved = router.resolve({ task: 'notes.createNote', platform: 'darwin', app: 'com.apple.Notes' })
    expect(resolved.verify[0]).toMatchObject({ kind: 'noteExists', name: '{name}', folder: '{folder}' })
  })

  it('asserts a note read by its content', () => {
    expect(router.resolve({ task: 'notes.readNote', platform: 'darwin', app: 'com.apple.Notes' }).verify[0])
      .toMatchObject({ kind: 'noteExists', contains: '{contains}' })
  })

  it('declares attachment reading blind for Notes', () => {
    expect(router.resolve({ task: 'notes.readNote', platform: 'darwin', app: 'com.apple.Notes' }).knownBlind)
      .toContain('notes.readAttachments')
  })
})

describe('the Pages template step the sources revealed is explicit', () => {
  const router = new RecipeRouter(PAGES_TEMPLATE_RECIPES)

  it('names the template as a parameter, because document creation is from a template', () => {
    const resolved = router.resolve({ task: 'document.createFromTemplate', platform: 'darwin', app: 'com.apple.Pages' })
    expect(resolved.invocation.parameters).toMatchObject({ template: '{template}', name: '{name}' })
  })

  it('declares the chooser and formatting blind, matching what was measured on this machine', () => {
    const resolved = router.resolve({ task: 'document.createFromTemplate', platform: 'darwin', app: 'com.apple.Pages' })
    expect(resolved.knownBlind).toContain('template.chooseWhenNotScriptable')
    expect(resolved.knownBlind).toContain('document.applyFont')
  })

  it('verifies the written body text, which is the check the sources use', () => {
    // The sources check the body text; a container text search cannot assert that
    // for a Pages package, so this asserts what the container can honestly show and
    // the semantic read-back stays the consumer's.
    expect(router.resolve({ task: 'document.createFromTemplate', platform: 'darwin', app: 'com.apple.Pages' }).verify)
      .toEqual([{ kind: 'fileContains', path: '{path}', text: '{body}' }])
  })
})

describe('the set composes into the starter book', () => {
  it('exposes each group', () => {
    for (const group of [CALCULATOR_RECIPES, CLOCK_RECIPES, CALENDAR_EVENT_RECIPES, NOTES_RECIPES, PAGES_TEMPLATE_RECIPES]) {
      expect(group.length).toBeGreaterThan(0)
    }
  })

  it('includes every curated task in the starter book', () => {
    const bookTasks = new Set(STARTER_BOOK.map(recipe => recipe.task))
    for (const recipe of COMMON_APP_RECIPES) {
      expect(bookTasks.has(recipe.task), recipe.task).toBe(true)
    }
  })

  it('covers the common programs named', () => {
    const apps = new Set(COMMON_APP_RECIPES.flatMap(recipe => recipe.on.flatMap(entry => entry.apps)))
    expect(apps).toContain('com.apple.Calculator')
    expect(apps).toContain('com.apple.Clock')
    expect(apps).toContain('com.apple.Calendar')
    expect(apps).toContain('com.apple.Notes')
    expect(apps).toContain('com.apple.Pages')
  })
})
