import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import DocumentExtract from '@aeven/document-extract'
import { VIDEO_FORMATS, describeClip } from '../src/index.ts'
import * as video from '../src/index.ts'

const execFile = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({ execFile }))

/** Answer the probe with one ffprobe JSON document. */
function probeAnswers(stdout: string): void {
  execFile.mockImplementation(((
    _file: string,
    _args: readonly string[],
    _options: object,
    callback: (error: unknown, result: { stdout: string; stderr: string }) => void,
  ) => { callback(null, { stdout, stderr: '' }) }) as never)
}

/** Refuse the probe, as a host without the binary does. */
function probeMissing(): void {
  execFile.mockImplementation(((
    _file: string,
    _args: readonly string[],
    _options: object,
    callback: (error: unknown, result: { stdout: string; stderr: string }) => void,
  ) => { callback(new Error('spawn ffprobe ENOENT'), { stdout: '', stderr: '' }) }) as never)
}

async function mount(config: Partial<video.Config> = {}): Promise<{
  extract: DocumentExtract
  dispose: () => Promise<void>
}> {
  const ctx = new Context()
  await ctx.plugin(DocumentExtract, DocumentExtract.Config({})).await()
  const fiber = ctx.plugin(video, video.Config({ ffprobePath: 'ffprobe', probeTimeoutMs: 1_000, ...config }))
  await fiber.await()
  return {
    extract: ctx.get('documentExtract') as DocumentExtract,
    dispose: () => fiber.dispose(),
  }
}

beforeEach(() => { execFile.mockReset() })

describe('describeClip', () => {
  it('lists every probed fact, then the container and size', () => {
    expect(describeClip('clip.webm', { seconds: 8.24, width: 720, height: 1280, codec: 'vp9', container: 'WebM', bytes: 3_400_000 }))
      .toBe('Video clip "clip.webm": 8.2 s, 720×1280, vp9, WebM, 3.4 MB. The clip is stored with this session; its frames and sound are not transcribed.')
  })

  it('reports only what the deployment knows', () => {
    expect(describeClip('clip.mp4', { container: 'MP4', bytes: 820_000 }))
      .toBe('Video clip "clip.mp4": MP4, 820 kB. The clip is stored with this session; its frames and sound are not transcribed.')
  })
})

describe('document-extract-video', () => {
  it('claims the clip formats a composer can record or upload', async () => {
    const { extract } = await mount()
    expect(extract.accepts('clip.webm', 'video/webm')).toBe(true)
    expect(extract.accepts('clip.mov', 'video/quicktime')).toBe(true)
    expect(extract.accepts('clip.webm', '')).toBe(true)
    expect({ extensions: VIDEO_FORMATS.extensions, mediaTypes: VIDEO_FORMATS.mediaTypes }).toBeDefined()
    expect(extract.accepts('notes.txt', 'text/plain')).toBe(false)
  })

  it('describes a clip through the probe', async () => {
    probeAnswers(JSON.stringify({
      streams: [{ codec_name: 'vp9', width: 720, height: 1280 }],
      format: { duration: '8.24' },
    }))
    const { extract } = await mount()
    const result = await extract.extract({ data: new Uint8Array(3_400_000), name: 'clip.webm', mediaType: 'video/webm' }, AbortSignal.timeout(5_000))
    expect(result.text).toContain('8.2 s, 720×1280, vp9, WebM, 3.4 MB')
    expect(result.method).toBe('native')
    expect(result.providerId).toBe('video')
  })

  it('reports the container alone when the probe cannot answer', async () => {
    probeMissing()
    const { extract } = await mount()
    const result = await extract.extract({ data: new Uint8Array(900), name: 'clip.mov', mediaType: 'video/quicktime' }, AbortSignal.timeout(5_000))
    expect(result.text).toContain('QuickTime, 1 kB')
  })

  it('reports the container alone when the probe answers without usable facts', async () => {
    probeAnswers('not json')
    const { extract } = await mount()
    const result = await extract.extract({ data: new Uint8Array(900), name: 'clip.webm', mediaType: 'video/webm' }, AbortSignal.timeout(5_000))
    expect(result.text).toContain('WebM, 1 kB')
  })

  it('keeps a stream that names only its codec', async () => {
    probeAnswers(JSON.stringify({ streams: [{ codec_name: 'h264' }], format: {} }))
    const { extract } = await mount()
    const result = await extract.extract({ data: new Uint8Array(2_000_000), name: 'clip.mp4', mediaType: 'video/mp4' }, AbortSignal.timeout(5_000))
    expect(result.text).toContain('h264, MP4, 2.0 MB')
  })

  it('labels an unrecognized container by its extension', async () => {
    probeMissing()
    const { extract } = await mount()
    // The registry never routes an unclaimed format here, so the provider's own
    // reader is driven directly with an extension it does not advertise.
    const reader = (extract as unknown as {
      providers: Map<string, { extract(input: unknown, signal: AbortSignal): Promise<{ text: string }> }>
    }).providers.get('video')!
    const result = await reader.extract({ data: new Uint8Array(10), name: 'clip.avi', mediaType: '', extension: 'avi' }, AbortSignal.timeout(5_000))
    expect(result.text).toContain('AVI')
  })

  it('stops before describing a cancelled upload', async () => {
    probeMissing()
    const { extract } = await mount()
    const controller = new AbortController()
    controller.abort()
    await expect(extract.extract({ data: new Uint8Array(10), name: 'clip.webm', mediaType: 'video/webm' }, controller.signal))
      .rejects.toThrow()
  })

  it('withdraws its formats with the plugin fiber', async () => {
    const { extract, dispose } = await mount()
    expect(extract.accepts('clip.webm', 'video/webm')).toBe(true)
    await dispose()
    expect(extract.accepts('clip.webm', 'video/webm')).toBe(false)
  })
})
