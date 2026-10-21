/** Pins the shipped Aeven persona and memory tools through the headless profile. */
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { load } from 'js-yaml'
import { brandString } from '@aeven/brand'
import type { MemoryItemId, MemoryProvider } from '@aeven/memory'
import type {} from '@aeven/system-prompt'

export const name = 'assessment-memory-snapshot'
export const inject = ['memory', 'systemPrompt']

/**
 * Use the product's persona and persist the memory write for an independent workspace assertion.
 * @param ctx - the snapshot profile's host context.
 */
export function apply(ctx: Context): void {
  const entries = load(readFileSync(new URL('../../../../preset/agent-presets/presets/aeven/agent.cordis.yml', import.meta.url), 'utf8'), { schema: entryListSchema }) as { id: string; config: { text?: string } }[]
  const text = entries.find(entry => entry.id === 'persona')?.config.text
  if (text === undefined) throw new Error('shipped Aeven persona missing')
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const result = await next()
    return { ...result, sections: result.sections.map(section => section.name === 'deployment:persona' ? { ...section, text } : section) }
  })
  // The scenario calls only remember; the other provider operations are outside this fixture.
  const provider = {
    id: 'assessment-snapshot',
    remember: async (request: Parameters<MemoryProvider['remember']>[0]) => {
      await writeFile(join(request.scope.cwd!, 'remembered.json'), `${JSON.stringify({ text: request.text, domain: request.domain })}\n`)
      return brandString<MemoryItemId>('assessment-fact')
    },
  } as MemoryProvider
  ctx.effect(() => ctx.memory.register(provider), 'assessment.memory')
}
