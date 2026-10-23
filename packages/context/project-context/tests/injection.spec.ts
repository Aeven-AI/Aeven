/** The pre-step listener: when it injects orientation, and when it stays out of the way. */
import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@aeven/llm'
import {
  agentFor,
  entry,
  orientationOf,
  orientationText,
  pluginMessage,
  preStep,
  projectSession,
  workspace,
  mountProjectContext,
} from './harness.ts'

const CWD = '/home/ada/projects/site'

/** A mounted context whose working directory is a real project folder. */
async function project() {
  const mounted = await mountProjectContext()
  const fs = mounted.fs!
  fs.seed(CWD, { type: 'directory' })
  fs.seed(`${CWD}/README.md`, { type: 'file', content: 'A static site builder for field notes.' })
  fs.list(CWD, [entry(CWD, 'src', 'directory'), entry(CWD, 'package.json', 'file')])
  return { ...mounted, fs, session: projectSession({ cwd: CWD }) }
}

describe('project-context injection', () => {
  it('injects one snapshot-attributed orientation message before the first step', async () => {
    const { ctx, session } = await project()
    const decision = await preStep(ctx, agentFor(session))

    const message = orientationOf(decision)
    expect(message?.content).toEqual([{ type: 'text', text: orientationText(decision) }])
    expect(message?.source).toEqual({
      kind: 'plugin',
      plugin: 'project-context',
      form: 'snapshot',
      sections: [{ name: 'project-context', text: orientationText(decision) }],
    })
    const text = orientationText(decision)
    expect(text).toMatch(/^<project_context>\n/u)
    expect(text).toMatch(/\n<\/project_context>$/u)
    expect(text).toContain(`This conversation runs in the person's own project folder, ${CWD}.`)
    expect(text).toContain('README summary:\nA static site builder for field notes.')
    expect(text).toContain('Top level: src/, package.json')
  })

  it('keeps the decision untouched once the session surface already carries the orientation', async () => {
    const { ctx, fs, session } = await project()
    const agent = agentFor(session)
    const first = await preStep(ctx, agent)
    const orientation = orientationOf(first)
    if (orientation === undefined) throw new Error('expected an injected orientation')
    session.append('user/message', orientation, { surfaceOp: 'append' })
    const readsBefore = fs.resolved.length

    await expect(preStep(ctx, agent)).resolves.toEqual({ kind: 'enter', messages: [] })
    expect(fs.resolved).toHaveLength(readsBefore)
  })

  it('keeps the decision untouched when this step already carries the orientation', async () => {
    const { ctx, fs, session } = await project()
    const orientation = createUserMessage({
      content: [{ type: 'text', text: '<project_context>\nprior</project_context>' }],
      source: { kind: 'plugin', plugin: 'project-context' },
    })
    const decision = { kind: 'enter' as const, messages: [orientation] }

    await expect(preStep(ctx, agentFor(session), decision)).resolves.toBe(decision)
    expect(fs.resolved).toHaveLength(0)
  })

  it('scans past other messages, other plugins, and non-message events on the surface', async () => {
    const { ctx, fs, session } = await project()
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'question' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('user/message', pluginMessage('time-context', '<time_context/>'), { surfaceOp: 'append' })
    const step = {
      kind: 'enter' as const,
      messages: [
        createUserMessage({ content: [{ type: 'text', text: 'question' }], source: { kind: 'user' } }),
        pluginMessage('time-context', '<time_context/>'),
      ],
    }

    const decision = await preStep(ctx, agentFor(session), step)

    expect(decision.kind).toBe('enter')
    expect(orientationText(decision)).toContain('README summary:')
    expect(fs.listed).toEqual([CWD])
  })

  it('returns a rejected pre-step unchanged', async () => {
    const { ctx, fs, session } = await project()

    await expect(preStep(ctx, agentFor(session), { kind: 'reject' })).resolves.toEqual({ kind: 'reject' })
    expect(fs.resolved).toHaveLength(0)
  })

  it('returns an aborted pre-step unchanged', async () => {
    const { ctx, fs, session } = await project()
    const abort = new AbortController()
    abort.abort('turn cancelled')

    await expect(preStep(ctx, agentFor(session), { kind: 'enter', messages: [] }, abort.signal))
      .resolves.toEqual({ kind: 'enter', messages: [] })
    expect(fs.resolved).toHaveLength(0)
  })
})

describe('project-context no-op paths', () => {
  it('injects nothing into a session without a working directory', async () => {
    const { ctx, fs } = await project()

    await expect(preStep(ctx, agentFor(projectSession()))).resolves.toEqual({ kind: 'enter', messages: [] })
    expect(fs.resolved).toHaveLength(0)
  })

  it('injects nothing when no filesystem provider is mounted', async () => {
    const { ctx } = await mountProjectContext({ fs: false })

    await expect(preStep(ctx, agentFor(projectSession({ cwd: CWD }))))
      .resolves.toEqual({ kind: 'enter', messages: [] })
  })

  it('injects nothing when the working directory is absent', async () => {
    const { ctx, fs } = await mountProjectContext()
    fs!.list(CWD, [])

    await expect(preStep(ctx, agentFor(projectSession({ cwd: CWD })))).resolves.toEqual({ kind: 'enter', messages: [] })
    expect(fs!.listed).toHaveLength(0)
  })

  it('injects nothing when the working directory is not a directory', async () => {
    const { ctx, fs } = await mountProjectContext()
    fs!.seed(CWD, { type: 'file', content: 'not a folder' })

    await expect(preStep(ctx, agentFor(projectSession({ cwd: CWD })))).resolves.toEqual({ kind: 'enter', messages: [] })
    expect(fs!.listed).toHaveLength(0)
  })

  it('injects nothing when the session owner reaches no other project folder', async () => {
    const mounted = await mountProjectContext({
      workspaces: [
        workspace({ id: 'virtual', kind: 'virtual', owner: 'ada' }),
      ],
    })
    const fs = mounted.fs!
    fs.seed(CWD, { type: 'directory' })
    fs.list(CWD, [])

    const text = orientationText(await preStep(mounted.ctx, agentFor(projectSession({ cwd: CWD, owner: 'ada' }))))
    expect(text).not.toContain('other project folders')
  })
})
