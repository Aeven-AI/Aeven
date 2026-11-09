/**
 * render-motion: turn an animated HTML page into an MP4, inside the sandbox.
 *
 *   render-motion <page.html | -> <out.mp4> [--seconds N] [--fps N] [--width N] [--height N] [--audio FILE]
 *                 [--crf N] [--still-times S,S,...] [--still-width N] [--json]
 *
 * The page is driven frame by frame. A page carrying a HyperFrames composition
 * bundled with its runtime, as the Motion card plays it, is sought through the
 * runtime's own player, and its root's `data-width` and `data-height` size the
 * frame unless `--width` or `--height` is given. Otherwise a GSAP global
 * timeline is paused and sought, or the page's own `window.seek(seconds)` is
 * called. Without `--seconds`, the composition's or GSAP timeline's duration is
 * used. A page of `-` is read from stdin. GSAP requested from a CDN is served
 * from the image; every other network request fails, so fonts come from the
 * installed families. Frames stream straight into ffmpeg's libx264 at `--crf`
 * (default 23).
 *
 * `--still-times S,S,...` also takes a frame at each of those film times (up to
 * 16; a time past the end takes the last frame), scaled to `--still-width`
 * pixels wide (default 960). `--json` replaces the summary line with one JSON
 * line: `{ seconds, width, height, fps, frames, encoder, stills: [{ seconds, png }] }`,
 * each still's PNG in base64.
 *
 * host/install-motion.sh installs it as /opt/aeven-sandbox/motion/render-motion.mjs, run by
 * the /opt/aeven-sandbox/bin/render-motion wrapper.
 */
import { spawn } from 'node:child_process'
import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const IMAGE = process.env.AEVEN_SANDBOX_IMAGE ?? '/opt/aeven-sandbox'
process.env.PLAYWRIGHT_BROWSERS_PATH ??= `${IMAGE}/ms-playwright`
const { chromium } = require(`${IMAGE}/node/node_modules/playwright-core`)
const GSAP_DIR = `${IMAGE}/node/node_modules/gsap/dist`

const LIMITS = { seconds: 120, fps: 60, width: 1920, height: 1920, crf: 51, 'still-width': 1920 }
/** Most stills one render returns. */
const MAX_STILLS = 16
const NUMERIC = Object.keys(LIMITS)
const usage = 'usage: render-motion <page.html | -> <out.mp4> [--seconds N] [--fps N] [--width N] [--height N] [--audio FILE] [--crf N] [--still-times S,S,...] [--still-width N] [--json]'
/** How long a HyperFrames composition may take to report ready, in milliseconds. */
const READY_MS = 30_000

function parse(argv) {
  const positional = []
  const options = { fps: 30, crf: 23, 'still-width': 960, json: false, stillTimes: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '-' || !arg.startsWith('--')) { positional.push(arg); continue }
    const key = arg.slice(2)
    if (key === 'json') { options.json = true; continue }
    const value = argv[++i]
    if (value === undefined) throw new Error(`${arg} needs a value`)
    if (key === 'audio') options.audio = value
    else if (key === 'still-times') options.stillTimes = value.split(',').map(Number)
    else if (NUMERIC.includes(key)) options[key] = Number(value)
    else throw new Error(`unknown option ${arg}`)
  }
  if (positional.length !== 2) throw new Error(usage)
  for (const key of NUMERIC) {
    const value = options[key]
    if (value === undefined) continue
    const zeroAllowed = key === 'crf'
    if (!Number.isFinite(value) || (zeroAllowed ? value < 0 : value <= 0) || value > LIMITS[key]) {
      throw new Error(`--${key} must be ${zeroAllowed ? 'from 0' : 'above 0'} up to ${LIMITS[key]}`)
    }
  }
  if (options.stillTimes.length > MAX_STILLS || options.stillTimes.some(time => !Number.isFinite(time) || time < 0)) {
    throw new Error(`--still-times takes up to ${MAX_STILLS} times of 0 seconds or more`)
  }
  return { ...options, page: positional[0] === '-' ? '-' : resolve(positional[0]), out: resolve(positional[1]) }
}

/** Even frame dimensions, as H.264 with yuv420p requires. */
const even = value => Math.max(2, Math.round(value / 2) * 2)

/**
 * Scale one PNG to `width` pixels wide through ffmpeg.
 * @param png - the full-size frame.
 * @param width - target width.
 * @returns the scaled PNG.
 */
function scalePng(png, width) {
  return new Promise((ok, fail) => {
    const ffmpeg = spawn('ffmpeg', ['-loglevel', 'error', '-f', 'png_pipe', '-i', '-', '-vf', `scale=${width}:-2`, '-f', 'image2pipe', '-c:v', 'png', '-'], { stdio: ['pipe', 'pipe', 'inherit'] })
    const chunks = []
    ffmpeg.stdout.on('data', chunk => chunks.push(chunk))
    ffmpeg.on('close', code => code === 0 ? ok(Buffer.concat(chunks)) : fail(new Error(`ffmpeg exited with ${code} scaling a still`)))
    ffmpeg.stdin.end(png)
  })
}

async function main() {
  const job = parse(process.argv.slice(2))
  let scratch
  let pagePath = job.page
  if (pagePath === '-') {
    scratch = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'render-motion-'))
    pagePath = join(scratch, 'page.html')
    writeFileSync(pagePath, readFileSync(0))
  }
  try {
    if (!existsSync(pagePath)) throw new Error(`no page at ${pagePath}`)
    const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--font-render-hinting=none'] })
    try {
      await render(browser, job, pagePath)
    } finally {
      await browser.close()
    }
  } finally {
    if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true })
  }
}

async function render(browser, job, pagePath) {
  const page = await browser.newPage({ viewport: { width: even(job.width ?? 1280), height: even(job.height ?? 720) } })
  await page.route('**/*', (route) => {
    const url = route.request().url()
    if (url.startsWith('file://') || url.startsWith('data:') || url.startsWith('blob:')) return route.continue()
    // A page written for the web loads GSAP from a CDN; serve the bundled copy.
    const name = new URL(url).pathname.split('/').pop() ?? ''
    if (/gsap/i.test(url) && /^[A-Za-z0-9_-]+(?:\.min)?\.js$/.test(name) && existsSync(`${GSAP_DIR}/${name}`)) {
      return route.fulfill({ contentType: 'application/javascript', body: readFileSync(`${GSAP_DIR}/${name}`) })
    }
    return route.abort()
  })
  await page.goto(`file://${pagePath}`, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)

  // A HyperFrames composition: wait for its runtime, then size the frame from its root.
  const composition = await page.evaluate(() => {
    const root = document.querySelector('[data-composition-id]')
    if (root === null) return undefined
    return { width: Number(root.getAttribute('data-width')) || undefined, height: Number(root.getAttribute('data-height')) || undefined }
  })
  if (composition !== undefined) {
    await page.waitForFunction(() => globalThis.__playerReady === true && globalThis.__player !== undefined, undefined, { timeout: READY_MS })
      .catch(() => { throw new Error('the HyperFrames composition did not report ready within 30 s') })
    job.width = even(Math.min(LIMITS.width, job.width ?? composition.width ?? 1920))
    job.height = even(Math.min(LIMITS.height, job.height ?? composition.height ?? 1080))
    await page.setViewportSize({ width: job.width, height: job.height })
  } else {
    job.width = even(job.width ?? 1280)
    job.height = even(job.height ?? 720)
  }
  const timeline = await page.evaluate(() => {
    if (globalThis.__player !== undefined) {
      globalThis.__player.pause?.()
      return { driver: 'player', duration: Number(globalThis.__player.getDuration()) || 0 }
    }
    const g = globalThis.gsap
    if (g?.globalTimeline) {
      g.globalTimeline.pause()
      return { driver: 'gsap', duration: g.globalTimeline.duration() }
    }
    return { driver: typeof globalThis.seek === 'function' ? 'seek' : undefined, duration: 0 }
  })
  const seconds = job.seconds ?? (timeline.duration > 0 ? timeline.duration : undefined)
  if (seconds === undefined || seconds <= 0) throw new Error('the page has no timeline; pass --seconds and define window.seek(seconds)')
  if (seconds > LIMITS.seconds) throw new Error(`the film is ${seconds.toFixed(1)} s; the limit is ${LIMITS.seconds} s`)
  if (timeline.driver === undefined) throw new Error('the page needs a GSAP timeline or a window.seek(seconds) function')
  const seekTo = s => page.evaluate(async ([driver, t]) => {
    if (driver === 'player') {
      await globalThis.__player.renderSeek(t)
      await globalThis.__hfWaitForSeekCompletion?.()
    } else if (driver === 'gsap') globalThis.gsap.globalTimeline.seek(t, false)
    else await globalThis.seek(t)
  }, [timeline.driver, s])

  const frames = Math.max(1, Math.round(seconds * job.fps))
  const ffmpegArgs = ['-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(job.fps), '-i', '-']
  if (job.audio) ffmpegArgs.push('-i', resolve(job.audio), '-shortest', '-c:a', 'aac')
  ffmpegArgs.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(job.crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', job.out)
  const ffmpeg = spawn('ffmpeg', ffmpegArgs, { stdio: ['pipe', 'inherit', 'inherit'] })
  const finished = new Promise((ok, fail) => ffmpeg.on('close', code => code === 0 ? ok() : fail(new Error(`ffmpeg exited with ${code}`))))
  for (let i = 0; i < frames; i++) {
    await seekTo(i / job.fps)
    const jpeg = await page.screenshot({ type: 'jpeg', quality: 92 })
    if (!ffmpeg.stdin.write(jpeg)) await new Promise(r => ffmpeg.stdin.once('drain', r))
  }
  ffmpeg.stdin.end()
  await finished

  // A time at or past the end takes the film's last frame.
  const last = Math.max(0, frames - 1) / job.fps
  const stills = []
  for (const time of job.stillTimes) {
    const at = Math.round(Math.min(time, last) * 1000) / 1000
    await seekTo(at)
    const png = await page.screenshot({ type: 'png' })
    const scaled = job['still-width'] < job.width ? await scalePng(png, even(job['still-width'])) : png
    stills.push({ seconds: at, png: scaled.toString('base64') })
  }
  if (job.json) {
    console.log(JSON.stringify({ seconds, width: job.width, height: job.height, fps: job.fps, frames, encoder: 'libx264', stills }))
  } else {
    console.log(`render-motion: wrote ${job.out} (${frames} frames, ${seconds.toFixed(2)} s, ${job.width}x${job.height} at ${job.fps} fps)`)
  }
}

main().catch((error) => { console.error(`render-motion: ${error.message}`); process.exit(1) })
