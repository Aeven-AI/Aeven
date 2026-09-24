import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@aeven/agent'
import { CordisInspectRegistryService, type HostCordisInspectProviderRegistration } from '../src/index.ts'

const AGENT = {} as Agent

function provider(answer: string, description = 'Answers with a fixed value.'): HostCordisInspectProviderRegistration {
  return {
    manifest: {
      id: 'Service',
      description,
      methods: [{
        name: 'list',
        description: 'Return the fixed value.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        outputSchema: { description: 'Any JSON data.' },
      }],
    },
    query: () => Promise.resolve(answer),
  }
}

async function registry(): Promise<CordisInspectRegistryService> {
  const ctx = new Context()
  await ctx.plugin(CordisInspectRegistryService)
  return ctx.cordisInspect
}

const query = (inspect: CordisInspectRegistryService) =>
  inspect.query('host', 'Service', 'list', undefined, AGENT, new AbortController().signal)

describe('Host Cordis inspect provider registration', () => {
  it('lets an identical provider join a live one, and the newest answers', async () => {
    const inspect = await registry()
    const disposeOlder = inspect.register(provider('older'))
    const disposeNewer = inspect.register(provider('newer'))

    expect(inspect.list().filter(entry => entry.platform === 'host')).toHaveLength(1)
    expect(await query(inspect)).toBe('newer')

    disposeNewer()
    expect(await query(inspect)).toBe('older')
    disposeNewer()
    expect(await query(inspect)).toBe('older')

    disposeOlder()
    expect(inspect.list()).toEqual([])
    await expect(query(inspect)).rejects.toThrow('Host Cordis inspect provider "Service" is not registered')
  })

  it('keeps the newest answering when an older registration is disposed first', async () => {
    const inspect = await registry()
    const disposeOlder = inspect.register(provider('older'))
    inspect.register(provider('newer'))

    disposeOlder()

    expect(await query(inspect)).toBe('newer')
  })

  it('refuses a different provider under a live id', async () => {
    const inspect = await registry()
    inspect.register(provider('older'))

    expect(() => inspect.register(provider('other', 'A different provider.')))
      .toThrow('Host Cordis inspect provider "Service" is already registered with a different manifest')
    expect(await query(inspect)).toBe('older')
  })
})
