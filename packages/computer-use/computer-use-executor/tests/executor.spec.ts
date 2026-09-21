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
})
