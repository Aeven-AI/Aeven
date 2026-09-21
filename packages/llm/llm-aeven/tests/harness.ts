/**
 * Harness-home and stream drivers shared by this package's specs: a temporary
 * `$AVN_HOME` so requests mint the anonymous user id outside the developer's
 * home, and one `ctx.llm.stream()` driver assembling the same chunks the agent
 * loop consumes.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'
import { BlockAssembler } from '@aeven/llm'
import type { Context } from '@deepseek-ai/cordis'
import type { FinishReason, GenerateOptions, Message, TokenUsage } from '@aeven/llm'
import { PROVIDER } from '../src/index.ts'

/** What one assembled generation produced. */
export interface GeneratedResult {
  /** The assembled assistant message. */
  message: Message
  /** Provider-reported usage, present only when the stream carried it. */
  usage?: TokenUsage
  /** How the generation ended. */
  finish: FinishReason
}

/** Temporary harness homes minted by {@link tempHome}, removed by {@link cleanupTempHomes}. */
const homes: string[] = []

/**
 * Point `$AVN_HOME` at a fresh temporary directory, so a streaming request
 * writes its minted anonymous user id there rather than into the home of
 * whoever runs the suite.
 * @returns the new home's absolute path.
 */
export async function tempHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'avn-llm-aeven-'))
  homes.push(home)
  vi.stubEnv('AVN_HOME', home)
  return home
}

/** Remove every temporary harness home; each spec calls this from `afterEach`. */
export async function cleanupTempHomes(): Promise<void> {
  await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true })))
}

/**
 * Run one generation against the `aeven-cloud` route.
 * @param ctx - context with the LLM runtime and this plugin mounted.
 * @param model - wire model id to request.
 * @param options - extra request facts; `messages` defaults to empty.
 * @returns the assembled message, usage, and finish reason.
 */
export async function generate(
  ctx: Context,
  model: string,
  options: Partial<Omit<GenerateOptions, 'provider' | 'model'>> = {},
): Promise<GeneratedResult> {
  const assembler = new BlockAssembler()
  const request: GenerateOptions = { provider: PROVIDER, model, messages: [], ...options }
  for await (const chunk of ctx.llm.stream(request)) assembler.push(chunk)
  return {
    message: assembler.message({ kind: 'model', provider: PROVIDER, model }),
    ...assembler.usage === undefined ? {} : { usage: assembler.usage },
    finish: assembler.finish,
  }
}
