/** The README summary: which file is read, how its prose is bounded, and its absence. */
import { describe, expect, it } from 'vitest'
import { agentFor, mountProjectContext, orientationText, preStep, projectSession } from './harness.ts'

const CWD = '/home/ada/projects/site'

describe('project-context README summary', () => {
  it('summarizes the first README name that exists as a file', async () => {
    const { ctx, fs } = await mountProjectContext()
    fs!.seed(CWD, { type: 'directory' })
    fs!.list(CWD, [])
    // A directory squatting on the preferred name is not a README.
    fs!.seed(`${CWD}/README.md`, { type: 'directory' })
    fs!.seed(`${CWD}/README`, { type: 'file', content: 'Field notes, indexed and published.' })

    const text = orientationText(await preStep(ctx, agentFor(projectSession({ cwd: CWD }))))

    expect(text).toContain('README summary:\nField notes, indexed and published.')
    expect(fs!.reads.map(read => read.key)).toEqual([`${CWD}/README`])
  })

  it('keeps the preferred README name ahead of a later one', async () => {
    const { ctx, fs } = await mountProjectContext()
    fs!.seed(CWD, { type: 'directory' })
    fs!.list(CWD, [])
    fs!.seed(`${CWD}/README.md`, { type: 'file', content: 'The Markdown README wins.' })
    fs!.seed(`${CWD}/README`, { type: 'file', content: 'The bare README loses.' })

    const text = orientationText(await preStep(ctx, agentFor(projectSession({ cwd: CWD }))))

    expect(text).toContain('The Markdown README wins.')
    expect(text).not.toContain('The bare README loses.')
    expect(fs!.reads).toHaveLength(1)
  })

  it('omits the summary when the folder has no README', async () => {
    const { ctx, fs } = await mountProjectContext()
    fs!.seed(CWD, { type: 'directory' })
    fs!.list(CWD, [])
    fs!.seed(`${CWD}/notes.txt`, { type: 'file', content: 'Not a README.' })

    const text = orientationText(await preStep(ctx, agentFor(projectSession({ cwd: CWD }))))

    expect(text).not.toContain('README summary:')
    expect(text).not.toContain('Not a README.')
    expect(fs!.reads).toHaveLength(0)
  })

  it('clips the summary at the configured code-point budget', async () => {
    const { ctx, fs } = await mountProjectContext({ config: { maxSummaryLength: 12 } })
    fs!.seed(CWD, { type: 'directory' })
    fs!.list(CWD, [])
    fs!.seed(`${CWD}/README.md`, { type: 'file', content: 'A static site builder for field notes.' })

    const text = orientationText(await preStep(ctx, agentFor(projectSession({ cwd: CWD }))))

    expect(text).toContain('README summary:\nA static sit…')
  })

  it('bounds every README read by maxReadmeBytes, configured or default', async () => {
    const tuned = await mountProjectContext({ config: { maxReadmeBytes: 128 } })
    tuned.fs!.seed(CWD, { type: 'directory' })
    tuned.fs!.list(CWD, [])
    tuned.fs!.seed(`${CWD}/README.md`, { type: 'file', content: 'Bounded read.' })
    await preStep(tuned.ctx, agentFor(projectSession({ cwd: CWD })))
    expect(tuned.fs!.reads).toEqual([{ key: `${CWD}/README.md`, maxBytes: 128 }])

    const stock = await mountProjectContext()
    stock.fs!.seed(CWD, { type: 'directory' })
    stock.fs!.list(CWD, [])
    stock.fs!.seed(`${CWD}/README.md`, { type: 'file', content: 'Bounded read.' })
    await preStep(stock.ctx, agentFor(projectSession({ cwd: CWD })))
    expect(stock.fs!.reads).toEqual([{ key: `${CWD}/README.md`, maxBytes: 65_536 }])
  })
})
