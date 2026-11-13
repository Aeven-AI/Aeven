/**
 * Source of the diarization worker thread, run with `eval: true` so the bundled Host needs no
 * second entry file. The thread loads the sherpa-onnx Node-API addon from the absolute path in
 * `workerData.addon`, builds the pyannote segmenter and the speaker-embedding extractor once, then
 * answers `{ id, samples }` messages (16 kHz mono Float32) with `{ id, segments }` or
 * `{ id, error }`. Native inference is synchronous, so it runs here rather than on the Host's
 * event loop.
 *
 * Each recording is segmented by voice; adjacent stretches of one voice are merged, stretches
 * shorter than `minEmbeddingSeconds` join their neighbour, and each remaining stretch gets a
 * unit-length embedding so the caller can recognize the same voice across recordings.
 */
export const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads')
const sherpa = require(workerData.addon)
const options = workerData.options
const diarizer = new sherpa.OfflineSpeakerDiarization({
  segmentation: { pyannote: { model: workerData.segmentation }, numThreads: options.threads, debug: 0 },
  embedding: { model: workerData.embedding, numThreads: options.threads, debug: 0 },
  clustering: { numClusters: -1, threshold: options.clusteringThreshold },
  minDurationOn: options.minDurationOn,
  minDurationOff: options.minDurationOff,
})
const extractor = new sherpa.SpeakerEmbeddingExtractor({ model: workerData.embedding, numThreads: options.threads, debug: 0 })
const RATE = diarizer.sampleRate

function embed(samples) {
  const stream = extractor.createStream()
  stream.acceptWaveform({ sampleRate: RATE, samples })
  stream.inputFinished()
  if (!extractor.isReady(stream)) return undefined
  const vector = extractor.compute(stream, false)
  let norm = 0
  for (const value of vector) norm += value * value
  norm = Math.sqrt(norm) || 1
  return Array.from(vector, value => value / norm)
}

function segment(samples) {
  const total = samples.length / RATE
  let stretches = diarizer.process(samples)
    .map(s => ({ start: Math.max(0, s.start), end: Math.min(total, s.end), speaker: s.speaker }))
    .filter(s => s.end > s.start)
    .sort((a, b) => a.start - b.start)
  if (stretches.length === 0) stretches = [{ start: 0, end: total, speaker: 0 }]
  const merged = []
  for (const s of stretches) {
    const last = merged[merged.length - 1]
    if (last !== undefined && last.speaker === s.speaker) last.end = Math.max(last.end, s.end)
    else merged.push({ ...s })
  }
  for (let i = 0; i < merged.length && merged.length > 1;) {
    const s = merged[i]
    if (s.end - s.start >= options.minEmbeddingSeconds) { i++; continue }
    const before = merged[i - 1], after = merged[i + 1]
    const target = before === undefined ? after : after === undefined ? before
      : (before.end - before.start >= after.end - after.start ? before : after)
    target.start = Math.min(target.start, s.start)
    target.end = Math.max(target.end, s.end)
    merged.splice(i, 1)
    i = Math.max(0, i - 1)
    for (let j = 1; j < merged.length;) {
      if (merged[j].speaker === merged[j - 1].speaker) { merged[j - 1].end = merged[j].end; merged.splice(j, 1) } else j++
    }
  }
  // Stretches tile the recording: each runs to the next one's start, the first from zero, the last to the end.
  merged[0].start = 0
  for (let i = 1; i < merged.length; i++) merged[i].start = merged[i - 1].end = (merged[i - 1].end + merged[i].start) / 2
  merged[merged.length - 1].end = total
  return merged.map((s) => {
    const embedding = embed(samples.subarray(Math.floor(s.start * RATE), Math.ceil(s.end * RATE)))
    return embedding === undefined ? { start: s.start, end: s.end } : { start: s.start, end: s.end, embedding }
  })
}

parentPort.on('message', ({ id, samples }) => {
  try { parentPort.postMessage({ id, segments: segment(samples) }) }
  catch (error) { parentPort.postMessage({ id, error: error instanceof Error ? error.message : String(error) }) }
})
parentPort.postMessage({ ready: RATE })
`
