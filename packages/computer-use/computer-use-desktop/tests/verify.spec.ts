/**
 * The shared verifier reads observables from the operating system rather than
 * trusting whatever an action reported. Filesystem checks are the strongest and
 * most portable evidence available, and every one of them must fail honestly:
 * an unreadable file is unsatisfied, and a check that could not run is never a
 * pass.
 */

import { mkdtemp, writeFile, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { checkExpectations, verifyWithDefaults, type VerificationReaders } from '../src/verify.ts'

// Module scope rather than inside one `describe`: both suites below drive the same
// verifier, and the semantic suite needs the same inert readers the filesystem suite
// uses so it isolates the application-object behaviour instead of re-stubbing them.
const readers: VerificationReaders = {
  nodeValue: { read: vi.fn<(token: string) => Promise<string | undefined>>(() => Promise.resolve(undefined)) },
  windowTitles: { list: vi.fn<() => Promise<readonly string[]>>(() => Promise.resolve([])) },
}

describe('verification reads the real filesystem', () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'aeven-cu-'))
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('proves a file exists', async () => {
    const path = join(dir, 'exists.txt')
    await writeFile(path, 'content')
    const [outcome] = await checkExpectations([{ kind: 'fileExists', path }], readers)
    expect(outcome?.satisfied).toBe(true)
  })

  it('reports a missing file as unsatisfied rather than throwing', async () => {
    const [outcome] = await checkExpectations([{ kind: 'fileExists', path: join(dir, 'nope.txt') }], readers)
    expect(outcome?.satisfied).toBe(false)
    expect(outcome?.observed).toBe('absent')
  })

  it('matches file content exactly, which is the check that catches a silent write failure', async () => {
    const path = join(dir, 'exact.txt')
    await writeFile(path, 'the story')
    const [match] = await checkExpectations([{ kind: 'fileEquals', path, text: 'the story' }], readers)
    expect(match?.satisfied).toBe(true)
    const [mismatch] = await checkExpectations([{ kind: 'fileEquals', path, text: 'something else' }], readers)
    expect(mismatch?.satisfied).toBe(false)
  })

  it('reports an unreadable target for content checks instead of claiming success', async () => {
    const [contains] = await checkExpectations([{ kind: 'fileContains', path: join(dir, 'missing'), text: 'x' }], readers)
    expect(contains?.satisfied).toBe(false)
    expect(contains?.observed).toBe('unreadable')
    const [equals] = await checkExpectations([{ kind: 'fileEquals', path: join(dir, 'missing'), text: 'x' }], readers)
    expect(equals?.satisfied).toBe(false)
  })

  it('finds a substring when present', async () => {
    const path = join(dir, 'contains.txt')
    await writeFile(path, 'prefix needle suffix')
    const [outcome] = await checkExpectations([{ kind: 'fileContains', path, text: 'needle' }], readers)
    expect(outcome?.satisfied).toBe(true)
  })

  it('compares modification time against a supplied instant', async () => {
    const path = join(dir, 'stamped.txt')
    await writeFile(path, 'x')
    const old = new Date(Date.now() - 60_000)
    await utimes(path, old, old)
    const [afterOld] = await checkExpectations([{ kind: 'fileNewerThan', path, sinceMs: old.getTime() - 1 }], readers)
    expect(afterOld?.satisfied).toBe(true)
    const [beforeNew] = await checkExpectations([{ kind: 'fileNewerThan', path, sinceMs: Date.now() + 60_000 }], readers)
    expect(beforeNew?.satisfied).toBe(false)
  })

  it('reports a missing file for a modification-time check as unsatisfied', async () => {
    const [outcome] = await checkExpectations([{ kind: 'fileNewerThan', path: join(dir, 'gone'), sinceMs: 0 }], readers)
    expect(outcome?.satisfied).toBe(false)
    expect(outcome?.observed).toBe('absent')
  })

  it('reports a missing node as unsatisfied rather than assuming it passed', async () => {
    const [outcome] = await checkExpectations([{ kind: 'nodeValueEquals', token: 's1:0', value: 'x' }], readers)
    expect(outcome?.satisfied).toBe(false)
    expect(outcome?.observed).toBe('node not found')
  })

  it('compares an element value through the reader', async () => {
    const reading = { ...readers, nodeValue: { read: () => Promise.resolve('typed text') } }
    const [match] = await checkExpectations([{ kind: 'nodeValueEquals', token: 's1:0', value: 'typed text' }], reading)
    expect(match?.satisfied).toBe(true)
    const [mismatch] = await checkExpectations([{ kind: 'nodeValueEquals', token: 's1:0', value: 'other' }], reading)
    expect(mismatch?.satisfied).toBe(false)
    expect(mismatch?.observed).toContain('typed text')
  })

  it('matches a window title through the reader', async () => {
    const titled = { ...readers, windowTitles: { list: () => Promise.resolve(['Untitled', 'Agent Story.pages']) } }
    const [match] = await checkExpectations([{ kind: 'windowTitled', title: 'Agent Story' }], titled)
    expect(match?.satisfied).toBe(true)
    const [mismatch] = await checkExpectations([{ kind: 'windowTitled', title: 'Missing' }], titled)
    expect(mismatch?.satisfied).toBe(false)
    expect(mismatch?.observed).toContain('not among 2 windows')
  })

  it('treats no window titles as no match rather than as an error', async () => {
    const [outcome] = await checkExpectations([{ kind: 'windowTitled', title: 'Anything' }], { ...readers, windowTitles: { list: () => Promise.resolve([]) } })
    expect(outcome?.satisfied).toBe(false)
    expect(outcome?.observed).toContain('not among 0 windows')
  })

  it('reports a check that threw as unsatisfied with the error, never as a pass', async () => {
    const failing = { ...readers, nodeValue: { read: () => Promise.reject(new Error('reader exploded')) } }
    const [outcome] = await checkExpectations([{ kind: 'nodeValueEquals', token: 's1:0', value: 'x' }], failing)
    expect(outcome?.satisfied).toBe(false)
    expect(outcome?.error).toBe('reader exploded')
  })

  it('handles a non-Error rejection without losing the failure', async () => {
    // Annotated as VerificationReaders so the rejected value's type is known here.
    // The string is the point of the test: a rejection reason need not be an Error,
    // and the failure it carries must survive into `outcome.error`. Rejecting with an
    // Error here would test the case that already works and leave this one uncovered.
    const failing: VerificationReaders = { ...readers, nodeValue: { read: () => Promise.reject('plain string failure') } }
    const [outcome] = await checkExpectations([{ kind: 'nodeValueEquals', token: 's1:0', value: 'x' }], failing)
    expect(outcome?.satisfied).toBe(false)
    expect(outcome?.error).toBe('plain string failure')
  })

  it('returns one outcome per expectation, in order', async () => {
    const path = join(dir, 'ordered.txt')
    await writeFile(path, 'yes')
    const outcomes = await checkExpectations(
      [
        { kind: 'fileExists', path },
        { kind: 'fileExists', path: join(dir, 'absent') },
        { kind: 'fileContains', path, text: 'yes' },
      ],
      readers,
    )
    expect(outcomes.map(outcome => outcome.satisfied)).toEqual([true, false, true])
  })
})

/** The reader's signature, named so the inline type does not run past the line limit. */
type AppObjectFind = (
  app: string,
  collection: string,
  match: Readonly<Record<string, string>>,
) => Promise<AppObjectAnswer>

/** What an application-object read reports back. */
interface AppObjectAnswer {
  matched: boolean
  observed: string
}

describe('the semantic kinds answer through an application-object reader', () => {
  /** Records what was asked, so the query the verifier builds is itself observable. */
  const appObjects = {
    find: vi.fn<AppObjectFind>(() => Promise.resolve({ matched: true, observed: 'one match' })),
  }

  it('answers appObject from the reader and passes the match through', async () => {
    appObjects.find.mockClear()
    const [outcome] = await checkExpectations(
      [{ kind: 'appObject', app: 'com.apple.Calendar', collection: 'events', match: { summary: 'Standup' } }],
      { ...readers, appObjects },
    )
    expect(outcome?.satisfied).toBe(true)
    expect(outcome?.observed).toBe('one match')
    expect(appObjects.find).toHaveBeenCalledWith('com.apple.Calendar', 'events', { summary: 'Standup' })
  })

  it('turns a calendar count into an at-least match rather than dropping it', async () => {
    // `count` is a lower bound, not an exact number: the recipe asks that the event
    // was created, and a second one already in the calendar must not fail the check.
    appObjects.find.mockClear()
    await checkExpectations(
      [{ kind: 'calendarHasEvent', calendar: 'Work', count: 1, match: { summary: 'Standup' } }],
      { ...readers, appObjects },
    )
    expect(appObjects.find).toHaveBeenCalledWith('Calendar', 'Work', { summary: 'Standup', atLeast: '1' })
  })

  it('falls back to the generic calendar when the recipe names none', async () => {
    appObjects.find.mockClear()
    await checkExpectations([{ kind: 'calendarHasEvent' }], { ...readers, appObjects })
    expect(appObjects.find).toHaveBeenCalledWith('Calendar', 'calendar', {})
  })

  it('builds a note query from only the fields the recipe supplied', async () => {
    // An omitted folder means "any folder", so adding an empty one would narrow the
    // check to a folder that does not exist and report a false miss.
    appObjects.find.mockClear()
    await checkExpectations([{ kind: 'noteExists', name: 'Groceries' }], { ...readers, appObjects })
    expect(appObjects.find).toHaveBeenLastCalledWith('Notes', 'notes', { name: 'Groceries' })

    appObjects.find.mockClear()
    await checkExpectations(
      [{ kind: 'noteExists', name: 'Groceries', folder: 'Home', contains: 'milk' }],
      { ...readers, appObjects },
    )
    expect(appObjects.find).toHaveBeenLastCalledWith('Notes', 'notes', { name: 'Groceries', folder: 'Home', contains: 'milk' })
  })

  it('reports every semantic kind unsatisfied when no reader is configured', async () => {
    // The honest answer when nothing can read the application's objects. Reporting
    // satisfied here would be the exact failure this package exists to prevent: a
    // check that cannot fail.
    const outcomes = await checkExpectations(
      [
        { kind: 'appObject', app: 'com.apple.Calendar', collection: 'events', match: {} },
        { kind: 'calendarHasEvent' },
        { kind: 'noteExists', name: 'Groceries' },
      ],
      readers,
    )
    expect(outcomes.map(outcome => outcome.satisfied)).toEqual([false, false, false])
    expect(outcomes.map(outcome => outcome.observed)).toEqual([
      'no application-object reader is configured',
      'no application-object reader is configured',
      'no application-object reader is configured',
    ])
  })
})

describe('an adapter verifies through its own readers or the shared defaults', () => {
  it('answers every kind pessimistically when the adapter supplies no readers', async () => {
    // The defaults exist so a check that cannot be answered reports unsatisfied rather
    // than passing: an unreadable node value is `undefined`, an application-object
    // question has no reader, and only the windows the platform enumerates are listed.
    const outcomes = await verifyWithDefaults(
      [
        { kind: 'nodeValueEquals', token: 's1:0', value: 'typed text' },
        { kind: 'windowTitled', title: 'Untitled' },
        { kind: 'appObject', app: 'com.apple.Calendar', collection: 'events', match: { summary: 'Standup' } },
      ],
      undefined,
      () => Promise.resolve([{ title: 'Untitled' }, {}]),
    )
    expect(outcomes.map(outcome => outcome.satisfied)).toEqual([false, true, false])
    expect(outcomes[0]?.observed).toBe('node not found')
    expect(outcomes[1]?.observed).toBe('matched among 2 windows')
    expect(outcomes[2]?.observed).toBe('no application-object reader is configured')
  })

  it('prefers the readers the adapter supplies and then needs no window enumeration', async () => {
    const listWindows = vi.fn(() => Promise.resolve([{ title: 'Ignored' }]))
    const outcomes = await verifyWithDefaults(
      [
        { kind: 'nodeValueEquals', token: 's1:0', value: 'typed text' },
        { kind: 'windowTitled', title: 'Agent Story' },
        { kind: 'appObject', app: 'com.apple.Calendar', collection: 'events', match: { summary: 'Standup' } },
      ],
      {
        nodeValue: { read: () => Promise.resolve('typed text') },
        windowTitles: { list: () => Promise.resolve(['Agent Story.pages']) },
        appObjects: { find: () => Promise.resolve({ matched: true, observed: 'one match' }) },
      },
      listWindows,
    )
    expect(outcomes.map(outcome => outcome.satisfied)).toEqual([true, true, true])
    expect(outcomes[2]?.observed).toBe('one match')
    expect(listWindows).not.toHaveBeenCalled()
  })
})
