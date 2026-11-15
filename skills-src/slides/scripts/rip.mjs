/**
 * Rips the slide images of Figma community presentation files through the
 * user's own Chrome, which is already signed in to Figma.
 *
 * The images are served from a CDN that challenges any cross-origin fetch and
 * any canvas read of the rendered bitmap, so the only reliable way to read a
 * slide is to render it in the page and capture it with the browser's own
 * screenshot capture. This script clones the deck's preview images into a tall
 * overlay, captures each one, and writes it as a PNG. `extract.py` then reads
 * the palette and type scale off those PNGs.
 *
 * Usage: node scripts/rip.mjs <out-dir> [max-files] [port]
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PORT = Number(process.argv[4] ?? 9333)
const OUT = process.argv[2] ?? '/tmp/aeven-rip'
const MAX_FILES = Number(process.argv[3] ?? 48)
const LISTING = 'https://www.figma.com/community/presentations?resource_type=files'

const log = (...parts) => console.log(new Date().toISOString().slice(11, 19), ...parts)

async function newTarget() {
  const response = await fetch(`http://127.0.0.1:${PORT}/json/new?url=about:blank`, { method: 'PUT' })
  if (!response.ok) throw new Error(`cannot open a tab: ${response.status}`)
  return response.json()
}

class Session {
  constructor(socket) {
    this.socket = socket
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Set()
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error) reject(new Error(message.error.message))
        else resolve(message.result)
        return
      }
      for (const listener of this.listeners) listener(message)
    })
  }

  send(method, params = {}) {
    const id = this.nextId++
    this.socket.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`${method} timed out`))
        }
      }, 60_000)
    })
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
    return result.result.value
  }

  waitForEvent(name, timeout = 30_000) {
    return new Promise((resolve) => {
      const listener = (message) => {
        if (message.method !== name) return
        this.listeners.delete(listener)
        resolve(message.params)
      }
      this.listeners.add(listener)
      setTimeout(() => {
        this.listeners.delete(listener)
        resolve(null)
      }, timeout)
    })
  }
}

async function connect() {
  const target = await newTarget()
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  const session = new Session(socket)
  await session.send('Page.enable')
  await session.send('Runtime.enable')
  return { session, target }
}

async function harvest(session, origin) {
  await session.send('Page.navigate', { url: `${origin}/community/presentations?resource_type=files` })
  await session.waitForEvent('Page.loadEventFired')
  await new Promise((resolve) => setTimeout(resolve, 4000))
  const urls = new Set()
  for (let scroll = 0; scroll < 14; scroll += 1) {
    const found = await session.evaluate(`(() => {
      for (const link of document.querySelectorAll('a[href*="/community/file/"]')) {
        link.dataset.aevenHref = link.getAttribute('href').split('?')[0];
      }
      window.scrollTo(0, document.body.scrollHeight);
      return [...new Set([...document.querySelectorAll('[data-aeven-href]')].map(el => el.dataset.aevenHref))];
    })()`)
    for (const href of found) urls.add(`${origin}${href}`)
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
  return [...urls]
}

async function ripFile(session, url, outDir) {
  await session.send('Page.navigate', { url })
  const loaded = session.waitForEvent('Page.loadEventFired')
  await loaded
  await new Promise((resolve) => setTimeout(resolve, 3500))

  const images = await session.evaluate(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const pick = () => [...new Set([...document.querySelectorAll('img')]
      .filter(img => img.naturalWidth >= 600 && (img.currentSrc || img.src || '').includes('/carousel/img/'))
      .map(img => img.currentSrc || img.src))];
    let urls = pick();
    for (let attempt = 0; attempt < 20 && urls.length < 4; attempt += 1) {
      await sleep(500);
      urls = pick();
    }
    if (urls.length === 0) return { error: 'no slide images' };
    const host = document.createElement('div');
    host.id = '__aeven_rip__';
    host.style.cssText = 'position:absolute;top:0;left:0;z-index:2147483647;background:#fff;padding:0;margin:0;width:1000px';
    document.body.appendChild(host);
    const rects = [];
    for (const url of urls.slice(0, 16)) {
      const image = document.createElement('img');
      image.src = url;
      image.style.cssText = 'display:block;width:1000px;height:auto;margin:0';
      host.appendChild(image);
      await new Promise((resolve) => {
        if (image.complete) return resolve();
        image.onload = resolve;
        image.onerror = resolve;
        setTimeout(resolve, 5000);
      });
      const rect = image.getBoundingClientRect();
      rects.push({ src: url, x: rect.x + window.scrollX, y: rect.y + window.scrollY, width: rect.width, height: rect.height });
    }
    return { rects, title: document.title };
  })()`)

  if (images.error) {
    log('skip', url, images.error)
    return null
  }

  const folder = join(outDir, url.split('/').slice(-1)[0].replace(/[^a-z0-9-]/gi, '-').slice(0, 40))
  mkdirSync(folder, { recursive: true })
  let saved = 0
  for (const [index, rect] of images.rects.entries()) {
    if (!rect.height) continue
    try {
      const shot = await session.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 0.5 },
      })
      writeFileSync(join(folder, `slide-${String(index + 1).padStart(2, '0')}.png`), Buffer.from(shot.data, 'base64'))
      saved += 1
    } catch (error) {
      log('capture failed', url, index, String(error).slice(0, 80))
    }
  }
  await session.evaluate(`document.getElementById('__aeven_rip__')?.remove()`)
  writeFileSync(join(folder, 'meta.json'), JSON.stringify({ url, title: images.title, slides: saved }, null, 2))
  log('ripped', folder.split('/').slice(-1)[0], saved, 'slides')
  return folder
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const { session, target } = await connect()
  const urls = process.argv[5] ? JSON.parse(process.argv[5]) : await harvest(session, 'https://www.figma.com')
  log('candidates', urls.length)
  const done = []
  for (const url of urls.slice(0, MAX_FILES)) {
    try {
      const folder = await ripFile(session, url, OUT)
      if (folder) done.push(folder)
    } catch (error) {
      log('failed', url, String(error).slice(0, 120))
    }
  }
  writeFileSync(join(OUT, 'index.json'), JSON.stringify(done, null, 2))
  log('done', done.length)
  await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`)
}

await main()
