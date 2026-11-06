/**
 * render-motion: turn an animated HTML page into an MP4, inside the sandbox.
 *
 *   render-motion <page.html> <out.mp4> [--seconds N] [--fps N] [--width N] [--height N] [--audio FILE]
 *
 * The page is driven frame by frame: a GSAP global timeline is paused and
 * sought, or the page's own `window.seek(seconds)` is called. Without
 * `--seconds`, the GSAP timeline's duration is used. GSAP requested from a CDN
 * is served from the image; every other network request fails, so fonts come
 * from the installed families. Frames stream straight into ffmpeg.
 *
 * host/install-motion.sh installs it as /opt/aeven-sandbox/motion/render-motion.mjs, run by
 * the /opt/aeven-sandbox/bin/render-motion wrapper.
 */
import { spawn } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const IMAGE = process.env.AEVEN_SANDBOX_IMAGE ?? '/opt/aeven-sandbox'
process.env.PLAYWRIGHT_BROWSERS_PATH ??= `${IMAGE}/ms-playwright`
const { chromium } = require(`${IMAGE}/node/node_modules/playwright-core`)
const GSAP_DIR = `${IMAGE}/node/node_modules/gsap/dist`

const LIMITS = { seconds: 120, fps: 60, width: 1920, height: 1920 }
const usage = 'usage: render-motion <page.html> <out.mp4> [--seconds N] [--fps N] [--width N] [--height N] [--audio FILE]'

function parse(argv) {
  const positional = []
  const options = { fps: 30, width: 1280, height: 720 }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) { positional.push(arg); continue }
    const value = argv[++i]
    if (value === undefined) throw new Error(`${arg} needs a value`)
    const key = arg.slice(2)
    if (key === 'audio') options.audio = value
    else if (['seconds', 'fps', 'width', 'height'].includes(key)) options[key] = Number(value)
    else throw new Error(`unknown option ${arg}`)
  }
  if (positional.length !== 2) throw new Error(usage)
  for (const key of ['seconds', 'fps', 'width', 'height']) {
    const value = options[key]
    if (value === undefined) continue
    if (!Number.isFinite(value) || value <= 0 || value > LIMITS[key]) throw new Error(`--${key} must be between 0 and ${LIMITS[key]}`)
  }
  options.width = Math.round(options.width / 2) * 2
  options.height = Math.round(options.height / 2) * 2
  return { page: resolve(positional[0]), out: resolve(positional[1]), ...options }
}

async function main() {
  const job = parse(process.argv.slice(2))
  if (!existsSync(job.page)) throw new Error(`no page at ${job.page}`)
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--font-render-hinting=none'] })
  try {
    const page = await browser.newPage({ viewport: { width: job.width, height: job.height } })
    await page.route('**/*', (route) => {
      const url = route.request().url()
      if (url.startsWith('file://') || url.startsWith('data:')) return route.continue()
      // A page written for the web loads GSAP from a CDN; serve the bundled copy.
      const name = new URL(url).pathname.split('/').pop() ?? ''
      if (/gsap/i.test(url) && /^[A-Za-z0-9_-]+(?:\.min)?\.js$/.test(name) && existsSync(`${GSAP_DIR}/${name}`)) {
        return route.fulfill({ contentType: 'application/javascript', body: readFileSync(`${GSAP_DIR}/${name}`) })
      }
      return route.abort()
    })
    await page.goto(`file://${job.page}`, { waitUntil: 'load' })
    await page.evaluate(() => document.fonts.ready)
    const timeline = await page.evaluate(() => {
      const g = globalThis.gsap
      if (g?.globalTimeline) {
        g.globalTimeline.pause()
        return { gsap: true, duration: g.globalTimeline.duration() }
      }
      return { gsap: false, duration: 0, seek: typeof globalThis.seek === 'function' }
    })
    const seconds = job.seconds ?? (timeline.gsap ? timeline.duration : undefined)
    if (seconds === undefined || seconds <= 0) throw new Error('the page has no GSAP timeline; pass --seconds and define window.seek(seconds)')
    if (seconds > LIMITS.seconds) throw new Error(`the film is ${seconds.toFixed(1)} s; the limit is ${LIMITS.seconds} s`)
    if (!timeline.gsap && !timeline.seek) throw new Error('the page needs a GSAP timeline or a window.seek(seconds) function')
    const frames = Math.max(1, Math.round(seconds * job.fps))
    const ffmpegArgs = ['-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(job.fps), '-i', '-']
    if (job.audio) ffmpegArgs.push('-i', resolve(job.audio), '-shortest', '-c:a', 'aac')
    ffmpegArgs.push('-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', job.out)
    const ffmpeg = spawn('ffmpeg', ffmpegArgs, { stdio: ['pipe', 'inherit', 'inherit'] })
    const finished = new Promise((ok, fail) => ffmpeg.on('close', code => code === 0 ? ok() : fail(new Error(`ffmpeg exited with ${code}`))))
    for (let i = 0; i < frames; i++) {
      const t = (i / job.fps)
      await page.evaluate((s) => {
        if (globalThis.gsap?.globalTimeline) globalThis.gsap.globalTimeline.seek(s, false)
        else globalThis.seek(s)
      }, t)
      const png = await page.screenshot({ type: 'jpeg', quality: 92 })
      if (!ffmpeg.stdin.write(png)) await new Promise(r => ffmpeg.stdin.once('drain', r))
    }
    ffmpeg.stdin.end()
    await finished
    console.log(`render-motion: wrote ${job.out} (${frames} frames, ${seconds.toFixed(2)} s, ${job.width}x${job.height} at ${job.fps} fps)`)
  } finally {
    await browser.close()
  }
}

main().catch((error) => { console.error(`render-motion: ${error.message}`); process.exit(1) })
