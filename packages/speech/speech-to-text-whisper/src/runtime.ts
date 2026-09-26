/** Verified model assets and the platform worker executable for local transcription. */
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream, readFileSync } from 'node:fs'
import { access, mkdir, rename, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Config } from './config.ts'
import type { SpeechPreparationState } from '@aeven/speech-to-text/types'
import { timeoutOf } from '@aeven/timeout'
import { classifyDownloadFailure, SpeechDownloadError } from './download-error.ts'
import { orderModelSources } from './model-sources.ts'

/** Release-pinned downloadable file. */
export interface Asset {
  readonly name: string
  readonly url: string
  readonly sha256: string
  readonly bytes: number
}

interface RuntimeLock {
  model: Asset
  vad: Asset
}

/** Prepared model and process paths, private to the local provider. */
export interface RuntimePaths {
  readonly model: string
  readonly vad: string
  readonly worker: string
}

/**
 * Resolve the prebuilt worker from the platform package npm installed for this host.
 * @param config - optional explicit worker path.
 * @returns absolute worker executable path; its existence is checked by inspection.
 * @throws When this host has no platform package, which means local speech is unsupported here.
 */
export function resolveWorker(config: Pick<Config, 'workerPath'>): string {
  if (config.workerPath !== undefined) return config.workerPath
  const name = `@aeven/whisper-cpp-${process.platform}-${process.arch}`
  let manifest: string
  try { manifest = createRequire(import.meta.url).resolve(`${name}/package.json`) } catch (error) {
    throw new Error(`Local speech is unavailable for ${process.platform}-${process.arch}: ${name} is not installed`, { cause: error })
  }
  return join(dirname(manifest), 'bin', process.platform === 'win32' ? 'avn-whisper-worker.exe' : 'avn-whisper-worker')
}

async function matchesAsset(path: string, asset: Asset, signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted()
  try {
    const info = await stat(path)
    if (!info.isFile()) throw new Error(`Speech asset is not a regular file: ${path}`)
    if (info.size !== asset.bytes) return false
    const digest = createHash('sha256')
    for await (const chunk of createReadStream(path, { signal })) digest.update(chunk as Buffer)
    return digest.digest('hex') === asset.sha256
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return false
  }
}

function resolveRuntime(config: Config) {
  const lock = JSON.parse(readFileSync(new URL('../runtime/assets.json', import.meta.url), 'utf8')) as RuntimeLock
  const modelRoot = join(config.dataRoot, 'models', 'whisper')
  const paths: RuntimePaths = {
    model: config.modelPath ?? join(modelRoot, lock.model.name),
    vad: config.vadModelPath ?? join(config.dataRoot, 'models', 'silero', lock.vad.name),
    worker: resolveWorker(config),
  }
  return { lock, modelRoot, paths }
}

async function verifyRuntime(config: Config, paths: RuntimePaths, lock: RuntimeLock, signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted()
  try { await Promise.all([paths.model, paths.vad].map(path => access(path))) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return false
  }
  const verified = [
    ...config.modelPath === undefined ? [[paths.model, lock.model]] as const : [],
    ...config.vadModelPath === undefined ? [[paths.vad, lock.vad]] as const : [],
  ]
  for (const [path, asset] of verified) if (!await matchesAsset(path, asset, signal)) return false
  signal.throwIfAborted()
  return true
}

async function requireWorker(worker: string): Promise<void> {
  try { await access(worker) } catch (error) {
    throw new Error(`Local speech worker is missing at ${worker}; build it with \`pnpm --dir native/whisper-cpp run build:native\``, { cause: error })
  }
}

/**
 * Inspect existing models without downloading, writing files or starting the worker.
 * @param config - model and worker paths.
 * @param signal - provider cancellation or inspection deadline.
 * @returns cached paths when all files exist and managed assets match their pinned size and hash; otherwise undefined.
 */
export async function inspectRuntime(config: Config, signal: AbortSignal): Promise<RuntimePaths | undefined> {
  const { lock, paths } = resolveRuntime(config)
  await requireWorker(paths.worker)
  return await verifyRuntime(config, paths, lock, signal) ? paths : undefined
}

/**
 * Download into a unique partial file, verify, then publish it atomically.
 * @param asset - pinned release identity.
 * @param root - provider-owned cache directory.
 * @param signal - preparation cancellation.
 * @param report - Host-owned progress publisher.
 * @returns verified local file path; failures carry localized-UI diagnostics through SpeechDownloadError.
 */
export async function downloadAsset(asset: Asset, root: string, signal: AbortSignal,
  report: (state: SpeechPreparationState) => void = () => {}): Promise<string> {
  signal.throwIfAborted()
  const destination = join(root, asset.name)
  const partial = `${destination}.${randomUUID()}.part`
  let source = new URL(asset.url).origin
  try {
    await mkdir(root, { recursive: true })
    if (await matchesAsset(destination, asset, signal)) return destination
    try {
      const response = await fetch(asset.url, { signal })
      source = new URL(response.url || asset.url).origin
      if (!response.ok || !response.body) {
        await response.body?.cancel()
        throw new SpeechDownloadError({ resource: asset.name, source, reason: 'http', status: response.status })
      }
      const digest = createHash('sha256')
      let completedBytes = 0
      const publish = (): void => { report({ phase: 'downloading', resource: asset.name, completedBytes, totalBytes: asset.bytes }) }
      publish()
      const hashing = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        completedBytes += chunk.length
        if (completedBytes > asset.bytes) {
          callback(new SpeechDownloadError({ resource: asset.name, source, reason: 'integrity' })); return
        }
        digest.update(chunk); publish(); callback(null, chunk)
      } })
      await pipeline(response.body, hashing, createWriteStream(partial, { flags: 'wx', mode: 0o600 }), { signal })
      if (completedBytes !== asset.bytes || digest.digest('hex') !== asset.sha256) {
        throw new SpeechDownloadError({ resource: asset.name, source, reason: 'integrity' })
      }
      signal.throwIfAborted()
      await rename(partial, destination)
      return destination
    } finally {
      await rm(partial, { force: true })
    }
  } catch (error) {
    const timedOut = timeoutOf(signal)
    if (signal.aborted && !timedOut || error instanceof SpeechDownloadError) throw error
    throw new SpeechDownloadError({ resource: asset.name, source,
      ...timedOut ? { reason: 'timeout' } : classifyDownloadFailure(error),
    }, { cause: error })
  }
}

/**
 * Prepare verified models on demand; the worker executable itself ships in its platform package.
 * @param config - model paths and download source policy.
 * @param signal - preparation cancellation or deadline.
 * @param report - Host-owned progress publisher.
 * @returns verified model and worker paths.
 */
export async function prepareRuntime(config: Config, signal: AbortSignal,
  report: (state: SpeechPreparationState) => void = () => {}): Promise<RuntimePaths> {
  const { lock, modelRoot, paths } = resolveRuntime(config)
  await requireWorker(paths.worker)
  const download = async (asset: Asset, root: string, step: 'model' | 'vad'): Promise<void> => {
    if (await matchesAsset(join(root, asset.name), asset, signal)) return
    const origins = config.modelOrigin === undefined ? config.modelOrigins : [config.modelOrigin]
    const urls = await orderModelSources(asset.url, origins, config.modelProbeTimeoutMs, signal)
    for (const [index, url] of urls.entries()) {
      try {
        await downloadAsset({ ...asset, url }, root, signal, (state) => { report({ ...state, step }) })
        return
      } catch (error) {
        if (signal.aborted || !(error instanceof SpeechDownloadError) || error.download.reason === 'storage'
          || error.download.reason === 'unknown' || index === urls.length - 1) throw error
      }
    }
  }
  if (config.modelPath === undefined) {
    report({ phase: 'checking', step: 'model', startedAt: Date.now() })
    await download(lock.model, modelRoot, 'model')
  }
  if (config.vadModelPath === undefined) {
    report({ phase: 'checking', step: 'vad', startedAt: Date.now() })
    await download(lock.vad, join(config.dataRoot, 'models', 'silero'), 'vad')
  }
  report({ phase: 'checking', step: 'verify', startedAt: Date.now() })
  if (!await verifyRuntime(config, paths, lock, signal)) throw new Error('Speech model verification failed: missing or corrupted model files')
  return paths
}
