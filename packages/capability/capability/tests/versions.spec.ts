/**
 * Kept revisions: every write leaves its procedure on disk, so a capability that got worse can be restored
 * instead of rewritten. A restore is a new revision, and the history stays append-only.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import Capabilities, { type Config } from '../src/index.ts'
import { CapabilityStore } from '../src/store.ts'

const roots: string[] = []
function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'capability-versions-'))
  roots.push(root)
  return root
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function service(root: string): Capabilities {
  const ctx = new Context()
  return new Capabilities(ctx, {
    root,
    trustAfter: 2,
    degradeAfter: 2,
  } satisfies Config)
}

const draft = (content: string, description = 'Runs the build.') => ({ name: 'runs-the-build', description, content })
const options = { status: 'learned', source: 'agent', sessionId: undefined } as const

describe('CapabilityStore kept revisions', () => {
  it('keeps every written body, oldest first, with the description it carried', async () => {
    const store = new CapabilityStore(scratch())
    await store.write('owner-a', {
      name: 'runs-the-build',
      description: 'Runs the build.',
      status: 'learned',
      revision: 1,
      source: 'agent',
      createdAt: 1,
      updatedAt: 1,
      files: [],
      provenance: [],
      content: 'First procedure.',
    })
    await store.write('owner-a', {
      name: 'runs-the-build',
      description: 'Runs the build faster.',
      status: 'learned',
      revision: 2,
      source: 'agent',
      createdAt: 1,
      updatedAt: 2,
      files: [],
      provenance: [],
      content: 'Second procedure.',
    })

    expect(await store.versions('owner-a', 'runs-the-build')).toEqual([
      { revision: 1, description: 'Runs the build.', content: 'First procedure.' },
      { revision: 2, description: 'Runs the build faster.', content: 'Second procedure.' },
    ])
  })

  it('answers with nothing for a capability that was never written', async () => {
    expect(await new CapabilityStore(scratch()).versions('owner-a', 'runs-the-build')).toEqual([])
    expect(await new CapabilityStore(scratch()).version('owner-a', 'runs-the-build', 1)).toBeUndefined()
  })

  it('answers with nothing for a revision number no write kept', async () => {
    const store = new CapabilityStore(scratch())
    await store.write('owner-a', {
      name: 'runs-the-build',
      description: 'Runs the build.',
      status: 'learned',
      revision: 1,
      source: 'agent',
      createdAt: 1,
      updatedAt: 1,
      files: [],
      provenance: [],
      content: 'First procedure.',
    })
    expect(await store.version('owner-a', 'runs-the-build', 7)).toBeUndefined()
  })
})

describe('rollback', () => {
  it('restores a kept body as a new revision and records what it restored', async () => {
    const root = scratch()
    const capabilities = service(root)
    await capabilities.save('owner-a', draft('First procedure.'), options)
    await capabilities.save('owner-a', draft('Second procedure.', 'Runs the build faster.'), options)
    const second = await capabilities.get('owner-a', 'runs-the-build')
    expect(second?.revision).toBe(2)

    const restored = await capabilities.rollback('owner-a', 'runs-the-build', 1, undefined)

    expect(restored.revision).toBe(3)
    expect(restored.content).toBe('First procedure.')
    expect(restored.description).toBe('Runs the build.')
    expect(restored.provenance.at(-1)).toMatchObject({ action: 'rollback', restored: 1 })
    // The restored revision is the current body, and the revision it replaced stays kept.
    expect((await capabilities.get('owner-a', 'runs-the-build'))?.content).toBe('First procedure.')
    expect((await capabilities.versions('owner-a', 'runs-the-build')).map(version => version.revision)).toEqual([1, 2, 3])
  })

  it('refuses a revision that was never kept', async () => {
    const capabilities = service(scratch())
    await capabilities.save('owner-a', draft('First procedure.'), options)
    await expect(capabilities.rollback('owner-a', 'runs-the-build', 9, undefined)).rejects.toThrow('no kept revision 9 of runs-the-build')
  })

  it('refuses a capability the owner does not have', async () => {
    await expect(service(scratch()).rollback('owner-a', 'runs-the-build', 1, undefined)).rejects.toThrow('no capability named runs-the-build')
  })
})
