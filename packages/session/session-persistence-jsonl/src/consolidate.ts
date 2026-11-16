/**
 * Merge a Zstandard session log's small append frames into larger frames that decode to the same bytes.
 *
 * Every durable append batch is its own frame, and Zstandard compresses each frame alone, so a long session stores
 * many small frames that cannot reuse each other's content: on 40 recorded desktop sessions the logs took 14.7 MB
 * against 6.2 MB for the same text in frames of up to 4 MiB. Consolidation keeps the header frame byte for byte,
 * keeps a frame that stands alone as it is, and compresses each run of neighbouring frames into one frame of at most
 * {@link CONSOLIDATED_FRAME_BYTES} of text, so the file stays a header frame followed by frames of whole lines.
 * @module avn-session-persistence-jsonl/consolidate
 */

import { compressZstdFrame, createZstdFrameDecoder, scanZstdFrames, type ZstdFrameRange } from './zstd.ts'

/**
 * Most text one consolidated frame carries. Decoding one frame is a synchronous step; at this size it takes a few
 * milliseconds, inside the decoder's yield interval, while larger frames gained under 10 percent more compression.
 */
export const CONSOLIDATED_FRAME_BYTES = 4 * 1024 * 1024

/** A frame below this compressed size counts as small; consolidated frames are larger unless their text is tiny. */
export const SMALL_FRAME_BYTES = 64 * 1024

/** Frames decoded between event-loop turns. */
const FRAMES_PER_TURN = 64

/** The frames of one log, decoded. */
interface DecodedLog {
  readonly frames: readonly ZstdFrameRange[]
  readonly plaintexts: readonly Buffer[]
}

async function decodeLog(buffer: Buffer, frames: readonly ZstdFrameRange[]): Promise<Buffer[]> {
  const plaintexts: Buffer[] = []
  for (const plaintext of createZstdFrameDecoder().decode(buffer, frames)) {
    // The decoder yields views into a reused buffer.
    plaintexts.push(Buffer.from(plaintext))
    if (plaintexts.length % FRAMES_PER_TURN === 0) await new Promise<void>((resolve) => { setImmediate(resolve) })
  }
  return plaintexts
}

async function complete(buffer: Buffer): Promise<DecodedLog | undefined> {
  const scan = scanZstdFrames(buffer)
  if (scan.tornStart !== undefined || scan.frames.length < 2) return undefined
  return { frames: scan.frames, plaintexts: await decodeLog(buffer, scan.frames) }
}

/**
 * Consolidate one complete log.
 * @param buffer - the log's bytes: a header frame followed by append frames.
 * @param minSmallFrames - small append frames the log must hold before it is rewritten; at least 1.
 * @returns the consolidated bytes, verified to decode to exactly the original text, or undefined when the log has a
 * torn final frame, holds fewer small frames than `minSmallFrames`, or would not shrink.
 * @throws When the consolidated bytes do not decode to the original text.
 */
export async function consolidateZstdLog(buffer: Buffer, minSmallFrames: number): Promise<Buffer | undefined> {
  const scan = scanZstdFrames(buffer)
  if (scan.tornStart !== undefined || scan.frames.length < 2) return undefined
  const small = scan.frames.slice(1).filter(frame => frame.end - frame.start < SMALL_FRAME_BYTES).length
  if (small < minSmallFrames) return undefined
  const original = await complete(buffer)
  if (original === undefined) return undefined
  const { frames, plaintexts } = original
  const header = frames[0] as ZstdFrameRange
  const parts: Buffer[] = [buffer.subarray(header.start, header.end)]
  let group: number[] = []
  let size = 0
  const flush = async (): Promise<void> => {
    if (group.length === 1) {
      const frame = frames[group[0] as number] as ZstdFrameRange
      parts.push(buffer.subarray(frame.start, frame.end))
    } else if (group.length > 1) {
      parts.push(await compressZstdFrame(Buffer.concat(group.map(index => plaintexts[index] as Buffer))))
    }
    group = []
    size = 0
  }
  for (let index = 1; index < frames.length; index += 1) {
    const length = (plaintexts[index] as Buffer).length
    if (group.length > 0 && size + length > CONSOLIDATED_FRAME_BYTES) await flush()
    group.push(index)
    size += length
  }
  await flush()
  const consolidated = Buffer.concat(parts)
  if (consolidated.length >= buffer.length) return undefined
  const check = await complete(consolidated)
  if (check === undefined || !Buffer.concat(check.plaintexts).equals(Buffer.concat(plaintexts))
    || !(check.plaintexts[0] as Buffer).equals(plaintexts[0] as Buffer)) {
    throw new Error('consolidated session log does not decode to the original')
  }
  return consolidated
}
