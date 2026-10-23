/** Every orientation budget has a shipped default, and an out-of-range one fails plugin load. */
import { describe, expect, it } from 'vitest'
import { Config } from '../src/index.ts'
import { mountProjectContext } from './harness.ts'

describe('project-context configuration', () => {
  it('fills every default when the composition passes no config', () => {
    expect(Config({})).toEqual({
      readmeNames: ['README.md', 'README'],
      maxReadmeBytes: 65_536,
      maxSummaryLength: 1_200,
      maxEntries: 60,
      ignoredEntries: ['node_modules', 'lib', 'dist', 'build', 'coverage'],
      maxRelatedProjects: 20,
    })
  })

  it('keeps supplied values and fills the rest', () => {
    expect(Config({ maxEntries: 3, readmeNames: ['PROJECT.md'] })).toEqual({
      readmeNames: ['PROJECT.md'],
      maxReadmeBytes: 65_536,
      maxSummaryLength: 1_200,
      maxEntries: 3,
      ignoredEntries: ['node_modules', 'lib', 'dist', 'build', 'coverage'],
      maxRelatedProjects: 20,
    })
  })

  it('fails plugin load for a budget outside its range', async () => {
    await expect(mountProjectContext({ config: { maxReadmeBytes: 0 } })).rejects.toThrow(/maxReadmeBytes/u)
    await expect(mountProjectContext({ config: { maxSummaryLength: 0 } })).rejects.toThrow(/maxSummaryLength/u)
    await expect(mountProjectContext({ config: { maxEntries: 0 } })).rejects.toThrow(/maxEntries/u)
    await expect(mountProjectContext({ config: { maxRelatedProjects: -1 } })).rejects.toThrow(/maxRelatedProjects/u)
  })

  it('fails plugin load for a non-integer budget', async () => {
    await expect(mountProjectContext({ config: { maxSummaryLength: 1.5 } })).rejects.toThrow(/maxSummaryLength/u)
  })

  it('accepts a budget of one, the smallest whole value each field allows', async () => {
    const ctx = await mountProjectContext({
      config: { maxReadmeBytes: 1, maxSummaryLength: 1, maxEntries: 1, maxRelatedProjects: 0 },
    })
    expect(ctx.fs).toBeDefined()
  })
})
