import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  CAPABILITY_SETTINGS_PATH,
  CLAUDE_CODE_OAUTH_ROUTE,
  CODEX_OAUTH_FAST_ROUTE,
  CODEX_OAUTH_ROUTE,
  CODING_OAUTH_ROUTES,
  GROK_BUILD_ROUTE,
  OAUTH_IMPORT_SOURCES_PATH,
  SUBSCRIPTION_USAGE_PATH_PREFIX,
} from '../src/ids.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('bundle composition', () => {
  it('inserts the grok-build host plugin and a Grok Build default model', async () => {
    const patch = await readFile(join(root, 'cordis.patch.yml'), 'utf8')
    expect(patch).toContain('provider: grok-build')
    expect(patch).toMatch(/model: grok-4\./)
    expect(patch).toContain('id: llm-grok-build-oauth')
    expect(patch).toContain('name: "@aeven/experimental-subscription-auth"')
  })

  it('exposes collision-free OAuth route aliases', async () => {
    expect([GROK_BUILD_ROUTE, CODEX_OAUTH_ROUTE, CLAUDE_CODE_OAUTH_ROUTE]).toEqual([
      'grok-build',
      'codex-oauth',
      'claude-code-oauth',
    ])
    expect(CODING_OAUTH_ROUTES).toEqual([GROK_BUILD_ROUTE, CODEX_OAUTH_ROUTE, CLAUDE_CODE_OAUTH_ROUTE])
    const source = await readFile(join(root, 'src/index.ts'), 'utf8')
    expect(source).toContain('[...CODING_OAUTH_ROUTES]')
    expect(source).toContain('registerCodingOAuthRoutes')
  })

  it('serves the owner routes the capability client calls', () => {
    // Asserted on the exported constants rather than the bundle text: the
    // harness build leaves `dsh-coding-oauth-core` external, so the route
    // literals it owns no longer appear inlined in `lib/index.js`. What the
    // client depends on is the path values, which are checked directly.
    expect(OAUTH_IMPORT_SOURCES_PATH).toBe('/plugins/dsh-grok-build/oauth/sources')
    expect(CAPABILITY_SETTINGS_PATH).toBe('/plugins/dsh-grok-build/capabilities')
    expect(CODEX_OAUTH_FAST_ROUTE).toBe('codex-oauth-fast')
    expect(SUBSCRIPTION_USAGE_PATH_PREFIX).toBe('/plugins/dsh-grok-build/usage/')
  })

  it('keeps the model-facing tool registry out of the shipped host bundle', async () => {
    const server = await readFile(join(root, 'lib/index.js'), 'utf8')
    const imports = server.match(/^import .*$/gm) ?? []
    expect(imports.some(statement => statement.includes('"@aeven/tools"'))).toBe(false)
  })

  it('declares a dsh bundle and web client half', async () => {
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
      name: string
      dsh: { bundle: { patch: string }; client: { platform: string; inject: string[] } }
      exports: Record<string, unknown>
    }
    expect(manifest.name).toBe('@aeven/experimental-subscription-auth')
    expect((manifest as { version?: string }).version).toBe('0.1.2-alpha.5')
    expect((manifest as { dependencies?: Record<string, string> }).dependencies?.['dsh-coding-oauth-core']).toBe(
      '0.1.2',
    )
    expect((manifest as { dependencies?: Record<string, string> }).dependencies?.undici).toBe('7.29.0')
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(manifest.dsh.client.platform).toBe('web')
    expect(manifest.dsh.client.inject).toContain('@aeven/client-ui-settings')
    expect(manifest.exports['./client']).toMatchObject({ default: './lib/client.js' })
  })
})
