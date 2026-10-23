/** The top-level listing: what it hides, how it orders entries, and its budget. */
import { describe, expect, it } from 'vitest'
import {
  agentFor,
  entry,
  mountProjectContext,
  orientationText,
  preStep,
  projectSession,
  type FakeFileSystem,
} from './harness.ts'

const CWD = '/home/ada/projects/site'

/** A listing mixing directories, files, dot-entries, and ignored build output. */
function seedTopLevel(fs: FakeFileSystem): void {
  fs.list(CWD, [
    entry(CWD, 'zeta.txt', 'file'),
    entry(CWD, 'beta', 'directory'),
    entry(CWD, 'mmm.md', 'file'),
    entry(CWD, '.git', 'directory'),
    entry(CWD, 'alpha', 'directory'),
    entry(CWD, 'node_modules', 'directory'),
    entry(CWD, 'aaa.txt', 'file'),
    entry(CWD, 'dist', 'directory'),
  ])
}

describe('project-context top-level listing', () => {
  it('lists directories first, then files, without dot-entries or ignored entries', async () => {
    const { ctx, fs } = await mountProjectContext()
    fs!.seed(CWD, { type: 'directory' })
    seedTopLevel(fs!)

    const text = orientationText(await preStep(ctx, agentFor(projectSession({ cwd: CWD }))))

    expect(text).toContain('\nTop level: alpha/, beta/, aaa.txt, mmm.md, zeta.txt\n')
  })

  it('honors a configured ignore list in addition to dot-entries', async () => {
    const { ctx, fs } = await mountProjectContext({ config: { ignoredEntries: ['zeta.txt', '.git'] } })
    fs!.seed(CWD, { type: 'directory' })
    fs!.list(CWD, [entry(CWD, 'zeta.txt', 'file'), entry(CWD, 'keep.md', 'file')])

    const text = orientationText(await preStep(ctx, agentFor(projectSession({ cwd: CWD }))))

    expect(text).toContain('\nTop level: keep.md\n')
  })

  it('caps the listing at maxEntries and counts the rest', async () => {
    const { ctx, fs } = await mountProjectContext({ config: { maxEntries: 2 } })
    fs!.seed(CWD, { type: 'directory' })
    seedTopLevel(fs!)

    const text = orientationText(await preStep(ctx, agentFor(projectSession({ cwd: CWD }))))

    expect(text).toContain('\nTop level: alpha/, beta/, and 3 more\n')
  })

  it('omits the listing for an empty folder', async () => {
    const { ctx, fs } = await mountProjectContext()
    fs!.seed(CWD, { type: 'directory' })
    fs!.list(CWD, [entry(CWD, '.git', 'directory')])

    const text = orientationText(await preStep(ctx, agentFor(projectSession({ cwd: CWD }))))

    expect(text).not.toContain('Top level:')
    expect(fs!.listed).toEqual([CWD])
  })

  it('marks entries that are neither files nor directories by name alone', async () => {
    const { ctx, fs } = await mountProjectContext()
    fs!.seed(CWD, { type: 'directory' })
    fs!.list(CWD, [entry(CWD, 'socket', 'other')])

    const text = orientationText(await preStep(ctx, agentFor(projectSession({ cwd: CWD }))))

    expect(text).toContain('\nTop level: socket\n')
  })
})
