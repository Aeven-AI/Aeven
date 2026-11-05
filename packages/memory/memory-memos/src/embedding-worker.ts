/** Runs the deployment's fixed embedding model outside the Host event loop. */
import { parentPort } from 'node:worker_threads'
import { LocalEmbeddingProvider } from '@deepseek-ai/memos-local-plugin/core/embedding/providers/local.js'
import type { ProviderLogger } from '@deepseek-ai/memos-local-plugin/core/embedding/types.js'

const port = parentPort
if (port === null) throw new Error('Embedding worker requires a parent port')
const provider = new LocalEmbeddingProvider()
const log: ProviderLogger = { trace() {}, debug() {}, info() {}, warn() {}, error() {} }

port.on('message', (message: unknown) => {
  if (typeof message !== 'object' || message === null) throw new Error('Invalid embedding request')
  const value = message as Record<string, unknown>
  const { id, texts, role, model, device, dtype } = value
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1
    || !Array.isArray(texts) || !texts.every((text: unknown) => typeof text === 'string')
    || (role !== 'query' && role !== 'document') || typeof model !== 'string'
    || typeof device !== 'string' || typeof dtype !== 'string') throw new Error('Invalid embedding request')
  void provider.embed(texts, role, {
    config: { provider: 'local', model, device, dtype, dimensions: 0, openRouter: false, cache: { enabled: false, maxItems: 0 } },
    log,
  }).then(
    vectors => { port.postMessage({ id, vectors }) },
    (error: unknown) => { port.postMessage({ id, error: error instanceof Error ? error.message : String(error) }) },
  )
})
