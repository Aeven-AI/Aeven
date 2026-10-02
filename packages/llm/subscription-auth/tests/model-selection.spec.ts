import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CODEX_IMAGE_MODEL } from '../src/codex-images.ts'
import { createCodexMediaProvider, createGrokMediaProvider } from '../src/media-providers.ts'
import { ModelSelection } from '../src/model-selection.ts'
import { startModelSync } from '../src/model-sync.ts'
import { CODEX_OAUTH_PROVIDER } from '../src/oauth-providers.ts'
import { OAuthProviderSession } from '../src/oauth-session.ts'
import { OAuthCredentialFileStore } from '../src/store.ts'
import { subscriptionModelViews } from '../src/subscription-models.ts'

async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix))
}

describe('ModelSelection', () => {
  it('selects every model by default and persists only the switched-off ids', async () => {
    const dir = await tempDir('avn-model-selection-')
    const file = join(dir, 'selection.json')
    const onChange = vi.fn()
    const selection = new ModelSelection(onChange, file)
    await selection.load()
    expect(selection.isSelected('codex', 'gpt-5.5')).toBe(true)

    await selection.setSelected('codex', ['gpt-5.5', 'gpt-5.4'], ['gpt-5.5'])
    expect(selection.isSelected('codex', 'gpt-5.4')).toBe(false)
    expect(selection.isSelected('codex', 'gpt-new')).toBe(true)
    expect(onChange).toHaveBeenCalledWith('codex')
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ version: 1, deselected: { codex: ['gpt-5.4'] } })

    const reloaded = new ModelSelection(undefined, file)
    await reloaded.load()
    expect(reloaded.isSelected('codex', 'gpt-5.4')).toBe(false)
    expect(reloaded.isSelected('grok', 'gpt-5.4')).toBe(true)
  })

  it('keeps the stored choice of a model the provider stops listing', async () => {
    const dir = await tempDir('avn-model-selection-gone-')
    const selection = new ModelSelection(undefined, join(dir, 'selection.json'))
    await selection.setSelected('grok', ['a', 'b'], ['a'])
    // `b` disappears from the listing; selecting all of what remains leaves its choice alone.
    await selection.setSelected('grok', ['a'], ['a'])
    expect(selection.isSelected('grok', 'b')).toBe(false)
  })

  it('rejects a document it cannot read', async () => {
    const dir = await tempDir('avn-model-selection-bad-')
    const file = join(dir, 'selection.json')
    for (const body of ['{', '[]', '{"version":2}']) {
      await writeFile(file, body)
      await expect(new ModelSelection(undefined, file).load()).rejects.toThrow()
    }
  })
})

describe('OAuthProviderSession live listing', () => {
  it('serves the live listing filtered by selection and restores it from its cache', async () => {
    const dir = await tempDir('avn-codex-live-')
    const store = new OAuthCredentialFileStore(CODEX_OAUTH_PROVIDER.nativeProviderId, join(dir, 'auth.json'), CODEX_OAUTH_PROVIDER.route)
    const cacheFile = join(dir, 'models.json')
    const onCatalogChange = vi.fn()
    const session = new OAuthProviderSession(CODEX_OAUTH_PROVIDER, {
      store,
      cacheFile,
      onCatalogChange,
      isSelected: id => id !== 'gpt-5.4',
    })
    const shipped = session.availableModels().map(model => model.id)
    expect(shipped.length).toBeGreaterThan(1)

    await session.setLiveModels([{ id: 'gpt-5.4' }, { id: 'gpt-next', name: 'GPT Next', imageInput: true }])
    expect(onCatalogChange).toHaveBeenCalledOnce()
    expect(session.availableModels().map(model => model.id)).toEqual(['gpt-5.4', 'gpt-next'])
    expect(session.visibleModels().map(model => model.id)).toEqual(['gpt-next'])
    expect(session.visibleModels()[0]).toMatchObject({ name: 'GPT Next', input: ['text', 'image'] })
    expect(session.provider().getModels().map(model => model.id)).toEqual(['gpt-next'])

    // An unchanged or empty listing changes nothing.
    await session.setLiveModels([{ id: 'gpt-5.4' }, { id: 'gpt-next', name: 'GPT Next', imageInput: true }])
    await session.setLiveModels([])
    expect(onCatalogChange).toHaveBeenCalledOnce()

    const restored = new OAuthProviderSession(CODEX_OAUTH_PROVIDER, { store, cacheFile })
    await restored.loadCachedModels()
    expect(restored.availableModels().map(model => model.id)).toEqual(['gpt-5.4', 'gpt-next'])
  })
})

describe('subscriptionModelViews', () => {
  it('lists chat models, then the image model, each with its capabilities and selection', () => {
    const session = new OAuthProviderSession(CODEX_OAUTH_PROVIDER)
    const views = subscriptionModelViews('codex', session.availableModels(), id => id !== CODEX_IMAGE_MODEL)
    const image = views.at(-1)
    expect(image).toEqual({ id: CODEX_IMAGE_MODEL, name: 'GPT Image 2', imageInput: false, imageOutput: true, selected: false })
    expect(views.slice(0, -1).every(view => !view.imageOutput && view.selected)).toBe(true)
  })
})

describe('startModelSync', () => {
  it('syncs signed-in providers at once, skips signed-out ones, and reports failures', async () => {
    const synced = vi.fn(async () => undefined)
    const failed = vi.fn(async () => { throw new Error('listing down') })
    const skipped = vi.fn(async () => undefined)
    const onError = vi.fn()
    const sync = startModelSync({
      intervalMs: 0,
      onError,
      providers: [
        { isSignedIn: async () => true, sync: synced },
        { isSignedIn: async () => true, sync: failed },
        { isSignedIn: async () => false, sync: skipped },
      ],
    })
    await sync.syncNow()
    expect(synced).toHaveBeenCalled()
    expect(skipped).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'listing down' }))
    sync.dispose()
    synced.mockClear()
    await sync.syncNow()
    expect(synced).not.toHaveBeenCalled()
  })
})

describe('subscription media providers', () => {
  it('offers an image model only while signed in and selected', async () => {
    let ready = false
    let selected = true
    const provider = createCodexMediaProvider(
      { requestJson: vi.fn(), resolveAccess: vi.fn() },
      { ready: () => ready, isSelected: () => selected },
    )
    expect(provider.available()).toBe(false)
    ready = true
    expect(await provider.listImageModels?.()).toEqual([{ provider: 'codex-subscription', id: CODEX_IMAGE_MODEL, label: 'GPT Image 2' }])
    selected = false
    expect(provider.available()).toBe(false)
    await expect(provider.generateImage({ model: CODEX_IMAGE_MODEL, prompt: 'a cat' })).rejects.toThrow(/switched off/u)
  })

  it('returns the decoded Codex image bytes', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6300010000050001', 'hex')
    const requestJson = vi.fn(async () => ({ data: [{ b64_json: png.toString('base64') }, { url: 'ignored' }] }))
    const provider = createCodexMediaProvider({ requestJson, resolveAccess: vi.fn() }, { ready: () => true, isSelected: () => true })
    const result = await provider.generateImage({ model: CODEX_IMAGE_MODEL, prompt: 'a cat' })
    expect(result.images).toHaveLength(1)
    expect(result.images[0]).toMatchObject({ kind: 'bytes', mediaType: 'image/png' })
    expect(requestJson).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST', body: expect.objectContaining({ prompt: 'a cat' }) }))
  })

  it('refuses reference images for Grok Imagine and unknown models for both', async () => {
    const imagine = { generateImage: vi.fn() }
    const grok = createGrokMediaProvider(imagine, { ready: () => true, isSelected: () => true })
    await expect(grok.generateImage({
      model: 'grok-imagine-image-2.0',
      prompt: 'a cat',
      references: [{ mediaType: 'image/png', data: new Uint8Array([1]) }],
    })).rejects.toThrow(/reference images/u)
    await expect(grok.generateImage({ model: 'other', prompt: 'a cat' })).rejects.toThrow(/not offered/u)
    expect(imagine.generateImage).not.toHaveBeenCalled()
  })
})
