/**
 * The executor: a task runs through its resolved mechanism, and the verdict comes
 * from re-reading observables rather than from the handler's own report.
 *
 * The filesystem tasks are run against the real filesystem — no mock — because
 * they are the platform-independent ones and a mock would prove nothing about
 * whether a write actually landed.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ComputerUseError, type Expectation } from '@aeven/computer-use-desktop'
import type { RecipeBook } from '@aeven/computer-use-router'
import { TaskExecutor, filesystemHandler, substitute, resolveExpectations } from '../src/index.ts'
import type { MechanismRequest } from '../src/mechanism.ts'

/** A recipe whose mechanism this package implements, so the whole path is real. */
const WRITE_BOOK: RecipeBook = [
  {
    task: 'file.writeText',
    summary: 'Write text to a file.',
    on: [
      {
        platform: 'darwin',
        rung: 'semantic',
        apps: [],
        evidence: 'verified',
        invocation: { mechanism: 'filesystem', operation: 'writeFile', parameters: { path: '', text: '' } },
      },
    ],
    verify: [{ kind: 'fileEquals', path: '{path}', text: '{text}' }],
  },
  {
    task: 'file.readText',
    summary: 'Read a file.',
    on: [
      {
        platform: 'darwin',
        rung: 'semantic',
        apps: [],
        evidence: 'verified',
        invocation: { mechanism: 'filesystem', operation: 'readFile', parameters: { path: '' } },
      },
    ],
    verify: [{ kind: 'fileExists', path: '{path}' }],
  },
]

describe('placeholder substitution', () => {
  it('fills a placeholder from the values', () => {
    expect(substitute('/tmp/{name}.pages', { name: 'story' })).toBe('/tmp/story.pages')
  })

  it('fills every occurrence, not just the first', () => {
    expect(substitute('{a}/{a}', { a: 'x' })).toBe('x/x')
  })

  it('refuses an unfilled placeholder rather than checking an empty string', () => {
    try {
      substitute('/tmp/{missing}', {})
      throw new Error('expected a throw')
    } catch (error) {
      expect((error as ComputerUseError).code).toBe('invalid-target')
      expect((error as ComputerUseError).message).toContain('{missing}')
      expect((error as ComputerUseError).detail).toMatchObject({ placeholder: 'missing' })
    }
  })

  it('leaves a string with no placeholders untouched', () => {
    expect(substitute('/tmp/plain', {})).toBe('/tmp/plain')
  })

  it('resolves every expectation kind, rewriting only the text fields', () => {
    const expectations: Expectation[] = [
      { kind: 'fileExists', path: '{p}' },
      { kind: 'fileContains', path: '{p}', text: '{t}' },
      { kind: 'fileEquals', path: '{p}', text: '{t}' },
      { kind: 'fileNewerThan', path: '{p}', sinceMs: 7 },
      { kind: 'nodeValueEquals', token: '{p}', value: '{t}' },
      { kind: 'windowTitled', title: '{t}' },
    ]
    const resolved = resolveExpectations(expectations, { p: '/tmp/a', t: 'needle' })
    expect(resolved[0]).toEqual({ kind: 'fileExists', path: '/tmp/a' })
    expect(resolved[1]).toEqual({ kind: 'fileContains', path: '/tmp/a', text: 'needle' })
    expect(resolved[3]).toEqual({ kind: 'fileNewerThan', path: '/tmp/a', sinceMs: 7 })
    expect(resolved[5]).toEqual({ kind: 'windowTitled', title: 'needle' })
  })

  it('refuses a batch with an unfilled placeholder rather than resolving what it can', () => {
    expect(() => resolveExpectations([{ kind: 'fileExists', path: '{p}' }], {})).toThrow(/has no value/)
  })

  it('resolves the optional semantic fields only when the recipe names them', () => {
    // Both arms matter. Naming `folder`/`contains`/`match` must substitute them, and
    // omitting them must leave them omitted: filling an absent field with an empty
    // string would silently narrow the check to "the folder named nothing", which is
    // the opposite of what an omitted field asks for.
    const named = resolveExpectations([
      { kind: 'noteExists', name: '{s}', folder: '{f}', contains: '{c}' },
      { kind: 'calendarHasEvent', calendar: '{f}', match: { summary: '{s}' } },
    ], { s: 'Standup', f: 'Work', c: 'agenda' })
    expect(named[0]).toEqual({ kind: 'noteExists', name: 'Standup', folder: 'Work', contains: 'agenda' })
    expect(named[1]).toEqual({ kind: 'calendarHasEvent', calendar: 'Work', match: { summary: 'Standup' } })

    const omitted = resolveExpectations([{ kind: 'noteExists', name: '{s}' }], { s: 'Standup' })
    expect(omitted[0]).toEqual({ kind: 'noteExists', name: 'Standup' })
    expect(omitted[0]).not.toHaveProperty('contains')
  })

  it('resolves the semantic kinds, whose values are caller arguments too', () => {
    // These three are what a PIM recipe actually declares — `calendar.createEvent`
    // verifies with `calendarHasEvent` — and each carries caller values, so leaving
    // them unresolved would hand the verifier a placeholder to match against. The
    // resolver threw on all three before this test existed.
    const resolved = resolveExpectations([
      { kind: 'appObject', app: 'com.apple.Calendar', collection: 'events', match: { summary: '{s}' } },
      { kind: 'calendarHasEvent', calendar: '{c}', count: 1, match: { summary: '{s}' } },
      { kind: 'noteExists', name: '{s}', folder: '{c}', contains: '{t}' },
    ], { s: 'Standup', c: 'Work', t: 'agenda' })
    expect(resolved[0]).toEqual({
      kind: 'appObject',
      app: 'com.apple.Calendar',
      collection: 'events',
      match: { summary: 'Standup' },
    })
    expect(resolved[1]).toEqual({
      kind: 'calendarHasEvent',
      calendar: 'Work',
      count: 1,
      match: { summary: 'Standup' },
    })
    expect(resolved[2]).toEqual({ kind: 'noteExists', name: 'Standup', folder: 'Work', contains: 'agenda' })
  })

  it('applies the unfilled-placeholder rule inside a match record, not just to top-level strings', () => {
    // A match record is a set of fields to compare, so a field left as `{s}` would
    // be compared literally and match nothing — or worse, be loosened to a wildcard.
    // Either way it stops being a check, so it has to fail here like any other.
    const expectations: Expectation[] = [
      { kind: 'calendarHasEvent', match: { summary: '{s}' } },
    ]
    expect(() => resolveExpectations(expectations, {})).toThrow(/has no value/)
  })

  it('leaves an absent optional field absent rather than inventing a value', () => {
    // `calendarHasEvent` matches on any calendar when none is named. Filling that in
    // with an empty string would silently narrow the check to the empty-named
    // calendar, which is the opposite of what an omitted field asks for.
    const resolved = resolveExpectations([{ kind: 'calendarHasEvent', count: 2 }], {})
    expect(resolved[0]).toEqual({ kind: 'calendarHasEvent', count: 2 })
    expect(resolved[0]).not.toHaveProperty('match')
  })
})

describe('the filesystem mechanism is real, not mocked', () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'aeven-exec-'))
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const handler = (request: MechanismRequest) => filesystemHandler(request)

  it('writes a file and reports how much it wrote', async () => {
    const path = join(dir, 'written.txt')
    const result = await handler({ invocation: { mechanism: 'filesystem', operation: 'writeFile' }, parameters: { path, text: 'hello' } })
    expect(result.observed).toBe('wrote 5 characters')
    await expect(readFile(path, 'utf8')).resolves.toBe('hello')
  })

  it('reads a file and reports its length', async () => {
    const path = join(dir, 'read.txt')
    await writeFile(path, 'abcd')
    const result = await handler({ invocation: { mechanism: 'filesystem', operation: 'readFile' }, parameters: { path } })
    expect(result.observed).toBe('read 4 characters')
  })

  it('stats a file', async () => {
    const path = join(dir, 'stat.txt')
    await writeFile(path, 'x')
    const result = await handler({ invocation: { mechanism: 'filesystem', operation: 'stat' }, parameters: { path } })
    expect(result.observed).toBe('present')
  })

  it('reports a missing path as absent rather than failing the run', async () => {
    // The `fileExists` verifier reads absence as `satisfied: false`, so the
    // action has to hand it that observation instead of rejecting first —
    // otherwise `file.exists` cannot answer the question its own summary asks.
    const result = await handler({
      invocation: { mechanism: 'filesystem', operation: 'stat' },
      parameters: { path: join(dir, 'never-written.txt') },
    })
    expect(result.observed).toBe('absent')
  })

  it('still propagates a stat failure that is not absence', async () => {
    // A path beneath a regular file cannot be resolved (ENOTDIR), which is a
    // real failure rather than an answer about whether something exists.
    const filePath = join(dir, 'a-file.txt')
    await writeFile(filePath, 'x')
    await expect(handler({
      invocation: { mechanism: 'filesystem', operation: 'stat' },
      parameters: { path: join(filePath, 'child') },
    })).rejects.toMatchObject({ code: 'ENOTDIR' })
  })

  it('refuses a missing path rather than acting on one', async () => {
    await expect(handler({ invocation: { mechanism: 'filesystem', operation: 'readFile' }, parameters: {} }))
      .rejects.toMatchObject({ code: 'invalid-target' })
  })

  it('refuses a write with no text, since an empty write would look like success', async () => {
    await expect(handler({ invocation: { mechanism: 'filesystem', operation: 'writeFile' }, parameters: { path: join(dir, 'x') } }))
      .rejects.toThrow(/requires a text parameter/)
  })

  it('refuses an operation it does not implement, naming it', async () => {
    await expect(handler({ invocation: { mechanism: 'filesystem', operation: 'chmod' }, parameters: { path: '/tmp' } }))
      .rejects.toThrow(/does not implement "chmod"/)
  })
})

describe('execution verifies independently of what the handler reported', () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'aeven-exec2-'))
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('answers that a missing path does not exist rather than rejecting', async () => {
    // The recipe's own summary is "Report whether a path exists", so absence is
    // an answer. The run reaches verification and returns unverified; letting
    // ENOENT escape the action rejected it before the check ever ran.
    const executor = new TaskExecutor({
      book: [{
        task: 'file.exists',
        summary: 'Report whether a path exists.',
        deliverable: 'open-application',
        on: [{
          platform: 'darwin',
          rung: 'semantic',
          apps: [],
          evidence: 'verified',
          invocation: { mechanism: 'filesystem', operation: 'stat' },
        }],
        verify: [{ kind: 'fileExists', path: '{path}' }],
      }],
    })
    const outcome = await executor.execute({
      task: 'file.exists',
      platform: 'darwin',
      parameters: { path: join(dir, 'absent.txt') },
    })
    expect(outcome.verified).toBe(false)
    expect(outcome.observed).toBe('absent')
  })

  it('writes a file and confirms it from disk', async () => {
    const path = join(dir, 'ok.txt')
    const executor = new TaskExecutor({ book: WRITE_BOOK })
    const outcome = await executor.execute({
      task: 'file.writeText',
      platform: 'darwin',
      parameters: { path, text: 'the story' },
    })
    expect(outcome.verified).toBe(true)
    expect(outcome.mechanism).toBe('filesystem')
    expect(outcome.rung).toBe('semantic')
    await expect(readFile(path, 'utf8')).resolves.toBe('the story')
  })

  it('reports a task as unverified when the observable disagrees with what the handler claimed', async () => {
    const path = join(dir, 'liar.txt')
    // The handler reports success while writing something else: exactly the shape
    // of the measured failure where an action acknowledged delivery and the file
    // never changed.
    const executor = new TaskExecutor({
      book: WRITE_BOOK,
      handlers: {
        filesystem: async ({ parameters }) => {
          await writeFile(parameters.path as string, 'something else')
          return { observed: 'wrote 9 characters' }
        },
      },
    })
    const outcome = await executor.execute({
      task: 'file.writeText',
      platform: 'darwin',
      parameters: { path, text: 'the story' },
    })
    expect(outcome.verified).toBe(false)
    expect(outcome.observed).toBe('wrote 9 characters')
    expect(outcome.outcomes[0]?.satisfied).toBe(false)
  })

  it('throws rather than returning when a caller requires verification', async () => {
    const path = join(dir, 'throw.txt')
    const executor = new TaskExecutor({
      book: WRITE_BOOK,
      handlers: { filesystem: async () => ({ observed: 'claimed success' }) },
    })
    await expect(
      executor.executeOrThrow({ task: 'file.writeText', platform: 'darwin', parameters: { path, text: 'x' } }),
    ).rejects.toMatchObject({ code: 'unverified' })
  })

  it('marks a skipped verification as unverified, because not checking is not passing', async () => {
    const path = join(dir, 'skipped.txt')
    const executor = new TaskExecutor({
      book: WRITE_BOOK,
      handlers: { filesystem: async () => ({}) },
    })
    const outcome = await executor.execute({
      task: 'file.writeText',
      platform: 'darwin',
      parameters: { path, text: 'x' },
      verify: false,
    })
    expect(outcome.verified).toBe(false)
    expect(outcome.outcomes).toEqual([])
    expect(outcome.notes.join(' ')).toContain('verification was skipped')
  })

  it('refuses a mechanism with no handler, naming what is available', async () => {
    const executor = new TaskExecutor({ book: WRITE_BOOK })
    await expect(
      executor.execute({ task: 'file.writeText', platform: 'darwin', parameters: { path: '/tmp/x', text: 'y' } })
        .then(async () => undefined),
    ).resolves.toBeUndefined()
    const noFs = new TaskExecutor({ book: WRITE_BOOK, handlers: {} })
    // Built-ins always exist, so simulate a mechanism this package does not own.
    const bookWithCom: RecipeBook = [{
      task: 'doc.write',
      summary: 'Write.',
      on: [{ platform: 'win32', rung: 'semantic', apps: ['Word.Application'], evidence: 'documented', invocation: { mechanism: 'com', operation: 'InsertAfter' } }],
      verify: [{ kind: 'fileExists', path: '/tmp/x' }],
    }]
    await expect(new TaskExecutor({ book: bookWithCom }).execute({ task: 'doc.write', platform: 'win32' }))
      .rejects.toThrow(/no handler performs the "com" mechanism/)
    expect(noFs.routing.tasks()).toContain('file.writeText')
  })

  it('passes the resolution refusals through unchanged', async () => {
    const executor = new TaskExecutor({ book: WRITE_BOOK })
    await expect(executor.execute({ task: 'nope', platform: 'darwin' })).rejects.toMatchObject({ code: 'unknown-node' })
    await expect(executor.execute({ task: 'file.readText', platform: 'linux' })).rejects.toMatchObject({ code: 'capability-unavailable' })
  })

  it('lets the caller override a recipe parameter default', async () => {
    const path = join(dir, 'override.txt')
    const executor = new TaskExecutor({ book: WRITE_BOOK })
    await executor.execute({ task: 'file.writeText', platform: 'darwin', parameters: { path, text: 'overridden' } })
    await expect(readFile(path, 'utf8')).resolves.toBe('overridden')
  })

  it('gives one outcome per expectation, in recipe order', async () => {
    const path = join(dir, 'multi.txt')
    const book: RecipeBook = [{
      task: 'file.writeText',
      summary: 'Write.',
      on: [{ platform: 'darwin', rung: 'semantic', apps: [], evidence: 'verified', invocation: { mechanism: 'filesystem', operation: 'writeFile' } }],
      verify: [
        { kind: 'fileExists', path: '{path}' },
        { kind: 'fileContains', path: '{path}', text: '{text}' },
        { kind: 'fileContains', path: '{path}', text: 'absent-needle' },
      ],
    }]
    const outcome = await new TaskExecutor({ book }).execute({
      task: 'file.writeText',
      platform: 'darwin',
      parameters: { path, text: 'needle' },
    })
    expect(outcome.outcomes.map(entry => entry.satisfied)).toEqual([true, true, false])
    expect(outcome.verified).toBe(false)
  })

  it('uses a supplied adapter for verification when one is configured', async () => {
    // The handler must genuinely succeed, or verification never runs and the test
    // would pass for the wrong reason.
    const path = join(dir, 'adapter-verified.txt')
    await writeFile(path, 'x')
    const verify = vi.fn(() => Promise.resolve([{ expectation: { kind: 'fileExists' as const, path }, satisfied: true }]))
    const executor = new TaskExecutor({
      book: WRITE_BOOK,
      adapter: {
        platform: 'darwin',
        observe: () => Promise.reject(new Error('unused')),
        act: () => Promise.reject(new Error('unused')),
        verify,
        readiness: () => Promise.reject(new Error('unused')),
      },
    })
    const outcome = await executor.execute({ task: 'file.readText', platform: 'darwin', parameters: { path } })
    expect(verify).toHaveBeenCalledOnce()
    expect(outcome.verified).toBe(true)
  })

  it('checks without an adapter through built-in readers that can only report nothing', async () => {
    // With no adapter there is no accessibility tree and no window list to consult,
    // so those readers resolve to "nothing observed". That still has to be a real
    // check: a filesystem expectation must pass or fail on its own merits, and an
    // unanswerable one must report unsatisfied rather than quietly passing.
    const path = join(dir, 'no-adapter.txt')
    await writeFile(path, 'needle')
    const executor = new TaskExecutor({ book: WRITE_BOOK })
    const outcome = await executor.execute({ task: 'file.readText', platform: 'darwin', parameters: { path } })
    expect(outcome.verified).toBe(true)
    expect(outcome.outcomes.map(entry => entry.satisfied)).toEqual([true])
  })

  it('reports a window expectation as unsatisfied without an adapter, rather than passing it', async () => {
    // The built-in window reader can only answer "no windows", because with no
    // adapter there is no desktop to ask. A window expectation is therefore
    // unanswerable here, and unanswerable must read as unsatisfied: passing it would
    // be the verification-that-cannot-fail this stack exists to avoid.
    const path = join(dir, 'window-check.txt')
    await writeFile(path, 'needle')
    const book: RecipeBook = [
      {
        task: 'file.checkWindow',
        summary: 'Read a file and expect a window to exist.',
        on: [{
          platform: 'darwin',
          rung: 'semantic',
          apps: [],
          evidence: 'verified',
          invocation: { mechanism: 'filesystem', operation: 'readFile', parameters: { path: '' } },
        }],
        verify: [
          { kind: 'windowTitled', title: 'Anything' },
          { kind: 'nodeValueEquals', token: 's1:0', value: 'anything' },
        ],
      },
    ]
    const executor = new TaskExecutor({ book })
    const outcome = await executor.execute({ task: 'file.checkWindow', platform: 'darwin', parameters: { path } })
    expect(outcome.verified).toBe(false)
    expect(outcome.outcomes.map(entry => entry.satisfied)).toEqual([false, false])
    expect(outcome.outcomes[0]?.observed).toMatch(/not among 0 windows/)
    // With no adapter there is no tree either, so the node reader answers `undefined`,
    // which reads as "node not found" and fails rather than matching a missing value.
    expect(outcome.outcomes[1]?.observed).toMatch(/node not found/)
  })

  it('passes an application and an available-rung list through to resolution', async () => {
    // Both are optional, and both change what the router may pick. Spreading them
    // conditionally is what keeps an omitted value omitted *by absence* rather than
    // present-and-undefined, which the router treats differently when it decides
    // whether a host can run a rung at all.
    const path = join(dir, 'app-scoped.txt')
    await writeFile(path, 'needle')
    const book: RecipeBook = [
      {
        task: 'file.readText',
        summary: 'Read a file.',
        on: [
          {
            platform: 'darwin',
            rung: 'semantic',
            apps: ['com.apple.Notes'],
            evidence: 'verified',
            invocation: { mechanism: 'filesystem', operation: 'readFile', parameters: { path: '' } },
          },
        ],
        verify: [{ kind: 'fileContains', path: '{path}', text: 'needle' }],
      },
    ]
    const executor = new TaskExecutor({ book })
    const outcome = await executor.execute({
      task: 'file.readText',
      platform: 'darwin',
      app: 'com.apple.Notes',
      availableRungs: ['semantic'],
      parameters: { path },
    })
    expect(outcome.verified).toBe(true)

    // The same task with the rung withheld must refuse instead of running anyway.
    await expect(executor.execute({
      task: 'file.readText',
      platform: 'darwin',
      app: 'com.apple.Notes',
      availableRungs: ['vision'],
      parameters: { path },
    })).rejects.toThrow()
  })
})
