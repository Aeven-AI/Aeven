/**
 * Host-plane provider of the confirmed-invariants document.
 *
 * One row in the Host composition owns the owner's invariants: it resolves where they live, enforces the
 * block's budget, and publishes {@link MemoryInvariants} for the two Consumers — the per-session block that
 * `memory-context` renders into the system prompt, and the management Remote behind Settings → Memory. Both
 * planes reach one instance and one budget, so a statement the management surface accepts is exactly what the
 * prompt assembles.
 *
 * @module @aeven/memory-invariants
 */
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { InvariantStore } from './invariants.ts'
import type { MemoryInvariants } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The owner's confirmed invariants; present once this plugin is loaded. */
    memoryInvariants?: MemoryInvariants
  }
}

export const name = 'memory-invariants'

/** Reads the owner's document from disk and holds no service of its own. */
export const inject: string[] = []

/** Provider configuration. */
export interface Config {
  /** Absolute directory holding one document per owner. */
  root: string
  /**
   * Bound on the rendered content of one owner's block, framing and item lines included. It is paid for on every
   * request, so it stays bounded, and every write is refused rather than clipped when a statement would not fit.
   * The shipped default holds roughly twenty statements: the block is stable while the user leaves it alone, so it
   * sits in the cached prompt prefix, and it is the user's own floor rather than retrieved context.
   */
  maxChars: number
}

export const Config: z<Config> = z.object({
  root: z.string().min(1).required(),
  maxChars: z.natural().min(0).default(1500),
})

/**
 * Publish the invariants document.
 * @param ctx - Host context that receives the `memoryInvariants` service.
 * @param config - validated provider configuration.
 * @throws when the configured root is not an absolute directory.
 */
export function apply(ctx: Context, config: Config): void {
  if (!isAbsolute(config.root)) throw new Error(`memory-invariants root must be absolute: ${config.root}`)
  const store = new InvariantStore(config.root, config.maxChars)
  ctx.effect(() => ctx.provide('memoryInvariants', store), 'memory-invariants.service')
  ctx.logger(name).info('invariants ready (root=%s, maxChars=%d)', config.root, config.maxChars)
}
