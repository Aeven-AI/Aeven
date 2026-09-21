/**
 * Session credential resolution: the credentials seam first, the launching
 * environment second, and a refusal naming the remedy when neither holds a
 * session — plus the stable anonymous user id every request carries.
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@aeven/llm'
import { ANONYMOUS_USER_ID_FILE_NAME } from '@aeven/anonymous-user-id'
import * as LlmAeven from '../src/index.ts'
import { DEFAULT_API_KEY_ENV, PROVIDER } from '../src/index.ts'
import { stubChatCompletions } from './chat-double.ts'
import { StubCredentials } from './credentials-double.ts'
import { cleanupTempHomes, generate, tempHome } from './harness.ts'

let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  await cleanupTempHomes()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

/** Mount the LLM runtime with this plugin's route on a fresh context. */
async function mountRoute(): Promise<Context> {
  const mounted = new Context()
  await mounted.plugin(LlmRuntime)
  await mounted.plugin(LlmAeven, {})
  return mounted
}

describe('session credential resolution', () => {
  it('prefers the session a credentials service mounted after the route holds', async () => {
    await tempHome()
    vi.stubEnv(DEFAULT_API_KEY_ENV, 'ambient-token')
    const calls = stubChatCompletions()
    ctx = await mountRoute()
    // The seam is optional and read per request, so a sign-in that lands after
    // the mount is usable on the very next call.
    await ctx.plugin(StubCredentials, { [DEFAULT_API_KEY_ENV]: 'session-token' })

    const result = await generate(ctx, 'Aeven-1.0-Flash')

    expect(calls[0]?.headers.authorization).toBe('Bearer session-token')
    expect(result.finish).toEqual({ kind: 'stop' })
  })

  it('falls back to the launching environment while the seam holds no value', async () => {
    await tempHome()
    vi.stubEnv(DEFAULT_API_KEY_ENV, 'ambient-token')
    const calls = stubChatCompletions()
    ctx = await mountRoute()
    await ctx.plugin(StubCredentials)

    await generate(ctx, 'Aeven-1.0-Flash')

    expect(calls[0]?.headers.authorization).toBe('Bearer ambient-token')
  })

  it('falls back to the launching environment when the seam answers with an empty value', async () => {
    await tempHome()
    vi.stubEnv(DEFAULT_API_KEY_ENV, 'ambient-token')
    const calls = stubChatCompletions()
    ctx = await mountRoute()
    await ctx.plugin(StubCredentials, { [DEFAULT_API_KEY_ENV]: '' })

    await generate(ctx, 'Aeven-1.0-Flash')

    expect(calls[0]?.headers.authorization).toBe('Bearer ambient-token')
  })

  it('refuses with MISSING_CREDENTIAL, naming the remedy, when no session resolves', async () => {
    await tempHome()
    vi.stubEnv(DEFAULT_API_KEY_ENV, undefined)
    const calls = stubChatCompletions()
    ctx = await mountRoute()

    const result = await generate(ctx, 'Aeven-1.0-Flash')

    expect(result.finish).toMatchObject({ kind: 'error', failure: { code: 'MISSING_CREDENTIAL' } })
    if (result.finish.kind !== 'error') throw new Error('expected an error finish')
    // The remedy, not a key hunt: a key is not what is missing.
    expect(result.finish.failure.message).toBe(
      `llm-aeven: no Aeven session for provider route "${PROVIDER}"; sign in, or store`
      + ` ${DEFAULT_API_KEY_ENV} through the credentials service when running headless`,
    )
    expect(calls).toEqual([])
  })

  it('treats an empty ambient reference as no session at all', async () => {
    await tempHome()
    vi.stubEnv(DEFAULT_API_KEY_ENV, '')
    const calls = stubChatCompletions()
    ctx = await mountRoute()

    const result = await generate(ctx, 'Aeven-1.0-Flash')

    expect(result.finish).toMatchObject({ kind: 'error', failure: { code: 'MISSING_CREDENTIAL' } })
    expect(calls).toEqual([])
  })

  it('mints one anonymous user id and attributes every later request to it', async () => {
    const home = await tempHome()
    vi.stubEnv(DEFAULT_API_KEY_ENV, 'ambient-token')
    const calls = stubChatCompletions()
    ctx = await mountRoute()

    await generate(ctx, 'Aeven-1.0-Flash')

    const id = (await readFile(join(home, ANONYMOUS_USER_ID_FILE_NAME), 'utf8')).trim()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(calls[0]?.headers['x-aeven-user-id']).toBe(id)

    // Identity is resolved once per mounted route: pointing the harness home
    // elsewhere cannot move the attribution of a route already serving.
    const moved = await tempHome()
    await generate(ctx, 'Aeven-1.0-Flash')
    expect(calls[1]?.headers['x-aeven-user-id']).toBe(id)
    expect(existsSync(join(moved, ANONYMOUS_USER_ID_FILE_NAME))).toBe(false)
  })
})
