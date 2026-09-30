import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
// Literal specifiers: Vite cannot resolve a template-literal import against an `exports` map.
const SUBPATHS: Record<string, () => Promise<unknown>> = {
  'http-json': () => import('dsh-coding-oauth-core/http-json'),
  'grok-errors': () => import('dsh-coding-oauth-core/grok-errors'),
  'kimi-errors': () => import('dsh-coding-oauth-core/kimi-errors'),
  'gateway-protocol': () => import('dsh-coding-oauth-core/gateway-protocol'),
}

describe('oauth-core pin', () => {
  it('resolves published dsh-coding-oauth-core@0.1.2 helper subpaths', async () => {
    const pkg = require('dsh-coding-oauth-core/package.json') as { version: string; exports?: Record<string, unknown> }
    expect(pkg.version).toBe('0.1.2')
    for (const [subpath, load] of Object.entries(SUBPATHS)) {
      expect(pkg.exports?.[`./${subpath}`], subpath).toBeTruthy()
      await expect(load()).resolves.toBeTypeOf('object')
    }
  })
})
