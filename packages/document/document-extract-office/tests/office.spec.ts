/** The Office reader converts documents with the installed LibreOffice engine; no runtime download exists. */
import { readFileSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import DocumentExtract from '@aeven/document-extract'
import type { DocumentExtractProviderId } from '@aeven/document-extract/types'
import * as office from '../src/index.ts'

// Each conversion starts a fresh engine process.
const ENGINE_TIMEOUT_MS = 120_000

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => root.fiber.dispose())) })

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)))
}

async function mount() {
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(DocumentExtract, DocumentExtract.Config({})).await()
  const service = ctx.get('documentExtract')!
  const fiber = ctx.plugin(office, office.Config({}))
  await fiber.await()
  return { ctx, service, fiber }
}

it('reads a legacy Word document as text', async () => {
  const { service } = await mount()
  const result = await service.extract({ data: fixture('sample.doc'), name: 'sample.doc', mediaType: '' }, AbortSignal.timeout(ENGINE_TIMEOUT_MS))
  expect(result).toMatchObject({
    text: 'Quarterly report\n\nRevenue grew by 12 percent in the third quarter.',
    method: 'office',
    providerId: 'office',
    truncated: false,
  })
}, ENGINE_TIMEOUT_MS)

it('reads presentations through the registry PDF reader, one conversion at a time', async () => {
  const { ctx, service } = await mount()
  const pdf = vi.fn(async (input: { readonly data: Uint8Array }) => ({
    text: Buffer.from(input.data.subarray(0, 5)).toString('latin1'),
    method: 'native' as const,
    ...pdf.mock.calls.length === 1 ? { pages: 1 } : {},
  }))
  ctx.effect(() => service.register({
    info: { id: 'pdf' as DocumentExtractProviderId, version: '1', formats: { extensions: ['pdf'], mediaTypes: [] }, priority: 0 },
    extract: pdf,
  }), 'test: pdf reader')
  const read = () => service.extract({ data: fixture('sample.pptx'), name: 'sample.pptx', mediaType: '' }, AbortSignal.timeout(ENGINE_TIMEOUT_MS))
  const [first, second] = await Promise.all([read(), read()])
  expect(first).toMatchObject({ text: '%PDF-', method: 'office', pages: 1, providerId: 'office' })
  expect(second).toMatchObject({ text: '%PDF-', method: 'office', providerId: 'office' })
  expect(second).not.toHaveProperty('pages')
  expect(pdf).toHaveBeenCalledWith(expect.objectContaining({ extension: 'pdf', name: 'converted.pdf' }), expect.any(AbortSignal))
}, ENGINE_TIMEOUT_MS)

it('claims legacy and Office formats only while the plugin is mounted', async () => {
  const { service, fiber } = await mount()
  expect(service.accepted().extensions).toEqual(['doc', 'docx', 'odp', 'ods', 'odt', 'ppt', 'pptx', 'xls', 'xlsx'])
  expect(service.accepts('legacy', 'application/vnd.ms-powerpoint')).toBe(true)
  expect(service.accepts('deck.key', '')).toBe(false)
  await fiber.dispose()
  expect(service.accepted().extensions).toEqual([])
})
