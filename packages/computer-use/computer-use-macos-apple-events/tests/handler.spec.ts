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
import type { MechanismRequest } from '@aeven/computer-use-executor'
import { STARTER_BOOK, type RecipeBook } from '@aeven/computer-use-router'
import {
  APPLE_EVENTS_MECHANISM,
  appleScriptLiteral,
  createAppleEventsHandler,
  isBundleId,
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

// Typed as MechanismRequest on purpose: an inferred return type here would only
// describe what this helper happens to build, so a handler signature that drifted
// from the helper's shape would go unnoticed. `mechanism` sits beside `operation`
// inside the invocation, which is what the router produces and what a consumer
// switches on.
const request = (
  operation: string,
  parameters: Record<string, string> = {},
  app = 'com.apple.Pages',
): MechanismRequest => ({
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

describe('Keynote is driven in AppleScript, not JXA', () => {
  it('embeds values as AppleScript literals, including line breaks', () => {
    // AppleScript has no escape for a newline inside a literal, so a raw one would
    // be a syntax error rather than a value; it has to be concatenated instead.
    expect(appleScriptLiteral('plain')).toBe('"plain"')
    expect(appleScriptLiteral('say "hi"')).toBe('"say \\"hi\\""')
    expect(appleScriptLiteral('back\\slash')).toBe('"back\\\\slash"')
    expect(appleScriptLiteral('a\nb')).toBe('"a" & (character id 10) & "b"')
    expect(appleScriptLiteral('a\tb')).toBe('"a" & (character id 9) & "b"')
  })

  it('renders a carriage return as a concatenation too, since AppleScript cannot escape one', () => {
    // A carriage return is the other character a script's text can arrive carrying
    // from a clipboard or a Windows-authored file, and it fails the same way a
    // newline does: as a syntax error rather than as a value.
    expect(appleScriptLiteral('a\rb')).toBe('"a" & (character id 13) & "b"')
    const mixed = appleScriptLiteral('Chapter\r\nOne')
    expect(mixed).toContain('character id 13')
    expect(mixed).toContain('character id 10')
  })

  it('cannot be broken out of by hostile text', () => {
    const literal = appleScriptLiteral('" & (do shell script "touch /tmp/pwned") & "')
    // Every quote in the payload is escaped, so the injected command stays inside
    // the string and cannot become a statement.
    expect(literal.startsWith('"')).toBe(true)
    expect(literal.endsWith('"')).toBe(true)
    expect(literal.slice(1, -1)).not.toMatch(/(^|[^\\])"/)
  })

  it('targets the document when adding slides, which the untargeted form cannot do', async () => {
    const { runner, scripts } = runnerAnswering('story')
    const handler = createAppleEventsHandler({ runner })
    await handler(request('keynote.setSlideText', {
      path: '/tmp/deck.key',
      slideIndex: '2',
      textItem: '1',
      text: 'Chapter One',
    }, 'com.apple.Keynote'))
    // -10024 "Can't make or move that element into that container" is what an
    // untargeted `make new slide` produces, so the `tell theDoc to` form is load-bearing.
    expect(scripts[0]).toContain('tell theDoc to make new slide')
    expect(scripts[0]).toContain('slide 2 of theDoc')
  })

  it('addresses an application by id when given a bundle identifier', async () => {
    // `tell application "com.apple.Keynote"` is a syntax error in AppleScript (-2741):
    // that form takes a name, and a bundle id needs `application id`. Recipes carry
    // ids, so this distinction is what makes them usable at all.
    expect(isBundleId('com.apple.Keynote')).toBe(true)
    expect(isBundleId('Keynote')).toBe(false)
    expect(isBundleId('Keynote Creator Studio')).toBe(false)

    const { runner, scripts } = runnerAnswering('story')
    const handler = createAppleEventsHandler({ runner })
    await handler(request('keynote.setSlideText', { path: '/tmp/deck.key', text: 'Hello' }, 'com.apple.Keynote'))
    expect(scripts[0]).toContain('tell application id "com.apple.Keynote"')
  })

  it('addresses an application by name when the recipe carries a name instead of an id', async () => {
    // `application id "Keynote"` is the -2741 syntax error in the other direction:
    // a display name is not a reverse-DNS string, so the name form is the correct one.
    const { runner, scripts } = runnerAnswering('story')
    const handler = createAppleEventsHandler({ runner })
    await handler(request('keynote.setSlideText', { path: '/tmp/deck.key', text: 'Hello' }, 'Keynote'))
    expect(scripts[0]).toContain('tell application "Keynote"')
    expect(scripts[0]).not.toContain('application id')
  })

  it('writes the title into the first placeholder and the body into the named one', async () => {
    const { runner, scripts } = runnerAnswering('story')
    const handler = createAppleEventsHandler({ runner })
    await handler(request('keynote.setSlideText', {
      path: '/tmp/deck.key',
      text: 'Body copy',
      title: 'Chapter One',
      slideIndex: '3',
      textItem: '2',
    }, 'com.apple.Keynote'))
    // A title is the one parameter written somewhere other than the addressed text
    // item: a slide's title placeholder is always text item 1 of its layout.
    expect(scripts[0]).toContain('set object text of text item 1 of theSlide to "Chapter One"')
    expect(scripts[0]).toContain('set object text of text item 2 of theSlide to "Body copy"')
    // Slides are added one at a time from slide 2, addressed at the document.
    expect(scripts[0]).toContain('repeat with i from 2 to 3')
    expect(scripts[0]).toContain('slide 3 of theDoc')
  })

  it('writes no title line at all when the request carries no title', async () => {
    const { runner, scripts } = runnerAnswering('story')
    const handler = createAppleEventsHandler({ runner })
    await handler(request('keynote.setSlideText', {
      path: '/tmp/deck.key',
      text: 'Body copy',
      textItem: '2',
    }, 'com.apple.Keynote'))
    expect(scripts[0]).not.toContain('text item 1 of theSlide')
    expect(scripts[0]).toContain('set object text of text item 2 of theSlide to "Body copy"')
  })

  it('refuses slide text with no path or no text rather than writing nowhere', async () => {
    const { runner, scripts } = runnerAnswering('story')
    const handler = createAppleEventsHandler({ runner })
    await expect(handler(request('keynote.setSlideText', { text: 'Hello' }, 'com.apple.Keynote')))
      .rejects.toThrow(/requires path and text/)
    await expect(handler(request('keynote.setSlideText', { path: '/tmp/deck.key' }, 'com.apple.Keynote')))
      .rejects.toThrow(/requires path and text/)
    expect(scripts).toHaveLength(0)
  })

  it('reports a refused slide write with its stderr rather than an empty read-back', async () => {
    const { runner } = runnerAnswering('', 1, 'Keynote got an error: the document could not be saved')
    const handler = createAppleEventsHandler({ runner })
    await expect(handler(request('keynote.setSlideText', { path: '/tmp/deck.key', text: 'Hello' }, 'com.apple.Keynote')))
      .rejects.toThrow(/setting slide text failed: Keynote got an error/)
  })

  it('writes into a layout placeholder and reads it back before saving', async () => {
    const { runner, scripts } = runnerAnswering('story')
    const handler = createAppleEventsHandler({ runner })
    const result = await handler(request('keynote.setSlideText', {
      path: '/tmp/deck.key',
      textItem: '3',
      text: 'Body copy',
    }, 'com.apple.Keynote'))
    // A slide refuses a new text item, so text goes into an existing placeholder.
    expect(scripts[0]).toContain('set object text of text item 3 of theSlide to "Body copy"')
    expect(scripts[0]).toContain('set readBack to object text of text item 3 of theSlide')
    expect(scripts[0]).toContain('save theDoc in "/tmp/deck.key"')
    // Closing without saving is what keeps a probe from leaving a document in the app.
    expect(scripts[0]).toContain('close theDoc saving no')
    expect(result.observed).toBe('story')
  })

  it('refuses an operation it does not implement rather than guessing', async () => {
    const { runner } = runnerAnswering('{}')
    const handler = createAppleEventsHandler({ runner })
    await expect(handler(request('keynote.teleport'))).rejects.toThrow(/does not implement/)
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

  it('embeds every value through a caller-supplied literal encoder when one is given', async () => {
    // The option exists for a caller that must produce a foreign dialect; it has to
    // be used for every embedded value, not only for the document text.
    const seen: string[] = []
    const { runner, scripts } = runnerAnswering('{"ok":true,"characters":9}')
    const handler = createAppleEventsHandler({
      runner,
      literal: (value) => {
        seen.push(value)
        return jsLiteral(value)
      },
    })
    await handler(request('Document().make(); bodyText = text; save({ in: path })', {
      path: '/tmp/story.pages',
      text: 'the story',
    }))
    expect(seen).toEqual(['com.apple.Pages', 'the story', '/tmp/story.pages'])
    expect(scripts[0]).toContain('doc.bodyText = "the story"')
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

  it('addresses the current application when the request names no app at all', async () => {
    // A recipe that is not application-specific leaves `app` out; calling that
    // undefined would put the string "undefined" into the script.
    const { runner, scripts } = runnerAnswering('{"ok":true,"accounts":[]}')
    const handler = createAppleEventsHandler({ runner })
    await handler({
      invocation: { mechanism: APPLE_EVENTS_MECHANISM, operation: 'accounts.name()' },
      parameters: {},
    })
    expect(scripts[0]).toContain('const Mail = Application.currentApplication()')
    expect(scripts[0]).not.toContain('undefined')
  })

  it('caps the message count at five when the request names no count', async () => {
    const { runner, scripts } = runnerAnswering('{"ok":true,"total":0,"subjects":[]}')
    const handler = createAppleEventsHandler({ runner })
    await handler(request('inbox.messages[0..n].subject()', {}, 'com.apple.Mail'))
    expect(scripts[0]).toContain('Math.min(5, messages.length)')
  })

  it('reports a refused account listing rather than an empty account list', async () => {
    const { runner } = runnerAnswering('', 1, 'Mail got an error: not authorized to send Apple events')
    const handler = createAppleEventsHandler({ runner })
    await expect(handler(request('accounts.name()', {}, 'com.apple.Mail')))
      .rejects.toThrow(/listing accounts failed: Mail got an error/)
  })

  it('reports a refused inbox read rather than an empty subject list', async () => {
    const { runner } = runnerAnswering('', 1, 'the inbox is not available')
    const handler = createAppleEventsHandler({ runner })
    await expect(handler(request('inbox.messages[0..n].subject()', {}, 'com.apple.Mail')))
      .rejects.toThrow(/reading inbox subjects failed: the inbox is not available/)
  })

  it('reports a refused calendar listing rather than an empty calendar list', async () => {
    const { runner } = runnerAnswering('', 1, 'Calendar got an error: not authorized')
    const handler = createAppleEventsHandler({ runner })
    await expect(handler(request('calendars.name()', {}, 'com.apple.Calendar')))
      .rejects.toThrow(/listing calendars failed: Calendar got an error/)
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
