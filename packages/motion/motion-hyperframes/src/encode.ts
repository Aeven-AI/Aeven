/** ffmpeg and ffprobe invocations around a HyperFrames render: encoder probes, the fallback transcode, and output facts. @module */
import { spawn } from 'node:child_process'

/** Exit status and captured output of one finished process. */
interface Completed {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
}

/**
 * Run one executable to completion with argv passed verbatim.
 * @param command - executable path.
 * @param args - arguments.
 * @param signal - cancellation; aborting kills the process.
 * @returns exit status plus captured stdout and stderr.
 */
function execute(command: string, args: readonly string[], signal: AbortSignal): Promise<Completed> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, signal })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk })
    child.once('error', reject)
    child.once('close', (code) => { resolve({ code, stdout, stderr }) })
  })
}

/**
 * Pixel format each fallback encoder accepts: Media Foundation takes NV12, the others planar 4:2:0.
 * @param encoder - ffmpeg encoder name.
 * @returns the `-pix_fmt` value.
 */
function pixelFormat(encoder: string): string {
  return encoder.endsWith('_mf') ? 'nv12' : 'yuv420p'
}

/**
 * The first fallback encoder that encodes one test frame on this machine.
 * @param ffmpeg - ffmpeg executable.
 * @param encoders - candidate encoder names in preference order.
 * @param signal - cancellation.
 * @returns the working encoder, or undefined when none works.
 */
export async function firstWorkingEncoder(ffmpeg: string, encoders: readonly string[], signal: AbortSignal): Promise<string | undefined> {
  for (const encoder of encoders) {
    const probe = await execute(ffmpeg, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=size=256x256:rate=1:duration=1',
      '-frames:v', '1', '-an', '-pix_fmt', pixelFormat(encoder), '-c:v', encoder, '-f', 'null', '-',
    ], signal)
    if (probe.code === 0) return encoder
  }
  return undefined
}

/**
 * Re-encode a ProRes intermediate into an H.264 MP4, copying its AAC audio when it has any.
 * @param ffmpeg - ffmpeg executable.
 * @param input - intermediate `.mov` path.
 * @param output - MP4 path to write.
 * @param encoder - H.264 encoder returned by {@link firstWorkingEncoder}.
 * @param bitrate - target video bitrate, such as `12M`.
 * @param signal - cancellation.
 * @throws When ffmpeg exits non-zero; the message carries the tail of its log.
 */
export async function transcode(
  ffmpeg: string, input: string, output: string, encoder: string, bitrate: string, signal: AbortSignal,
): Promise<void> {
  const result = await execute(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', input,
    '-map', '0:v:0', '-map', '0:a?',
    '-c:v', encoder, '-b:v', bitrate, '-pix_fmt', pixelFormat(encoder),
    '-c:a', 'copy', '-movflags', '+faststart', output,
  ], signal)
  if (result.code !== 0) throw new Error(`H.264 encode with ${encoder} failed: ${result.stderr.trim().slice(-800)}`)
}

/** Facts ffprobe reports about a written film. */
export interface FilmFacts {
  readonly durationSeconds: number
  readonly width: number
  readonly height: number
}

/**
 * Read a film's duration and first video stream dimensions.
 * @param ffprobe - ffprobe executable.
 * @param path - film path.
 * @param signal - cancellation.
 * @returns duration in seconds and frame size.
 * @throws When ffprobe fails or reports no video stream.
 */
export async function probeFilm(ffprobe: string, path: string, signal: AbortSignal): Promise<FilmFacts> {
  const result = await execute(ffprobe, [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', path,
  ], signal)
  if (result.code !== 0) throw new Error(`ffprobe failed: ${result.stderr.trim().slice(-400)}`)
  const parsed = JSON.parse(result.stdout) as { streams?: { width?: number; height?: number }[]; format?: { duration?: string } }
  const stream = parsed.streams?.[0]
  if (stream?.width === undefined || stream.height === undefined) throw new Error(`ffprobe found no video stream in ${path}`)
  return { durationSeconds: Number(parsed.format?.duration ?? 0), width: stream.width, height: stream.height }
}

/**
 * Take evenly spaced PNG stills from a film, at `duration * i / (count + 1)` for `i` in `1..count`.
 * @param ffmpeg - ffmpeg executable.
 * @param path - film path.
 * @param durationSeconds - film length.
 * @param count - number of stills.
 * @param width - still width in pixels; height follows the film's aspect ratio.
 * @param signal - cancellation.
 * @returns the stills in film order.
 * @throws When ffmpeg fails to decode a frame.
 */
export async function takeStills(
  ffmpeg: string, path: string, durationSeconds: number, count: number, width: number, signal: AbortSignal,
): Promise<{ seconds: number; png: Uint8Array }[]> {
  const stills: { seconds: number; png: Uint8Array }[] = []
  for (let index = 1; index <= count; index++) {
    const seconds = Math.round(durationSeconds * index / (count + 1) * 1000) / 1000
    const png = await new Promise<Uint8Array>((resolve, reject) => {
      const child = spawn(ffmpeg, [
        '-hide_banner', '-loglevel', 'error', '-ss', String(seconds), '-i', path,
        '-frames:v', '1', '-vf', `scale=${String(width)}:-2`, '-f', 'image2pipe', '-c:v', 'png', '-',
      ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, signal })
      const chunks: Buffer[] = []
      let stderr = ''
      child.stdout.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk })
      child.once('error', reject)
      child.once('close', (code) => {
        if (code === 0 && chunks.length > 0) resolve(new Uint8Array(Buffer.concat(chunks)))
        else reject(new Error(`still at ${String(seconds)}s failed: ${stderr.trim().slice(-400)}`))
      })
    })
    stills.push({ seconds, png })
  }
  return stills
}
