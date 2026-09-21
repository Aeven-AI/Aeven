/**
 * The Apple Events handler, and the end-to-end path it completes.
 *
 * The generated scripts are checked without running them — they must be valid
 * JavaScript and must embed values as literals rather than by interpolation, so a
 * document containing quotes cannot break out of the string it was pasted into.
 *
 * One test runs the **whole stack** against the real filesystem: recipe → router →
 * executor → handler → verify. The handler is a stub there, but the verification
 * is genuine, which is the property under test.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { TaskExecutor } from '@aeven/computer-use-executor'
import { STARTER_BOOK, type RecipeBook } from '@aeven/computer-use-router'
import {
  APPLE_EVENTS_MECHANISM,
  createAppleEventsHandler,
  jsLiteral,
  type AppleEventsRunner,
} from '../src/index.ts'

/** A runner that records scripts and answers with prepared output. */
function runnerAnswering(stdout: string, code: number | null = 0, stderr = '') {
  const scripts: string[] = []
  const runner: AppleEventsRunner = {
    run: (script) => {
      scripts.push(script)
      return Promise.resolve({ code, stdout, stderr })
    },
  }
  return { runner, scripts }
}

const request = (operation: string, parameters: Record<string, string> = {}, app = 'com.apple.Pages') => ({
  invocation: { mechanism: APPLE_EVENTS_MECHANISM, operation },
  parameters,
  app,
})

describe('value embedding', () => {
  it('produces a valid JavaScript literal for arbitrary text', () => {
    expect(jsLiteral('plain')).toBe('"plain"')
    expect(jsLiteral('say "hi"')).toBe('"say \\"hi\\""')
    expect(jsLiteral('line\nbreak')).toBe('"line\\nbreak"')
    expect(jsLiteral('back\\slash')).toBe('"back\\\\slash"')
  })

  it('cannot be broken out of by a document containing quotes and braces', () => {
    const hostile = '"}); throw new Error("pwned"); ({"'
    const literal = jsLiteral(hostile)
    // The literal is one token: evaluating it yields the original string back.
    expect(JSON.parse(literal)).toBe(hostile)
  })
})

describe('the document recipe runs as one Apple Events call', () => {
  it('generates a single script that creates, writes, saves, and reads back', async () => {
    const { runner, scripts } = runnerAnswering('{"ok":true,"characters":1215}')
    const handler = createAppleEventsHandler({ runner })
    const result = await handler(request('Document().make(); bodyText = text; save({ in: path })', {
      path: '/tmp/story.pages',
      text: 'the story',
    }))
    expect(scripts).toHaveLength(1)
    expect(scripts[0]).toContain('Document().make()')
    expect(scripts[0]).toContain('bodyText = "the story"')
    expect(scripts[0]).toContain('Path("/tmp/story.pages")')
    expect(result.observed).toBe('{"ok":true,"characters":1215}')
    expect(result.notes?.[0]).toContain('one call')
  })

  it('refuses the operation when path or text is missing, rather than writing nowhere', async () => {
    const { runner } = runnerAnswering('{}')
    const handler = createAppleEventsHandler({ runner })
    await expect(handler(request('Document().make(); bodyText = text; save({ in: path })', { path: '/tmp/x' })))
      .rejects.toThrow(/requires path and text/)
    await expect(handler(request('Document().make(); bodyText = text; save({ in: path })', { text: 'x' })))
      .rejects.toThrow(/requires path and text/)
  })

  it('reports an application failure with stderr attached', async () => {
    const { runner } = runnerAnswering('', 1, 'Not authorized to send Apple events')
    const handler = createAppleEventsHandler({ runner })
    await expect(handler(request('Document().make(); bodyText = text; save({ in: path })', { path: '/tmp/x', text: 'y' })))
      .rejects.toThrow(/Not authorized to send Apple events/)
  })

  it('reports a failure that explained nothing rather than an empty message', async () => {
    const { runner } = runnerAnswering('', 1, '   ')
    const handler = createAppleEventsHandler({ runner })
    await expect(handler(request('Document().make(); bodyText = text; save({ in: path })', { path: '/tmp/x', text: 'y' })))
      .rejects.toThrow(/without reporting a reason/)
  })
})

describe('the mail and calendar recipes', () => {
  it('reads account names', async () => {
    const { runner, scripts } = runnerAnswering('{"ok":true,"accounts":["iCloud"]}')
    const handler = createAppleEventsHandler({ runner })
    const result = await handler(request('accounts.name()', {}, 'com.apple.Mail'))
    expect(scripts[0]).toContain('accounts.name()')
    expect(result.observed).toContain('iCloud')
  })

  it('caps the message count at what the inbox actually holds', async () => {
    const { runner, scripts } = runnerAnswering('{"ok":true,"total":63037,"subjects":[]}')
    const handler = createAppleEventsHandler({ runner })
    await handler(request('inbox.messages[0..n].subject()', { count: '3' }, 'com.apple.Mail'))
    expect(scripts[0]).toContain('Math.min(3, messages.length)')
  })

  it('falls back to five messages when the count is unreadable', async () => {
    const { runner, scripts } = runnerAnswering('{"ok":true,"total":0,"subjects":[]}')
    const handler = createAppleEventsHandler({ runner })
    await handler(request('inbox.messages[0..n].subject()', { count: 'lots' }, 'com.apple.Mail'))
    expect(scripts[0]).toContain('Math.min(5, messages.length)')
  })

  it('reads calendars', async () => {
    const { runner } = runnerAnswering('{"ok":true,"calendars":["Work"]}')
    const handler = createAppleEventsHandler({ runner })
    const result = await handler(request('calendars.name()', {}, 'com.apple.Calendar'))
    expect(result.observed).toContain('Work')
  })

  it('refuses an operation it does not implement instead of silently doing nothing', async () => {
    const { runner, scripts } = runnerAnswering('{}')
    const handler = createAppleEventsHandler({ runner })
    await expect(handler(request('deleteEverything()', {}, 'com.apple.Mail')))
      .rejects.toThrow(/does not implement "deleteEverything\(\)"/)
    expect(scripts).toHaveLength(0)
  })
})

describe('end to end through router, executor and handler', () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'aeven-e2e-'))
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('resolves the book, runs the handler, and verifies from disk', async () => {
    const path = join(dir, 'story.pages')
    // The handler stands in for Pages: it writes exactly what the operation would
    // have written, so the verification below is exercised for real.
    const executor = new TaskExecutor({
      book: STARTER_BOOK,
      handlers: {
        'apple-events': async ({ parameters }) => {
          const { writeFile } = await import('node:fs/promises')
          await writeFile(parameters.path as string, parameters.text as string, 'utf8')
          return { observed: `wrote ${String((parameters.text as string).length)} characters` }
        },
      },
    })
    const outcome = await executor.execute({
      task: 'document.createText',
      platform: 'darwin',
      app: 'com.apple.Pages',
      parameters: { path, text: 'The Cartographer of Small Hours' },
    })
    expect(outcome.verified).toBe(true)
    expect(outcome.rung).toBe('semantic')
    expect(outcome.mechanism).toBe(APPLE_EVENTS_MECHANISM)
    await expect(readFile(path, 'utf8')).resolves.toBe('The Cartographer of Small Hours')
  })

  it('reports the Pages blind spots alongside the resolved rung', async () => {
    const executor = new TaskExecutor({ book: STARTER_BOOK })
    const resolved = executor.routing.resolve({ task: 'document.createText', platform: 'darwin', app: 'com.apple.Pages' })
    expect(resolved.knownBlind).toContain('template.choose')
    expect(resolved.knownBlind).toContain('document.applyFont')
  })

  it('keeps formatting off the semantic rung, because the recipe declares it blind there', () => {
    const executor = new TaskExecutor({ book: STARTER_BOOK })
    expect(executor.routing.resolve({ task: 'document.applyFont', platform: 'darwin', app: 'com.apple.Pages' }).rung)
      .toBe('accessibility')
  })

  it('refuses a task whose mechanism has no handler, naming the mechanism', async () => {
    const comBook: RecipeBook = [{
      task: 'doc.write',
      summary: 'Write.',
      on: [{ platform: 'win32', rung: 'semantic', apps: ['Word.Application'], evidence: 'documented', invocation: { mechanism: 'com', operation: 'InsertAfter' } }],
      verify: [{ kind: 'fileExists', path: '/tmp/x' }],
    }]
    await expect(new TaskExecutor({ book: comBook }).execute({ task: 'doc.write', platform: 'win32' }))
      .rejects.toThrow(/no handler performs the "com" mechanism/)
  })

  it('does not call the runner for a task it refused', async () => {
    const run = vi.fn(() => Promise.resolve({ code: 0, stdout: '{}', stderr: '' }))
    const handler = createAppleEventsHandler({ runner: { run } })
    await expect(handler(request('unknownOp()'))).rejects.toThrow()
    expect(run).not.toHaveBeenCalled()
  })
})
