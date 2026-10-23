import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import IdentityUsers from '@aeven/identity-user'
import type { IndexInjection } from '@aeven/host-webserver'
import { apply, Config } from '../src/index.ts'

/** Apply the plugin and read the row it injects for one request origin. */
async function injected(config: Parameters<typeof Config>[0], origin?: string): Promise<Record<string, unknown>> {
  const ctx = new Context()
  const users = new IdentityUsers(ctx)
  ;(ctx as unknown as { identityUsers: IdentityUsers }).identityUsers = users
  await apply(ctx, Config(config))
  const table: IndexInjection[] = []
  ctx.emit('webserver/index-inject', table, origin)
  const row = table[0]
  if (row === undefined || row.kind !== 'global') throw new Error(`expected one global row, got ${JSON.stringify(row)}`)
  return row.value as Record<string, unknown>
}

const LOOPBACK_CONFIG = {
  apiUrl: 'http://127.0.0.1:9000',
  webUrl: 'http://127.0.0.1:9020',
  mediaUrl: 'http://127.0.0.1:9040/media',
  googleOAuthUrl: 'http://127.0.0.1:9000/oauth/google',
  oauthFlow: 'window' as const,
}

describe('loopback spellings in the injected page config', () => {
  it('states each deployment URL under the spelling the request arrived on', async () => {
    // A reader who opened `localhost:3060` from a bookmark: the page and every
    // URL it addresses must be one origin, or the browser treats the API as a
    // different site than the page and the session cookie does not travel.
    expect(await injected(LOOPBACK_CONFIG, 'http://localhost:3060')).toEqual({
      apiUrl: 'http://localhost:9000',
      webUrl: 'http://localhost:9020',
      mediaUrl: 'http://localhost:9040/media',
      googleOAuthUrl: 'http://localhost:9000/oauth/google',
      oauthFlow: 'window',
    })
  })

  it('keeps the configured spelling when the page arrived on it', async () => {
    expect(await injected(LOOPBACK_CONFIG, 'http://127.0.0.1:3060')).toMatchObject({
      apiUrl: 'http://127.0.0.1:9000',
      googleOAuthUrl: 'http://127.0.0.1:9000/oauth/google',
    })
  })

  it('leaves a real deployment and a provider domain untouched', async () => {
    const deployment = {
      apiUrl: 'https://aeven.ai',
      googleOAuthUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      oauthFlow: 'redirect' as const,
    }

    expect(await injected(deployment, 'http://127.0.0.1:3060')).toEqual(deployment)
    expect(await injected(deployment, 'https://aeven.ai')).toEqual(deployment)
  })

  it('does not move a loopback URL onto a page served by a real host', async () => {
    expect(await injected(LOOPBACK_CONFIG, 'https://staging.aeven.ai')).toMatchObject({
      apiUrl: 'http://127.0.0.1:9000',
    })
  })

  it('states the configured values when the emission carries no request origin', async () => {
    expect(await injected(LOOPBACK_CONFIG, undefined)).toMatchObject({
      apiUrl: 'http://127.0.0.1:9000',
      webUrl: 'http://127.0.0.1:9020',
      mediaUrl: 'http://127.0.0.1:9040/media',
    })
  })

  it('hands over a value it cannot parse as stated', async () => {
    // Not a URL: the deployment stated something this cannot reason about, and
    // reconstructing it would be worse than passing it through.
    expect(await injected({ webUrl: 'not-a-url' }, 'http://localhost:3060')).toMatchObject({
      webUrl: 'not-a-url',
    })
  })

  it('fails the load when apiUrl cannot address the published key set', async () => {
    // Unlike the page-config URLs above, `apiUrl` is also read by the key set,
    // which needs an addressable URL. The load refuses it there rather than
    // serving a page whose every token fails to verify.
    const ctx = new Context()
    const users = new IdentityUsers(ctx)
    ;(ctx as unknown as { identityUsers: IdentityUsers }).identityUsers = users
    await expect(apply(ctx, Config({ apiUrl: 'not-a-url' }))).rejects.toThrow('Invalid URL')
  })
})

describe('provider sign-in flow', () => {
  it('refuses a provider URL that states no flow', async () => {
    // The flow says how the page reaches its provider, and only the deployment
    // knows which it can do. A page served without one cannot start a sign-in.
    const ctx = new Context()
    const users = new IdentityUsers(ctx)
    ;(ctx as unknown as { identityUsers: IdentityUsers }).identityUsers = users
    await expect(apply(ctx, Config({
      apiUrl: 'http://127.0.0.1:9000',
      googleOAuthUrl: 'http://127.0.0.1:9000/oauth/google',
    }))).rejects.toThrow('oauthFlow is required when a provider URL is configured')
  })

  it('ignores a stated flow when the deployment offers no provider', async () => {
    // No provider URL means no sign-in for the flow to describe, so the page
    // states none rather than one nothing reads.
    expect(await injected({ apiUrl: 'http://127.0.0.1:9000', oauthFlow: 'redirect' }, 'http://127.0.0.1:3060'))
      .not.toHaveProperty('oauthFlow')
  })
})
