/**
 * The config catalog walker's judgement, proven on hand-built source: the
 * schema compositions it resolves statically (an object literal, an inline
 * `z.intersect`, a spread of a local `const` object) and the ones it refuses
 * rather than quietly thinning the catalog. Run against the real workspace,
 * `pnpm run verify-config-catalog` covers freshness; these cases pin the rules
 * that make an unwalkable schema fail the gate instead of shipping.
 */

import { describe, expect, it } from 'vitest'
import { walkSchemaSource } from './gen-config-catalog.ts'

/** Walk one `export const Config` schema and return its key paths. */
function keys(source: string): string[] {
  const walked = walkSchemaSource(source)
  expect(walked.violations).toEqual([])
  return walked.keys.sort()
}

describe('config catalog schema walk', () => {
  it('walks an object literal, its refinements, and nested object and array paths', () => {
    expect(keys(`
      import z from '@deepseek-ai/schemastery'
      export const Config = z.object({
        /** A path. */
        outputDirectory: z.string().required(),
        /** Nested rows. */
        agents: z.array(z.object({
          id: z.string().required(),
          depth: z.number().step(1).default(1),
        })).default([]),
        /** A refined nested object. */
        retry: z.object({ attempts: z.natural().min(1) }).default({ attempts: 1 }),
      })
    `)).toEqual([
      'agents',
      'agents[].depth',
      'agents[].id',
      'outputDirectory',
      'retry',
      'retry.attempts',
    ])
  })

  it('resolves a spread of a local const object, one hop, into its keys and nested paths', () => {
    expect(keys(`
      import z from '@deepseek-ai/schemastery'
      const selectionFields = {
        model: z.string(),
        choices: z.array(z.object({ provider: z.string().required(), model: z.string().required() })).default([]),
      }
      export const Config = z.object({
        ...selectionFields,
        listedProviders: z.array(z.string()).default([]),
      })
    `)).toEqual([
      'choices',
      'choices[].model',
      'choices[].provider',
      'listedProviders',
      'model',
    ])
  })

  it('resolves a local const spread inside a nested object value too', () => {
    expect(keys(`
      import z from '@deepseek-ai/schemastery'
      const videoFields = { pollIntervalMs: z.number().default(5000), maxWaitMs: z.number().default(60000) }
      export const Config = z.object({
        video: z.object({ ...videoFields }),
      })
    `)).toEqual(['video', 'video.maxWaitMs', 'video.pollIntervalMs'])
  })

  it('keeps an inline intersect and a composed plugin Config on their paths', () => {
    const walked = walkSchemaSource(`
      import z from '@deepseek-ai/schemastery'
      import * as Logging from '@aeven/logging'
      export const Config = z.intersect([
        z.object({ appId: z.string().required() }),
        Logging.Config,
      ])
    `)
    expect(walked.violations).toEqual([])
    expect(walked.keys.sort()).toEqual(['appId'])
    expect(walked.composes).toEqual(['@aeven/logging'])
  })
})

describe('config catalog schema walk refusals', () => {
  it('fails a spread the walk cannot resolve statically', () => {
    const walked = walkSchemaSource(`
      import z from '@deepseek-ai/schemastery'
      import { sharedFields } from './shared.ts'
      export const Config = z.object({
        ...sharedFields,
        ...makeFields(),
        ...import('node:os'),
      })
    `)
    expect(walked.violations).toEqual([
      "fixture: schema object spread '...sharedFields' is not a local object literal.",
      "fixture: schema object spread '...makeFields()' is not a local object literal.",
      "fixture: schema object spread '...import('node:os')' is not a local object literal.",
    ])
    // The walk stops at the spread it cannot read rather than reporting a
    // catalog missing those keys as if the schema were smaller.
    expect(walked.keys).toEqual([])
  })

  it('fails a chain of spreads beyond the one hop it resolves', () => {
    const walked = walkSchemaSource(`
      import z from '@deepseek-ai/schemastery'
      const inner = { retries: z.natural().default(3) }
      const outer = { ...inner, timeoutMs: z.number().default(1000) }
      export const Config = z.object({ ...outer })
    `)
    expect(walked.violations).toEqual([
      "fixture: schema object property '...inner' is not a plain key.",
    ])
    expect(walked.keys).toEqual(['timeoutMs'])
  })

  it('fails a local const the walk cannot read: a call, an annotation, or a mutable binding', () => {
    const walked = walkSchemaSource(`
      import z from '@deepseek-ai/schemastery'
      const fromCall = buildFields()
      let fromLet = { port: z.natural().default(80) }
      export const Config = z.object({ ...fromCall, ...fromLet })
    `)
    expect(walked.violations).toEqual([
      "fixture: schema object spread '...fromCall' is not a local object literal.",
      "fixture: schema object spread '...fromLet' is not a local object literal.",
    ])
    expect(walked.keys).toEqual([])
  })

  it('fails a spread whose target is an inline literal with a computed key, or an intersect element that composes nothing', () => {
    const computed = walkSchemaSource(`
      import z from '@deepseek-ai/schemastery'
      const field = 'port'
      export const Config = z.object({ ...{ [field]: z.natural().default(80) } })
    `)
    expect(computed.violations).toEqual([
      "fixture: schema object spread '...{ [field]: z.natural().default(80) }' is not a local object literal.",
    ])
    const intersect = walkSchemaSource(`
      import z from '@deepseek-ai/schemastery'
      import { sharedFields } from './shared.ts'
      export const Config = z.intersect([sharedFields])
    `)
    expect(intersect.violations).toEqual([
      "fixture: intersect element 'sharedFields' is neither a workspace plugin's Config nor an inline schema call.",
    ])
  })

  it('fails a schema expression that is not a walkable schemastery call, and a missing Config', () => {
    const notASchema = walkSchemaSource(`
      import z from '@deepseek-ai/schemastery'
      const shared = { port: z.natural().default(80) }
      export const Config = shared
    `)
    expect(notASchema.violations).toEqual([
      'fixture: schema expression is not a statically walkable schemastery call.',
    ])
    expect(walkSchemaSource('export const config = 1\n').violations).toEqual([
      'fixture: no exported Config declaration to walk.',
    ])
  })
})
