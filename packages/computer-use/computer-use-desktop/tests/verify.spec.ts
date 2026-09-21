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
import { checkExpectations } from '../src/verify.ts'

describe('verification reads the real filesystem', () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'aeven-cu-'))
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const readers = {
    nodeValue: { read: vi.fn<(token: string) => Promise<string | undefined>>(() => Promise.resolve(undefined)) },
    windowTitles: { list: vi.fn<() => Promise<readonly string[]>>(() => Promise.resolve([])) },
  }

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
    const failing = { ...readers, nodeValue: { read: () => Promise.reject('plain string failure') } }
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
