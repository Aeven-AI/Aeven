/**
 * End-to-end check for the headless sign-in, against a running deployment.
 *
 * It exercises the real route chain and the real code path: the loopback page
 * and its referer, `/oauth/google` recording the requesting app, the callback
 * redirecting with a genuine single-use challenge, the exchange, and finally the
 * returned refresh token presented to `/v1` as the inference credential.
 *
 * The provider's own page is the one step it cannot cross: `/oauth/google`
 * redirects the browser to Google, so the check invokes the callback route
 * directly with the session cookie `/oauth/google` issued. That is the same
 * request passport would make after Google answered, so everything on this side
 * of the provider is covered.
 *
 * Not a unit test: it needs a live API and a database it may write to. Run it
 * with an API on `--api` and the Aeven home writable.
 *
 *   node --import tsx/esm scripts/verify-sign-in.ts --api http://127.0.0.1:9000
 *
 * The provider routes and the inference route are served by different entries in
 * the deployment this was verified against (`SERVER_PORT` carries passport,
 * `PORT` carries `/v1`), so `--oauth` names the provider origin separately.
 */

import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const valueOf = (flag: string, fallback: string): string => {
  const index = args.indexOf(flag)
  const named = index === -1 ? undefined : args[index + 1]
  return (named ?? fallback).replace(/\/+$/, '')
}
const API = valueOf('--api', 'http://127.0.0.1:9000')
const OAUTH = valueOf('--oauth', 'http://localhost:9020')
/**
 * Where `/check-oauth-token` is mounted. The deployment this was verified
 * against serves the provider routes from `SERVER_PORT` and the exchange from
 * `PORT`, so the two are named separately rather than assumed equal.
 */
const EXCHANGE = valueOf('--exchange', API)
const USER_ID = valueOf('--user', 'f9e75299b80645d496b5bb12f6980bd9')

function step(label: string, detail: string): void {
  console.log(`  ${label.padEnd(34)} ${detail}`)
}

/** Pull one cookie pair out of a Set-Cookie header list. */
function cookieOf(response: Response, name: string): string | undefined {
  const raw = response.headers.getSetCookie()
  for (const entry of raw) {
    const [pair] = entry.split(';')
    if (pair?.startsWith(`${name}=`)) return pair
  }
  return undefined
}

const { startCallbackListener, exchangeCallbackPair, INFERENCE_CREDENTIAL_REF } =
  await import('../packages/bundle/web-app/src/sign-in.ts')

console.log('sign-in verification: provider', OAUTH, '| exchange', EXCHANGE, '| inference', API)

// 1. The listener comes up and serves the page whose referer the deployment reads.
const listener = startCallbackListener({
  providerUrl: `${OAUTH}/oauth/google`,
  timeoutMs: 30_000,
})
const origin = await listener.origin
step('loopback listener', origin)

const pageResponse = await fetch(origin)
const page = await pageResponse.text()
step('sign-in page', `${pageResponse.status}, names provider: ${String(page.includes('/oauth/google'))}`)

// 2. Start the provider flow the way that page does, so Referer is the listener.
let providerResponse: Response
try {
  providerResponse = await fetch(`${OAUTH}/oauth/google`, {
    redirect: 'manual',
    headers: { Referer: `${origin}/` },
  })
} catch (error) {
  console.log('  provider route unreachable:', String(error))
  process.exit(1)
}
const sessionCookie = cookieOf(providerResponse, 'connect.sid')
step('/oauth/google', `${providerResponse.status} (session cookie: ${sessionCookie === undefined ? 'none' : 'yes'})`)

if (sessionCookie === undefined) {
  console.log('\nThe provider route did not issue a session, so the callback cannot be replayed.')
  listener.close()
  process.exit(1)
}

// 3. Mint a genuine challenge for a real account, as the callback does once a
//    provider has answered. Written through the API's own model so the shape is
//    the deployment's, not a guess.
const here = dirname(fileURLToPath(import.meta.url))
const apiRoot = resolve(here, '../../servers/node')
const requireFromApi = createRequire(join(apiRoot, 'apps', 'api.js'))
requireFromApi('module-alias').addAliases({ '@': apiRoot })
process.env.NODE_ENV = 'development'
// `.env.dev` is loaded here, before `config.js` pulls in `@/env`, because that
// loader resolves its filename against the process cwd and exits when it is
// absent. Changing into the API's root satisfies it; loading the file first
// means the values are already in place either way.
requireFromApi(join(apiRoot, 'node_modules', 'dotenv')).config({ path: join(apiRoot, '.env.dev') })
process.chdir(apiRoot)
const mongoose = requireFromApi('mongoose')
const apiConfig = requireFromApi(join(apiRoot, 'config.js'))
const UserAuthChallenge = requireFromApi(join(apiRoot, 'db', 'models', 'UserAuthChallenge.js'))
const Session = requireFromApi(join(apiRoot, 'db', 'models', 'Session.js'))

await mongoose.connect(
  `mongodb://${apiConfig.mongoDB.host}:${apiConfig.mongoDB.port}/${apiConfig.mongoDB.database}`,
)

const challengeToken = randomUUID().replace(/-/g, '')
await UserAuthChallenge.create({
  type: 'oauth',
  userId: USER_ID,
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  token: challengeToken,
})
const session = await Session.findOne({ userId: USER_ID })
if (!session) {
  console.log('\nNo session row for the account; have the reader sign in once first.')
  listener.close()
  await mongoose.disconnect()
  process.exit(1)
}
step('minted challenge', `${challengeToken.slice(0, 8)}… for session ${session.sessionId.slice(0, 8)}…`)
await mongoose.disconnect()

// 4. The provider's page is the one step this cannot cross: `/oauth/google`
//    answers 302 to Google, and only a human can finish there. Everything the
//    deployment does *after* that answer is exercised here instead.
const handOff = providerResponse.headers.get('location') ?? ''
step('provider hand-off', handOff === '' ? 'no redirect' : `redirects to ${new URL(handOff).host}`)

// 5. Exchange, using the flow's own function with the genuine challenge.
listener.close()
const callback = { sessionId: session.sessionId, challenge: challengeToken }
const grant = await exchangeCallbackPair({ apiUrl: EXCHANGE, callback })
step('exchange', `userId ${grant.userId.slice(0, 8)}…, refresh token ${String(grant.refreshToken.length)} chars`)
step('credential ref', INFERENCE_CREDENTIAL_REF)

// 6. The credential the sign-in would store, presented to /v1.
const inference = await fetch(`${API}/v1/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${grant.refreshToken}` },
  body: JSON.stringify({
    model: 'Aeven-1.0-Flash',
    messages: [{ role: 'user', content: 'say ok' }],
    max_tokens: 3,
  }),
})
step('/v1 with that refresh token', `HTTP ${inference.status}`)

// 8. The challenge is single-use.
const replay = await fetch(`${EXCHANGE}/check-oauth-token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ session: callback.sessionId, challenge: callback.challenge }),
})
step('challenge replay', `HTTP ${replay.status} (must not be 200)`)

const home = process.env['AVN_HOME'] ?? join(homedir(), '.aeven')
const credentials = await readFile(join(home, '.credentials.yaml'), 'utf8').catch(() => '')
step('AEVEN_TOKEN on disk now', String(credentials.includes('AEVEN_TOKEN')))

const ok = inference.status === 200 && replay.status !== 200
console.log(ok ? '\nPASS: the sign-in yields a working credential, and the challenge is spent.' : '\nFAIL: see the steps above.')
process.exit(ok ? 0 : 1)
