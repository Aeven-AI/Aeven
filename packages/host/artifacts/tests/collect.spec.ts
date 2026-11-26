/**
 * Reading a Session log into artifacts: created files of an artifact kind are listed once, newest first, with
 * their stored copy; source files, changes to files the Session did not create, and failed calls are not.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createToolResultMessage, ToolCallId } from '@aeven/llm'
import SessionStore, { SessionId, SessionLogOffset } from '@aeven/session'
import type { Session, SessionEvent } from '@aeven/session'
import { artifactKind, artifactName, collectArtifacts, htmlTitle, readableName } from '@aeven/host-artifacts'

async function session(id: string): Promise<Session> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  return ctx.sessions.create(SessionId(id))
}

let calls = 0

/** Append one tool call and its result in `turn`. */
function runTool(
  target: Session,
  turn: number,
  name: string,
  args: unknown,
  result: { text?: string; isError?: boolean; meta?: NonNullable<SessionEvent<'tool/result'>['data']['meta']> } = {},
): void {
  const callId = ToolCallId(`call-${String(++calls)}`)
  target.append('tool/call', { turn, step: 1, callId, name, arguments: JSON.stringify(args) })
  target.append('tool/result', {
    turn,
    step: 1,
    message: createToolResultMessage({
      callId,
      content: [{ type: 'text', text: result.text ?? 'ok' }],
      isError: result.isError ?? false,
    }),
    ...result.meta === undefined ? {} : { meta: result.meta },
  }, { surfaceOp: 'append' })
}

function collect(target: Session, inherited = 0) {
  return collectArtifacts(target.header, SessionLogOffset(inherited), target.snapshotEvents())
}

describe('artifact kinds', () => {
  it('classifies by extension, ignoring case and either path separator', () => {
    expect(artifactKind('/work/Deck.PPTX')).toBe('slides')
    expect(artifactKind('C:\\out\\report.pdf')).toBe('pdf')
    expect(artifactKind('site/index.html')).toBe('page')
    expect(artifactKind('notes.md')).toBe('document')
    expect(artifactKind('cat.webp')).toBe('image')
    expect(artifactKind('clip.mp4')).toBe('video')
    expect(artifactName('C:\\out\\report.pdf')).toBe('report.pdf')
  })

  it('leaves source, configuration and extensionless files out', () => {
    expect(artifactKind('src/index.ts')).toBeUndefined()
    expect(artifactKind('package.json')).toBeUndefined()
    expect(artifactKind('.gitignore')).toBeUndefined()
    expect(artifactKind('Makefile')).toBeUndefined()
  })
})

describe('collectArtifacts', () => {
  it('lists created files of an artifact kind with the Session that made them', async () => {
    const target = await session('made')
    target.append('turn/start', { turn: 1 })
    runTool(target, 1, 'write', { file_path: 'notes.md', content: 'x' }, { text: 'Created file notes.md' })
    runTool(target, 1, 'write', { file_path: 'src/a.ts', content: 'x' }, { text: 'Created file src/a.ts' })
    runTool(target, 1, 'bash', { command: 'render' }, {
      meta: { producedFiles: [{ path: '/work/cat.png', created: true, attachmentId: 'att-1' }] },
    })

    const artifacts = collect(target)
    expect(artifacts.map(item => item.path).sort()).toEqual(['/work/cat.png', 'notes.md'])
    expect(artifacts.find(item => item.path === '/work/cat.png')).toMatchObject({
      sessionId: 'made', name: 'cat.png', kind: 'image', attachmentId: 'att-1',
    })
    expect(artifacts.every(item => item.createdAt > 0)).toBe(true)
  })

  it('skips failed calls and changes to files the Session did not create', async () => {
    const target = await session('edits')
    target.append('turn/start', { turn: 1 })
    runTool(target, 1, 'write', { file_path: 'broken.md', content: 'x' }, { isError: true })
    runTool(target, 1, 'edit', { file_path: 'README.md', old_string: 'a', new_string: 'b' }, {
      meta: { diffs: [{ path: 'README.md', oldText: 'a', newText: 'b' }] },
    })

    expect(collect(target)).toEqual([])
  })

  it('lists a path created in two Turns once', async () => {
    const target = await session('twice')
    target.append('turn/start', { turn: 1 })
    runTool(target, 1, 'write', { file_path: 'page.html', content: '<p>' }, { text: 'Created file page.html' })
    target.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    target.append('turn/start', { turn: 2 })
    runTool(target, 2, 'bash', { command: 'build' }, { meta: { producedFiles: [{ path: 'page.html', created: true }] } })

    expect(collect(target).map(item => item.id)).toEqual(['twice:page.html'])
  })

  it('leaves the events a fork inherited to the parent Session', async () => {
    const target = await session('fork')
    target.append('turn/start', { turn: 1 })
    runTool(target, 1, 'write', { file_path: 'old.md', content: 'x' }, { text: 'Created file old.md' })
    const inherited = target.snapshotEvents().length
    target.append('turn/start', { turn: 2 })
    runTool(target, 2, 'write', { file_path: 'new.md', content: 'x' }, { text: 'Created file new.md' })

    expect(collect(target, inherited).map(item => item.path)).toEqual(['new.md'])
  })

  it('lists a Motion film once, as its folder, and leaves its scene pages out', async () => {
    const target = await session('film')
    target.append('turn/start', { turn: 1 })
    runTool(target, 1, 'write', { file_path: '/work/launch/index.html', content: '<p>' }, { text: 'Created file /work/launch/index.html' })
    runTool(target, 1, 'write', { file_path: '/work/launch/compositions/intro.html', content: '<p>' }, { text: 'Created file intro.html' })
    runTool(target, 1, 'write', { file_path: '/work/other.html', content: '<p>' }, { text: 'Created file /work/other.html' })
    runTool(target, 1, 'show_motion', { composition: 'launch' }, { meta: { compositionDir: '/work/launch', durationSeconds: 3 } })
    runTool(target, 1, 'show_motion', { composition: 'launch' }, {
      meta: { compositionDir: '/work/launch', durationSeconds: 5, film: { attachmentId: 'film-2', name: 'launch.html' } },
    })

    const artifacts = collect(target)
    expect(artifacts.map(item => [item.kind, item.name]).sort()).toEqual([['motion', 'launch'], ['page', 'other.html']])
    expect(artifacts.find(item => item.kind === 'motion')).toMatchObject({
      id: 'film:/work/launch', path: '/work/launch/index.html', attachmentId: 'film-2', callId: `call-${String(calls)}`,
    })
  })

  it('leaves a page out when an export of the same name sits beside it', async () => {
    const target = await session('deck')
    target.append('turn/start', { turn: 1 })
    runTool(target, 1, 'write', { file_path: 'presentations/a/deck.html', content: '<p>' }, { text: 'Created file deck.html' })
    runTool(target, 1, 'write', { file_path: 'presentations/a/notes.html', content: '<p>' }, { text: 'Created file notes.html' })
    runTool(target, 1, 'bash', { command: 'export' }, {
      meta: { producedFiles: [{ path: 'presentations/a/deck.pdf', created: true }, { path: 'presentations/a/deck.pptx', created: true }] },
    })

    expect(collect(target).map(item => item.name).sort()).toEqual(['deck.pdf', 'deck.pptx', 'notes.html'])
  })

  it('names a page by its own title, else a generic file by its folder, else by the conversation', async () => {
    const target = await session('names')
    // The title event belongs to the session-title plugin, whose event map this package does not merge.
    const appendUntyped = target.append.bind(target) as unknown as (type: string, data: unknown) => unknown
    appendUntyped('session/title', { title: 'Porcelain vase reassembly' })
    target.append('turn/start', { turn: 1 })
    runTool(target, 1, 'write', {
      file_path: '/docs/Aeven/vase-reassembly/index.html',
      content: '<html><head><title>Reassembly &mdash; the vase</title></head></html>',
    }, { text: 'Created file index.html' })
    runTool(target, 1, 'write', { file_path: '/docs/Aeven/garden-plan/index.html', content: '<p>no title</p>' }, { text: 'Created file' })
    runTool(target, 1, 'write', { file_path: '/docs/Aeven/dist/index.html', content: '<p>no title</p>' }, { text: 'Created file' })
    runTool(target, 1, 'write', { file_path: '/docs/Aeven/report.md', content: '# x' }, { text: 'Created file' })

    const titles = Object.fromEntries(collect(target).map(item => [item.path, item.title]))
    expect(titles).toEqual({
      '/docs/Aeven/vase-reassembly/index.html': 'Reassembly \u2014 the vase',
      '/docs/Aeven/garden-plan/index.html': 'Garden plan',
      '/docs/Aeven/dist/index.html': 'Porcelain vase reassembly',
      '/docs/Aeven/report.md': 'report.md',
    })
  })
})

describe('artifact titles', () => {
  it('reads a page title with entities decoded and whitespace collapsed', () => {
    expect(htmlTitle('<title>\n  A &amp; B &#8212; &#x263A;  </title>')).toBe('A & B \u2014 \u263a')
    expect(htmlTitle('<TITLE lang="en">Shout</TITLE>')).toBe('Shout')
    expect(htmlTitle('<title> </title>')).toBeUndefined()
    expect(htmlTitle('<p>none</p>')).toBeUndefined()
  })

  it('turns a folder name into words', () => {
    expect(readableName('vase-reassembly')).toBe('Vase reassembly')
    expect(readableName('q3_sales.report')).toBe('Q3 sales report')
  })
})
