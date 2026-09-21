/**
 * Router resolution: rung preference, refusal instead of a silent degrade, and
 * the blind spots a recipe declares so a caller never discovers them by failing.
 */

import { describe, expect, it } from 'vitest'
import { ComputerUseError } from '@aeven/computer-use-desktop'
import { STARTER_BOOK } from '../src/book.ts'
import type { RecipeBook } from '../src/recipe.ts'
import { RecipeRouter } from '../src/router.ts'

const BOOK: RecipeBook = [
  {
    task: 'doc.write',
    summary: 'Write text.',
    on: [
      {
        platform: 'darwin',
        rung: 'semantic',
        apps: ['com.apple.Pages'],
        evidence: 'verified',
        knownBlind: ['doc.setFont'],
        invocation: { mechanism: 'apple-events', operation: 'bodyText = text' },
      },
      {
        platform: 'darwin',
        rung: 'accessibility',
        apps: ['com.apple.Pages'],
        evidence: 'documented',
        invocation: { mechanism: 'ax', operation: 'AXSetValue' },
      },
      {
        platform: 'win32',
        rung: 'semantic',
        apps: ['Word.Application'],
        evidence: 'documented',
        invocation: { mechanism: 'com', operation: 'Content.InsertAfter' },
      },
    ],
    verify: [{ kind: 'fileExists', path: '/tmp/out' }],
  },
  {
    task: 'doc.setFont',
    summary: 'Set a font.',
    on: [
      {
        platform: 'darwin',
        rung: 'accessibility',
        apps: ['com.apple.Pages'],
        evidence: 'documented',
        invocation: { mechanism: 'ax', operation: 'font control' },
      },
      {
        platform: 'darwin',
        rung: 'vision',
        apps: ['com.apple.Pages'],
        evidence: 'documented',
        invocation: { mechanism: 'pixels', operation: 'click the font menu' },
      },
    ],
    verify: [{ kind: 'windowTitled', title: 'Pages' }],
  },
]

describe('rung preference', () => {
  const router = new RecipeRouter(BOOK)

  it('picks the highest rung a task declares', () => {
    expect(router.resolve({ task: 'doc.write', platform: 'darwin' }).rung).toBe('semantic')
  })

  it('does not silently degrade to vision when a better rung exists', () => {
    const resolved = router.resolve({ task: 'doc.setFont', platform: 'darwin' })
    expect(resolved.rung).toBe('accessibility')
    expect(resolved.invocation.mechanism).toBe('ax')
  })

  it('falls down the ladder only when the host says the better rung is unavailable', () => {
    const resolved = router.resolve({ task: 'doc.setFont', platform: 'darwin', availableRungs: ['vision'] })
    expect(resolved.rung).toBe('vision')
    expect(resolved.invocation.mechanism).toBe('pixels')
  })

  it('refuses when no declared rung is available, rather than picking one anyway', () => {
    try {
      router.resolve({ task: 'doc.write', platform: 'darwin', availableRungs: ['vision'] })
      throw new Error('expected a throw')
    } catch (error) {
      expect((error as ComputerUseError).code).toBe('capability-unavailable')
      expect((error as ComputerUseError).detail).toMatchObject({ availableRungs: ['vision'] })
    }
  })

  it('carries the recipe verification expectations through resolution', () => {
    const resolved = router.resolve({ task: 'doc.write', platform: 'darwin' })
    expect(resolved.verify).toEqual([{ kind: 'fileExists', path: '/tmp/out' }])
  })

  it('carries the declared blind spots, so a caller never learns them by failing', () => {
    expect(router.resolve({ task: 'doc.write', platform: 'darwin' }).knownBlind).toEqual(['doc.setFont'])
    expect(router.resolve({ task: 'doc.setFont', platform: 'darwin' }).knownBlind).toEqual([])
  })

  it('reports the evidence level so documented entries are not presented as verified', () => {
    expect(router.resolve({ task: 'doc.write', platform: 'darwin' }).evidence).toBe('verified')
    expect(router.resolve({ task: 'doc.write', platform: 'win32' }).evidence).toBe('documented')
  })
})

describe('refusals name what was searched', () => {
  const router = new RecipeRouter(BOOK)

  it('lists the known tasks when a task is not in the book', () => {
    try {
      router.resolve({ task: 'nothing.here', platform: 'darwin' })
      throw new Error('expected a throw')
    } catch (error) {
      expect((error as ComputerUseError).code).toBe('unknown-node')
      expect((error as ComputerUseError).detail).toMatchObject({ known: ['doc.write', 'doc.setFont'] })
    }
  })

  it('lists the platforms a task does cover when the requested one has no recipe', () => {
    try {
      router.resolve({ task: 'doc.write', platform: 'linux' })
      throw new Error('expected a throw')
    } catch (error) {
      expect((error as ComputerUseError).detail).toMatchObject({ platforms: ['darwin', 'win32'] })
    }
  })

  it('lists the applications a task covers when the named one is not among them', () => {
    try {
      router.resolve({ task: 'doc.write', platform: 'darwin', app: 'com.apple.Numbers' })
      throw new Error('expected a throw')
    } catch (error) {
      expect((error as ComputerUseError).detail).toMatchObject({ covered: ['com.apple.Pages'] })
      expect((error as ComputerUseError).message).toContain('com.apple.Numbers')
    }
  })

  it('resolves a task with no application when it is not application-specific', () => {
    const resolved = router.resolve({ task: 'doc.write', platform: 'darwin' })
    expect(resolved.app).toBe('com.apple.Pages')
  })

  it('exposes the task list', () => {
    expect(router.tasks()).toEqual(['doc.write', 'doc.setFont'])
  })

  it('reports no blind spots for an unresolvable request rather than throwing', () => {
    expect(router.blindSpots({ task: 'nope', platform: 'darwin' })).toEqual([])
    expect(router.blindSpots({ task: 'doc.write', platform: 'darwin' })).toEqual(['doc.setFont'])
  })
})

describe('the starter book', () => {
  const router = new RecipeRouter(STARTER_BOOK)

  it('covers reading a file identically on all three platforms', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      const resolved = router.resolve({ task: 'file.readText', platform })
      expect(resolved.rung).toBe('semantic')
      expect(resolved.invocation.mechanism).toBe('filesystem')
      expect(resolved.evidence).toBe('verified')
    }
  })

  it('records Pages content as verified and the template chooser as blind', () => {
    const resolved = router.resolve({ task: 'document.createText', platform: 'darwin', app: 'com.apple.Pages' })
    expect(resolved.evidence).toBe('verified')
    expect(resolved.knownBlind).toContain('template.choose')
    expect(resolved.knownBlind).toContain('document.applyFont')
  })

  it('escalates Pages formatting to accessibility rather than attempting it semantically', () => {
    const resolved = router.resolve({ task: 'document.applyFont', platform: 'darwin', app: 'com.apple.Pages' })
    expect(resolved.rung).toBe('accessibility')
  })

  it('records the Mail application-wide unread trap on the mail recipes', () => {
    const resolved = router.resolve({ task: 'mail.readRecent', platform: 'darwin', app: 'com.apple.Mail' })
    expect(resolved.knownBlind).toContain('mail.unreadCountApplicationWide')
  })

  it('keeps Office entries documented rather than presenting them as verified', () => {
    for (const [task, platform, app] of [
      ['spreadsheet.setCell', 'win32', 'Excel.Application'],
      ['document.insertText', 'win32', 'Word.Application'],
      ['slide.setText', 'win32', 'PowerPoint.Application'],
    ] as const) {
      expect(router.resolve({ task, platform, app }).evidence).toBe('documented')
    }
  })

  it('gives every recipe at least one verification expectation, so none ships unverifiable', () => {
    for (const recipe of STARTER_BOOK) {
      expect(recipe.verify.length).toBeGreaterThan(0)
    }
  })

  it('gives every invocation an operation and an evidence tag', () => {
    for (const recipe of STARTER_BOOK) {
      for (const entry of recipe.on) {
        expect(entry.invocation.operation.length).toBeGreaterThan(0)
        expect(['verified', 'documented']).toContain(entry.evidence)
      }
    }
  })
})
