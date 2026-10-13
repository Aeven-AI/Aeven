/**
 * The model-facing `get_location` tool over the `location/request` waterfall.
 *
 * The tool reads nothing itself. The client showing the session asks the
 * reader, whose approval of the location permission produces their device
 * position; they can decline instead. The model states why it needs the
 * location before the reader is asked. Without a client able to ask, the call
 * reports the location as unavailable.
 *
 * The wait is bounded by the tool timeout, `consentTimeoutMs`: a forwarded
 * waterfall stays pending until a connected client answers it, and a reader may
 * never answer the prompt.
 *
 * @module @aeven/tool-location
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { HarnessError } from '@aeven/llm'
import { scopeTarget } from '@aeven/scope'
import { MAX_TIMER_DELAY_MS } from '@aeven/timeout'
import { defineTool } from '@aeven/tools'
import type { LocationAnswer } from './types.ts'

export type { LocationAnswer, LocationRequestEvent } from './types.ts'

export const name = 'tool-location'
export const inject = ['tools', 'agents']

/** How precisely a shared location reaches the model, and how long the reader is given. Invalid values fail plugin load. */
export interface Config {
  /** `precise` passes the device reading through; `approximate` rounds it to about a kilometre. */
  precision?: 'precise' | 'approximate'
  /** Milliseconds the reader has to choose before the call fails as timed out. */
  consentTimeoutMs?: number
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  precision: z.union(['precise', 'approximate'] as const).default('precise'),
  consentTimeoutMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(120_000),
})

/** Decimal places kept by `approximate` precision: two places is about 1.1 km of latitude. */
const APPROXIMATE_DECIMALS = 2

/** The accuracy an `approximate` reading claims at best, in meters. */
const APPROXIMATE_ACCURACY_METERS = 1_100

/**
 * The model-facing text for one answer.
 * @param answer - the reader's choice.
 * @param precision - the configured precision.
 * @returns the tool result text.
 */
export function renderLocationAnswer(answer: LocationAnswer, precision: 'precise' | 'approximate'): string {
  switch (answer.kind) {
    case 'device': {
      const approximate = precision === 'approximate'
      const round = (value: number): number => approximate ? Number(value.toFixed(APPROXIMATE_DECIMALS)) : value
      return JSON.stringify({
        source: 'device',
        precision,
        latitude: round(answer.latitude),
        longitude: round(answer.longitude),
        accuracyMeters: Math.round(approximate ? Math.max(answer.accuracyMeters, APPROXIMATE_ACCURACY_METERS) : answer.accuracyMeters),
        timestamp: new Date(answer.timestamp).toISOString(),
      })
    }
    case 'manual':
      return JSON.stringify({ source: 'manual', place: answer.place })
    case 'declined':
      return 'The user declined to share their location. Ask where they are if the task needs it, or continue without it.'
    case 'unavailable':
      return `The location is unavailable: ${answer.reason}. Ask the user where they are if the task needs it.`
  }
}

/**
 * Register the `get_location` tool.
 * @param ctx - the plugin context.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  // schemastery's .default() guarantees both fields are set after validation.
  const precision = config.precision as 'precise' | 'approximate'
  const consentTimeoutMs = config.consentTimeoutMs as number
  const unavailable = (): Promise<LocationAnswer> => Promise.resolve({
    kind: 'unavailable',
    reason: 'no open Aeven window can ask the user for their location',
  })

  ctx.tools.register(defineTool({
    name: 'get_location',
    description: 'Ask the user for their current location. They approve their device location or decline; '
      + 'an approved location returns latitude, longitude, and accuracyMeters. '
      + 'Call it only when the task needs where the user is, such as nearby places or local weather, and never to guess a location from other data.',
    parameters: {
      purpose: {
        type: 'string',
        required: true,
        description: 'Why the location is needed, in one short sentence the user reads before choosing, for example "To find pharmacies near you".',
      },
    },
    timeoutMs: consentTimeoutMs,
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
    },
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) throw new HarnessError('get_location needs a calling agent', 'LOCATION_NO_AGENT')
      const raw = (args as { purpose?: unknown }).purpose
      const purpose = typeof raw === 'string' ? raw.trim() : ''
      const answer = await ctx.waterfall(
        scopeTarget(agent, agent),
        'location/request',
        { purpose, agent, signal: exec.signal },
        unavailable,
      )
      return renderLocationAnswer(answer, precision)
    },
  }))
}
