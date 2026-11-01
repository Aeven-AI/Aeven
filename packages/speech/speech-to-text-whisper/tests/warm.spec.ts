/** A warm worker starts from verified resources only, and never downloads on the reader's behalf. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Config } from '../src/config.ts'
import { WhisperWorker } from '../src/recognizer.ts'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'avn-speech-warm-'))
  cleanup.push(async () => { await rm(root, { recursive: true, force: true }) })
  const model = join(root, 'model.bin'), vad = join(root, 'vad.bin'), worker = join(root, 'worker')
  await Promise.all([writeFile(model, 'model'), writeFile(vad, 'vad'), writeFile(worker, 'worker')])
  const config = { dataRoot: root, modelPath: model, vadModelPath: vad, workerPath: worker, modelOrigins: ['https://example.invalid'],
    modelProbeTimeoutMs: 1000, threads: 1, vadThreshold: 0.5, vadMinSpeechMs: 250, vadMinSilenceMs: 100, vadSpeechPadMs: 30,
    maxAudioBytes: 1024, prepareTimeoutMs: 10_000, inferenceTimeoutMs: 10_000, idleTimeoutMs: 0, warmOnActivation: true, maxPending: 1,
    graceMs: 1000, maxLogBytes: 1024, maxResponseBytes: 1024, progressIntervalMs: 100 } as Config
  return config
}

/** A spawned worker that reports itself ready and then stays alive until terminated. */
function fakeWorker() {
  const stdout = new PassThrough(), stdin = new PassThrough()
  const spawn = vi.fn(() => {
    setTimeout(() => { stdout.write('{"ready":true}\n') }, 0)
    return {
      stdout, stdin, collected: {}, done: new Promise<void>(() => {}),
      terminate: () => { stdout.destroy(); stdin.destroy() }, waitForExit: async () => {},
    }
  })
  return { ctx: { subprocess: { spawn }, logger: { warn: (): void => {} } } as unknown as Context, spawn }
}

it('starts a verified worker on activation without waiting for a recording', async () => {
  const config = await fixture(), { ctx, spawn } = fakeWorker(), worker = new WhisperWorker(ctx, config)
  worker.inspect()
  await vi.waitFor(() => { expect(worker.snapshot().phase).toBe('standby') })
  worker.warm()
  await vi.waitFor(() => { expect(worker.snapshot().phase).toBe('ready') })
  expect(spawn).toHaveBeenCalledOnce()
  await worker.dispose()
})

it('leaves an unverified model to the explicit preparation instead of downloading it', async () => {
  const config = { ...await fixture(), modelPath: undefined, vadModelPath: undefined }, { ctx, spawn } = fakeWorker()
  const worker = new WhisperWorker(ctx, config)
  worker.inspect()
  await vi.waitFor(() => { expect(worker.snapshot().phase).toBe('unprepared') })
  worker.warm()
  await new Promise((resolve) => { setTimeout(resolve, 20) })
  expect(spawn).not.toHaveBeenCalled()
  await worker.dispose()
})
