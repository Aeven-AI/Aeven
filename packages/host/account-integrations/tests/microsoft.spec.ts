/**
 * The Microsoft Graph bridge descriptors: the combined Microsoft 365 connector serves the five
 * services' tools and permissions together, for work or school accounts only.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { microsoftConnection, microsoftService } from '../src/microsoft.ts'

const services = ['outlook', 'outlook-calendar', 'onedrive', 'sharepoint', 'teams'] as const

describe('Microsoft 365 descriptor', () => {
  const directories: string[] = []
  afterEach(async () => {
    for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
  })

  it('covers every tool and permission of the five services, once each', () => {
    const combined = microsoftService('microsoft-365')
    if (combined === undefined) throw new Error('Microsoft 365 descriptor is missing')
    for (const list of ['read', 'write', 'scopes'] as const) {
      const expected = new Set(services.flatMap(provider => microsoftService(provider)?.[list] ?? []))
      expect(new Set(combined[list]), list).toEqual(expected)
      expect(combined[list].length, list).toBe(expected.size)
    }
    expect(combined.read.filter(tool => combined.write.includes(tool))).toEqual([])
  })

  it('runs the bridge in organization mode with the combined tool allowlist', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'avn-m365-'))
    directories.push(directory)
    const config = await microsoftConnection('microsoft-365', 'token', join(directory, 'connector'), 1_000)
    expect(config.args).toContain('--org-mode')
    const combined = microsoftService('microsoft-365')
    expect(new Set(config.allowedTools)).toEqual(new Set([...combined?.read ?? [], ...combined?.write ?? []]))
    expect(config.env.MS365_MCP_OAUTH_TOKEN).toBe('token')
  })

  it('keeps the individual services as they are', () => {
    expect(microsoftService('outlook')?.org).toBe(false)
    expect(microsoftService('teams')?.org).toBe(true)
    expect(microsoftService('github')).toBeUndefined()
  })
})
