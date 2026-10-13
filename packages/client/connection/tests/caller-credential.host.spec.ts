/** The caller's credential crossing from authentication into whoever else presents it. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { credentialRef, type CredentialProvider, type CredentialRef } from '@aeven/credentials'
import type { IdentityUsers } from '@aeven/identity-user'
import type { BrowserAuth } from '../src/browser-auth.ts'
import { HostConnectionService } from '../src/rpc-host.ts'
import type { ConnectionTrustRequest } from '../src/rpc.ts'

const SESSION = credentialRef('AEVEN_TOKEN')

/** One publication: the reference named, the caller it belongs to, and the bearer that request presented. */
type Publication = readonly [CredentialRef, string, string | undefined]

/** Authority double that names one reference and reads the caller from the bearer, as an authority recognizing the request does. */
const recognizing = (ref: CredentialRef): IdentityUsers =>
  ({
    credentialRefFor: () => ref,
    resolve: (request: ConnectionTrustRequest) => {
      const headers = request.headers
      const authorization = headers instanceof Headers ? headers.get('authorization') : headers.authorization
      return { id: `user-of:${String(authorization).trim().split(/\s+/u)[1]}` }
    },
  }) as unknown as IdentityUsers

/** Authority double that recognizes nobody, as a launch-token composition does. */
const unrecognizing = (): IdentityUsers =>
  ({ credentialRefFor: () => undefined, resolve: () => undefined }) as unknown as IdentityUsers

/** Credential provider double recording every session publication it is handed. */
function recording(published: Publication[]): CredentialProvider {
  return {
    setSession: (ref: CredentialRef, user: string, value: string | undefined) => { published.push([ref, user, value]) },
  } as unknown as CredentialProvider
}

/** Mount the Host connection service with whichever seams the caller provides. */
async function mounted(seams: {
  identity?: IdentityUsers
  credentials?: CredentialProvider
} = {}): Promise<{ connection: HostConnectionService; dispose: () => Promise<void> }> {
  const ctx = new Context()
  if (seams.identity !== undefined) ctx.provide('identityUsers', seams.identity)
  if (seams.credentials !== undefined) ctx.provide('credentials', seams.credentials)
  const fiber = ctx.plugin((pluginCtx) => {
    new HostConnectionService(pluginCtx, [], {} as BrowserAuth)
  })
  await fiber.await()
  return {
    connection: ctx.get('connection') as HostConnectionService,
    dispose: () => fiber.dispose(),
  }
}

/** Headers a Fetch carrier presents. */
const fetchRequest = (authorization?: string): ConnectionTrustRequest =>
  ({ headers: new Headers(authorization === undefined ? {} : { authorization }) })

/** Headers a node:http carrier presents. */
const nodeRequest = (authorization?: string | readonly string[]): ConnectionTrustRequest =>
  ({ headers: authorization === undefined ? {} : { authorization } })

describe('connection caller-credential publication', () => {
  it('publishes the bearer a request presented under the reference the authority named', async () => {
    const published: Publication[] = []
    const { connection, dispose } = await mounted({
      identity: recognizing(SESSION),
      credentials: recording(published),
    })

    connection.publishCallerCredential(nodeRequest('Bearer token-a'))

    expect(published).toEqual([[SESSION, 'user-of:token-a', 'token-a']])
    await dispose()
  })

  it('publishes the bearer of each request, so a rotated token replaces the last one', async () => {
    const published: Publication[] = []
    const { connection, dispose } = await mounted({
      identity: recognizing(SESSION),
      credentials: recording(published),
    })

    // Nothing tracks expiry: the browser re-sends the new token and it is
    // published as it passes, which is what keeps the model route fresh.
    connection.publishCallerCredential(nodeRequest('Bearer first'))
    connection.publishCallerCredential(nodeRequest('Bearer rotated'))

    expect(published).toEqual([[SESSION, 'user-of:first', 'first'], [SESSION, 'user-of:rotated', 'rotated']])
    await dispose()
  })

  it('reads the bearer from Fetch Headers as well as a node header record', async () => {
    const published: Publication[] = []
    const { connection, dispose } = await mounted({
      identity: recognizing(SESSION),
      credentials: recording(published),
    })

    // RFC 7235: the scheme name is case-insensitive, and the token is the rest
    // of the field after it is trimmed.
    connection.publishCallerCredential(fetchRequest('BEARER token-b'))
    connection.publishCallerCredential(fetchRequest('bearer   padded  '))

    expect(published).toEqual([[SESSION, 'user-of:token-b', 'token-b'], [SESSION, 'user-of:padded', 'padded']])
    await dispose()
  })

  it('publishes nothing while no authority is mounted', async () => {
    const published: Publication[] = []
    const { connection, dispose } = await mounted({ credentials: recording(published) })

    connection.publishCallerCredential(nodeRequest('Bearer token-a'))

    // Unauthenticated harness: there is no reference to name, and the launch
    // token opens nothing upstream.
    expect(published).toEqual([])
    await dispose()
  })

  it('publishes nothing when the authority recognizes this request as no credential', async () => {
    const published: Publication[] = []
    const { connection, dispose } = await mounted({
      identity: unrecognizing(),
      credentials: recording(published),
    })

    connection.publishCallerCredential(nodeRequest('Bearer token-a'))

    expect(published).toEqual([])
    await dispose()
  })

  it('publishes nothing when the credential store has no in-memory layer', async () => {
    const { connection, dispose } = await mounted({ identity: recognizing(SESSION) })

    // No provider at all, and then one that implements only the durable half:
    // the capability is optional, so both are ordinary states rather than faults.
    expect(() => { connection.publishCallerCredential(nodeRequest('Bearer token-a')) }).not.toThrow()
    await dispose()

    const durableOnly = await mounted({
      identity: recognizing(SESSION),
      credentials: {} as unknown as CredentialProvider,
    })
    expect(() => { durableOnly.connection.publishCallerCredential(nodeRequest('Bearer token-a')) }).not.toThrow()
    await durableOnly.dispose()
  })

  it('publishes nothing for a request that presents no re-presentable credential', async () => {
    const published: Publication[] = []
    const { connection, dispose } = await mounted({
      identity: recognizing(SESSION),
      credentials: recording(published),
    })

    for (const request of [
      // Absent, and repeated into a header array — a repeated header names no
      // credential, matching the authority's own reading.
      nodeRequest(),
      nodeRequest(['Bearer one', 'Bearer two']),
      // Present but another scheme.
      nodeRequest('Basic YW5vbnltb3Vz'),
      // The bearer scheme naming an empty token.
      nodeRequest('Bearer '),
      // Fetch Headers carry the same cases.
      fetchRequest(),
      fetchRequest('Basic YW5vbnltb3Vz'),
    ]) {
      connection.publishCallerCredential(request)
    }

    expect(published).toEqual([])
    await dispose()
  })
})
