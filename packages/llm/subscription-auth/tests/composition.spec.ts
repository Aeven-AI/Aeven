import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  CAPABILITY_SETTINGS_PATH,
  CODEX_OAUTH_FAST_ROUTE,
  CODEX_OAUTH_ROUTE,
  CODING_OAUTH_ROUTES,
  GROK_BUILD_ROUTE,
  OAUTH_IMPORT_SOURCES_PATH,
  SUBSCRIPTION_USAGE_PATH_PREFIX,
} from '../src/ids.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('bundle composition', () => {
  it('inserts the grok-build host plugin and leaves the deployment default model alone', async () => {
    const patch = await readFile(join(root, 'cordis.patch.yml'), 'utf8')
    expect(patch).toContain('id: llm-grok-build-oauth')
    expect(patch).toContain('name: "@aeven/subscription-auth"')
    // The patch serves a route only once its subscription is signed in, so it
    // adds no provider or model default over the base composition.
    expect(patch).not.toContain('provider: grok-build')
    expect(patch).not.toMatch(/model: grok-4\./)
  })

  it('exposes collision-free OAuth route aliases', async () => {
    expect([GROK_BUILD_ROUTE, CODEX_OAUTH_ROUTE]).toEqual(['grok-build', 'codex-oauth'])
    expect(CODING_OAUTH_ROUTES).toEqual([GROK_BUILD_ROUTE, CODEX_OAUTH_ROUTE])
    const source = await readFile(join(root, 'src/index.ts'), 'utf8')
    expect(source).toContain('[...CODING_OAUTH_ROUTES]')
    expect(source).toContain('registerCodingOAuthRoutes')
  })

  it('serves the owner routes the capability client calls', () => {
    // Asserted on the exported constants rather than the bundle text: the
    // harness build leaves `dsh-coding-oauth-core` external, so the route
    // literals it owns no longer appear inlined in `lib/index.js`. What the
    // client depends on is the path values, which are checked directly.
    //
    // Two owners share this namespace, so the two halves are pinned apart.
    // `dsh-coding-oauth-core` is a published npm package we do not patch, so
    // the paths it exports keep its own prefix; the host and the client both
    // derive them from that package and therefore agree. Paths this fork
    // builds itself start from `CODING_OAUTH_API_BASE` below.
    expect(OAUTH_IMPORT_SOURCES_PATH).toBe('/plugins/dsh-grok-build/oauth/sources')
    expect(CAPABILITY_SETTINGS_PATH).toBe('/plugins/dsh-grok-build/capabilities')
    expect(CODEX_OAUTH_FAST_ROUTE).toBe('codex-oauth-fast')
    expect(SUBSCRIPTION_USAGE_PATH_PREFIX).toBe('/plugins/avn-grok-build/usage/')
  })

  it('declares an avn bundle and web client half', async () => {
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
      name: string
      avn: { bundle: { patch: string }; client: { platform: string; inject: string[] } }
      exports: Record<string, unknown>
    }
    expect(manifest.name).toBe('@aeven/subscription-auth')
    const workspace = JSON.parse(await readFile(join(root, '..', '..', '..', 'package.json'), 'utf8')) as {
      version: string
    }
    // Every @aeven package ships the workspace version, so the manifest tracks it.
    expect((manifest as { version?: string }).version).toBe(workspace.version)
    expect((manifest as { dependencies?: Record<string, string> }).dependencies?.['dsh-coding-oauth-core']).toBe(
      '0.1.2',
    )
    expect((manifest as { dependencies?: Record<string, string> }).dependencies?.undici).toBe('7.29.0')
    expect(manifest.avn.bundle.patch).toBe('./cordis.patch.yml')
    expect(manifest.avn.client.platform).toBe('web')
    expect(manifest.avn.client.inject).toContain('@aeven/client-ui-settings')
    expect(manifest.exports['./client']).toMatchObject({ default: './lib/client.js' })
  })
})
