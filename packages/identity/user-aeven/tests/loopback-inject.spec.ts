import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import IdentityUsers from '@aeven/identity-user'
import type { IndexInjection } from '@aeven/host-webserver'
import { apply, Config } from '../src/index.ts'

/** Apply the plugin and read the row it injects for one request origin. */
function injected(config: Parameters<typeof Config>[0], origin?: string): Record<string, unknown> {
  const ctx = new Context()
  const users = new IdentityUsers(ctx)
  ;(ctx as unknown as { identityUsers: IdentityUsers }).identityUsers = users
  apply(ctx, Config(config))
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
  it('states each deployment URL under the spelling the request arrived on', () => {
    // A reader who opened `localhost:3060` from a bookmark: the page and every
    // URL it addresses must be one origin, or the browser treats the API as a
    // different site than the page and the session cookie does not travel.
    expect(injected(LOOPBACK_CONFIG, 'http://localhost:3060')).toEqual({
      apiUrl: 'http://localhost:9000',
      webUrl: 'http://localhost:9020',
      mediaUrl: 'http://localhost:9040/media',
      googleOAuthUrl: 'http://localhost:9000/oauth/google',
      oauthFlow: 'window',
    })
  })

  it('keeps the configured spelling when the page arrived on it', () => {
    expect(injected(LOOPBACK_CONFIG, 'http://127.0.0.1:3060')).toMatchObject({
      apiUrl: 'http://127.0.0.1:9000',
      googleOAuthUrl: 'http://127.0.0.1:9000/oauth/google',
    })
  })

  it('leaves a real deployment and a provider domain untouched', () => {
    const deployment = {
      apiUrl: 'https://aeven.ai',
      googleOAuthUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      oauthFlow: 'redirect' as const,
    }

    expect(injected(deployment, 'http://127.0.0.1:3060')).toEqual(deployment)
    expect(injected(deployment, 'https://aeven.ai')).toEqual(deployment)
  })

  it('does not move a loopback URL onto a page served by a real host', () => {
    expect(injected(LOOPBACK_CONFIG, 'https://staging.aeven.ai')).toMatchObject({
      apiUrl: 'http://127.0.0.1:9000',
    })
  })

  it('states the configured values when the emission carries no request origin', () => {
    expect(injected(LOOPBACK_CONFIG, undefined)).toMatchObject({
      apiUrl: 'http://127.0.0.1:9000',
      webUrl: 'http://127.0.0.1:9020',
      mediaUrl: 'http://127.0.0.1:9040/media',
    })
  })

  it('hands over a value it cannot parse as stated', () => {
    // Not a URL: the deployment stated something this cannot reason about, and
    // reconstructing it would be worse than passing it through.
    expect(injected({ apiUrl: 'not-a-url' }, 'http://localhost:3060')).toMatchObject({
      apiUrl: 'not-a-url',
    })
  })
})
