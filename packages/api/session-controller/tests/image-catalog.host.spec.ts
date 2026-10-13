/**
 * Image-model catalog assembly. The media seam is optional in every profile,
 * so the catalog is proved against a composed seam and an absent one.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { buildImageModelCatalog } from '../src/image-catalog.ts'

describe('image model catalog', () => {
  it('answers an empty catalog where no media seam is composed', async () => {
    // A deployment without image generation must give a selector an empty
    // list, not an error the selector would have to special-case.
    const ctx = new Context()
    await expect(buildImageModelCatalog(ctx)).resolves.toEqual({ models: [] })
  })

  it('reports every model the composed providers publish, in registration order', async () => {
    const ctx = new Context()
    ctx.provide('media', {
      listImageModels: async () => [
        { provider: 'zeta', id: 'z-2', label: 'Zeta Two' },
        { provider: 'alpha', id: 'a-1', label: 'Alpha One' },
      ],
    } as never)

    const catalog = await buildImageModelCatalog(ctx)
    expect(catalog.models.map(entry => entry.id)).toEqual(['z-2', 'a-1'])
    expect(catalog.models[0]?.provider).toBe('zeta')
  })

  it('copies the list the seam returns rather than aliasing it', async () => {
    // The seam owns its array; serving the same reference would let a later
    // provider refresh mutate a catalog already handed to a caller.
    const models = [{ provider: 'alpha', id: 'a-1', label: 'Alpha One' }]
    const ctx = new Context()
    ctx.provide('media', { listImageModels: async () => models } as never)

    const catalog = await buildImageModelCatalog(ctx)
    expect(catalog.models).not.toBe(models)
    expect(catalog.models).toEqual(models)
  })

  it('answers an empty catalog where a composed seam publishes no model', async () => {
    const ctx = new Context()
    ctx.provide('media', { listImageModels: async () => [] } as never)
    await expect(buildImageModelCatalog(ctx)).resolves.toEqual({ models: [] })
  })
})
