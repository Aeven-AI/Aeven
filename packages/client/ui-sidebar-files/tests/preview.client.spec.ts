// @vitest-environment jsdom
/**
 * The rendered view of a workspace HTML page: its workspace stylesheets, scripts, images, and CSS `url()`s are
 * inlined, remote and inline references stay as written, the document carries its own content policy, and files the
 * page's scripts load while running reach it through the app.
 */
import { Blob as NodeBlob } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import { dependencyVersions, previewDocument, resolveReference, serveFrameFiles } from '../src/client/preview.ts'

/** The token the built pages in this file carry. */
const TOKEN = 'page-token'

/** The runtime file bridge a built page runs first: the head's element after its content policy. */
function bridgeOf(doc: Document): HTMLScriptElement {
  const bridge = doc.head.children[1]
  expect(bridge?.tagName).toBe('SCRIPT')
  return bridge as HTMLScriptElement
}

/** A built page's own scripts, without the bridge. */
function pageScripts(doc: Document): HTMLScriptElement[] {
  const bridge = bridgeOf(doc)
  return [...doc.querySelectorAll('script')].filter(script => script !== bridge)
}

describe('resolveReference', () => {
  it.each([
    ['site', 'style.css', 'site/style.css'],
    ['site', './img/a.png', 'site/img/a.png'],
    ['site/pages', '../style.css', 'site/style.css'],
    ['site', '/assets/logo.svg', 'assets/logo.svg'],
    ['site', 'a%20b.png?v=2#top', 'site/a b.png'],
    ['', 'index.css', 'index.css'],
    ['/Users/me/vase', './src/main.js', '/Users/me/vase/src/main.js'],
    ['/Users/me/vase/src', '../styles.css', '/Users/me/vase/styles.css'],
  ])('resolves %j + %j to %j', (folder, reference, path) => {
    expect(resolveReference(folder, reference)).toBe(path)
  })

  it('refuses a reference that climbs above the workspace root', () => {
    expect(resolveReference('site', '../../secret.css')).toBeUndefined()
  })
})

/** A reader over fixed workspace files, recording what it was asked for. */
function reader(files: Record<string, string | Blob>) {
  const asked: string[] = []
  const read = async (path: string): Promise<Blob | undefined> => {
    asked.push(path)
    const file = files[path]
    return file === undefined ? undefined : typeof file === 'string' ? new Blob([file]) : file
  }
  return { read, asked }
}

describe('previewDocument', () => {
  it('inlines the page workspace stylesheets, scripts, images, and stylesheet urls', async () => {
    const files = reader({
      'site/style.css': 'body { background: url("bg.png") }',
      'site/bg.png': new Blob(['PNG'], { type: 'image/png' }),
      'site/app.js': 'document.title = "ran"',
      'site/img/logo.png': new Blob(['LOGO'], { type: 'image/png' }),
    })
    const html = [
      '<html><head><link rel="stylesheet" href="style.css"><script src="app.js"></script></head>',
      '<body><img src="img/logo.png" alt="logo"></body></html>',
    ].join('')
    const page = await previewDocument(html, 'site/index.html', files.read, new AbortController().signal, TOKEN)
    const doc = new DOMParser().parseFromString(page, 'text/html')

    expect(doc.querySelector('link[rel="stylesheet"]')).toBeNull()
    expect(doc.querySelector('style')?.textContent).toMatch(/url\("data:image\/png;base64,/)
    const script = pageScripts(doc)[0]
    expect(script?.hasAttribute('src')).toBe(false)
    expect(script?.textContent).toBe('document.title = "ran"')
    expect(doc.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/png;base64,/)
    expect(files.asked.sort()).toEqual(['site/app.js', 'site/bg.png', 'site/img/logo.png', 'site/style.css'])
  })

  it('leaves remote, inline, and missing references as written', async () => {
    const files = reader({})
    const html = '<link rel="stylesheet" href="https://cdn.example/a.css"><img src="data:image/gif;base64,R0"><img src="missing.png">'
    const page = await previewDocument(html, 'index.html', files.read, new AbortController().signal, TOKEN)
    const doc = new DOMParser().parseFromString(page, 'text/html')

    expect(doc.querySelector('link')?.getAttribute('href')).toBe('https://cdn.example/a.css')
    expect([...doc.querySelectorAll('img')].map(image => image.getAttribute('src'))).toEqual(['data:image/gif;base64,R0', 'missing.png'])
    expect(files.asked).toEqual(['missing.png'])
  })

  it('heads the document with a content policy and keeps an inlined script from closing its element', async () => {
    const files = reader({ 'x.js': 'const s = "</script><b>"' })
    const page = await previewDocument('<script src="x.js"></script>', 'index.html', files.read, new AbortController().signal, TOKEN)
    const doc = new DOMParser().parseFromString(page, 'text/html')

    expect(doc.head.firstElementChild?.getAttribute('http-equiv')).toBe('Content-Security-Policy')
    expect(doc.head.firstElementChild?.getAttribute('content')).toContain("default-src 'none'")
    expect(pageScripts(doc)).toHaveLength(1)
    expect(doc.querySelector('b')).toBeNull()
  })

  it('runs the runtime file bridge before every page script, ahead of the import map', async () => {
    const files = reader({ 'app/util.js': 'export const u = 1' })
    const html = '<html><head></head><body><script type="module">import { u } from "./util.js"</script></body></html>'
    const page = await previewDocument(html, 'app/index.html', files.read, new AbortController().signal, TOKEN)
    const doc = new DOMParser().parseFromString(page, 'text/html')

    const bridge = bridgeOf(doc)
    expect(bridge.hasAttribute('type')).toBe(false)
    expect(bridge.textContent).toContain(JSON.stringify(TOKEN))
    expect(doc.head.children[2]?.getAttribute('type')).toBe('importmap')
    expect(doc.head.firstElementChild?.getAttribute('content')).toContain('connect-src blob: https:')
  })

  it('reads a quoted stylesheet url whole, so a url inside a data image is not taken for a file', async () => {
    const files = reader({ 'site/a b.png': new Blob(['PNG'], { type: 'image/png' }) })
    const svg = "data:image/svg+xml,%3Csvg%3E%3Cfilter id='n'/%3E%3Crect filter='url(%23n)'/%3E%3C/svg%3E"
    const html = `<style>.grain { background: url("${svg}") } .photo { background: url( 'a b.png' ) }</style>`
    const page = await previewDocument(html, 'site/index.html', files.read, new AbortController().signal, TOKEN)
    const style = new DOMParser().parseFromString(page, 'text/html').querySelector('style')?.textContent ?? ''

    expect(style).toContain(`url("${svg}")`)
    expect(style).toMatch(/\.photo \{ background: url\("data:image\/png;base64,/)
    expect(files.asked).toEqual(['site/a b.png'])
  })

  it('drops fetch hints for workspace files and keeps remote ones', async () => {
    const html = [
      '<link rel="preload" href="assets/fonts/a.woff2" as="font" crossorigin>',
      '<link rel="modulepreload" href="./src/main.js"><link rel="prefetch" href="next.html">',
      '<link rel="preload" href="https://cdn.example/b.woff2" as="font">',
    ].join('')
    const page = await previewDocument(html, 'site/index.html', reader({}).read, new AbortController().signal, TOKEN)
    const hints = [...new DOMParser().parseFromString(page, 'text/html').querySelectorAll('link')].map(link => link.getAttribute('href'))
    expect(hints).toEqual(['https://cdn.example/b.woff2'])
  })

  it('stops when the file view moves on', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(previewDocument('<p>hi</p>', 'index.html', reader({}).read, controller.signal, TOKEN)).rejects.toThrow()
  })
})

describe('previewDocument ES modules', () => {
  /** The generated import map of a built page, with each module's text decoded from its `data:` URL. */
  function modulesOf(doc: Document): Record<string, string> {
    const maps = doc.querySelectorAll('script[type="importmap"]')
    expect(maps).toHaveLength(1)
    const imports = (JSON.parse(maps[0]?.textContent ?? '{}') as { imports: Record<string, string> }).imports
    return Object.fromEntries(Object.entries(imports).map(([key, url]) => {
      expect(url).toMatch(/^data:text\/javascript;base64,/)
      const bytes = Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), char => char.charCodeAt(0))
      return [key, new TextDecoder().decode(bytes)]
    }))
  }

  it('inlines a module graph reached through relative imports and the page import map, each module once', async () => {
    const files = reader({
      'vase/src/main.js': [
        "import * as THREE from 'three'",
        "import { Lights } from 'three/addons/lights/Lights.js'",
        "import { shard } from './geometry.js'",
        "const late = () => import('./late.js')",
        'console.log(THREE, Lights, shard, late, import.meta.url)',
      ].join('\n'),
      'vase/src/geometry.js': "import * as THREE from 'three'\nimport { main } from './main.js'\nexport const shard = [THREE, main]",
      'vase/src/late.js': 'export default 1',
      'vase/node_modules/three/build/three.module.js': 'export const REVISION = "169"',
      'vase/node_modules/three/examples/jsm/lights/Lights.js': "import { REVISION } from 'three'\nexport const Lights = REVISION",
    })
    const html = [
      '<html><head><script type="importmap">{"imports":{"three":"./node_modules/three/build/three.module.js",',
      '"three/addons/":"./node_modules/three/examples/jsm/"}}</script></head>',
      '<body><canvas id="gl"></canvas><script type="module" src="./src/main.js"></script></body></html>',
    ].join('')
    const page = await previewDocument(html, 'vase/index.html', files.read, new AbortController().signal, TOKEN)
    const doc = new DOMParser().parseFromString(page, 'text/html')

    const three = '@avn-workspace/vase/node_modules/three/build/three.module.js'
    const entry = doc.querySelector('script[type="module"]')
    expect(entry?.hasAttribute('src')).toBe(false)
    expect(entry?.textContent).toContain(`from '${three}'`)
    expect(entry?.textContent).toContain('import("@avn-workspace/vase/src/late.js")')
    // The entry runs from its own text, so its import.meta.url is its workspace address.
    expect(entry?.textContent).toContain('({ ...import.meta, url: "https://workspace.invalid/vase/src/main.js" }).url')
    const modules = modulesOf(doc)
    expect(Object.keys(modules).sort()).toEqual([
      '@avn-workspace/vase/node_modules/three/build/three.module.js',
      '@avn-workspace/vase/node_modules/three/examples/jsm/lights/Lights.js',
      '@avn-workspace/vase/src/geometry.js',
      '@avn-workspace/vase/src/late.js',
      '@avn-workspace/vase/src/main.js',
    ])
    // The import cycle back to main.js resolves through the map like any other import.
    expect(modules['@avn-workspace/vase/src/geometry.js']).toContain("from '@avn-workspace/vase/src/main.js'")
    expect(modules['@avn-workspace/vase/node_modules/three/examples/jsm/lights/Lights.js']).toContain(`from '${three}'`)
    expect(files.asked.filter(path => path.endsWith('three.module.js'))).toHaveLength(1)
  })

  it('rewrites an inline module and leaves remote and unmapped specifiers as written', async () => {
    const files = reader({ 'app/util.js': 'export const u = 1' })
    const html = [
      '<html><head></head><body><script type="module">',
      "import { u } from './util.js'\nimport confetti from 'https://cdn.example/confetti.js'\nimport lodash from 'lodash'",
      '</script></body></html>',
    ].join('')
    const page = await previewDocument(html, 'app/index.html', files.read, new AbortController().signal, TOKEN)
    const doc = new DOMParser().parseFromString(page, 'text/html')

    const text = doc.querySelector('script[type="module"]')?.textContent ?? ''
    expect(text).toContain("from '@avn-workspace/app/util.js'")
    expect(text).toContain("from 'https://cdn.example/confetti.js'")
    expect(text).toContain("from 'lodash'")
    expect(Object.keys(modulesOf(doc))).toEqual(['@avn-workspace/app/util.js'])
  })

  it('reads the files of a page outside the workspace by their absolute paths', async () => {
    const files = reader({
      '/Users/me/vase/styles.css': 'body { color: blue }',
      '/Users/me/vase/src/main.js': "import { u } from './util.js'",
      '/Users/me/vase/src/util.js': 'export const u = 1',
    })
    const html = '<html><head><link rel="stylesheet" href="./styles.css"></head><body><script type="module" src="./src/main.js"></script></body></html>'
    const page = await previewDocument(html, '/Users/me/vase/index.html', files.read, new AbortController().signal, TOKEN)
    const doc = new DOMParser().parseFromString(page, 'text/html')

    expect(doc.querySelector('style')?.textContent).toBe('body { color: blue }')
    expect(doc.querySelector('script[type="module"]')?.textContent).toContain("from '@avn-workspace//Users/me/vase/src/util.js'")
    expect(Object.keys(modulesOf(doc))).toEqual(['@avn-workspace//Users/me/vase/src/util.js'])
  })

  it('loads a dependency this copy lacks from the CDN at the locked version, one instance for every importer', async () => {
    const files = reader({
      '/Users/me/vase/src/main.js': "import * as THREE from 'three'\nimport { Lights } from 'three/addons/lights/Lights.js'\nconsole.log(THREE, Lights)",
      '/Users/me/vase/package-lock.json': JSON.stringify({ packages: { '': {}, 'node_modules/three': { version: '0.169.0' } } }),
    })
    const html = [
      '<html><head><script type="importmap">{"imports":{"three":"./node_modules/three/build/three.module.js",',
      '"three/addons/":"./node_modules/three/examples/jsm/"}}</script></head>',
      '<body><script type="module" src="./src/main.js"></script></body></html>',
    ].join('')
    const page = await previewDocument(html, '/Users/me/vase/index.html', files.read, new AbortController().signal, TOKEN)
    const doc = new DOMParser().parseFromString(page, 'text/html')

    const imports = (JSON.parse(doc.querySelector('script[type="importmap"]')?.textContent ?? '{}') as { imports: Record<string, string> }).imports
    const three = 'https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js'
    expect(imports['@avn-workspace//Users/me/vase/node_modules/three/build/three.module.js']).toBe(three)
    expect(imports['@avn-workspace//Users/me/vase/node_modules/three/examples/jsm/lights/Lights.js'])
      .toBe('https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/lights/Lights.js')
    // A module the CDN serves imports `three` by name; the page's own name points at the same URL, so one instance runs.
    expect(imports.three).toBe(three)
    expect(imports['three/addons/']).toBe('https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/')
  })

  it('leaves a dependency without a recorded version unmapped', async () => {
    const files = reader({ 'app/main.js': "import lodash from 'lodash'" })
    const html = '<html><head><script type="importmap">{"imports":{"lodash":"./node_modules/lodash/lodash.js"}}</script></head><body><script type="module" src="./main.js"></script></body></html>'
    const page = await previewDocument(html, 'app/index.html', files.read, new AbortController().signal, TOKEN)
    const map = new DOMParser().parseFromString(page, 'text/html').querySelector('script[type="importmap"]')
    expect(map).toBeNull()
  })

  it('adds no import map to a page without modules', async () => {
    const page = await previewDocument('<html><head></head><body><p>hi</p></body></html>', 'a.html', reader({}).read, new AbortController().signal, TOKEN)
    expect(new DOMParser().parseFromString(page, 'text/html').querySelector('script[type="importmap"]')).toBeNull()
  })
})

describe('runtime file bridge in the page', () => {
  /**
   * Run a built page's bridge against a stand-in window, parent and document: the app's base URL, a native `fetch`
   * that records what reaches the network, and a parent that records each request.
   */
  async function bridge() {
    const page = await previewDocument('<p>3D</p>', 'car/view.html', reader({}).read, new AbortController().signal, TOKEN)
    const script = bridgeOf(new DOMParser().parseFromString(page, 'text/html')).textContent
    const network = vi.fn(async () => new Response('remote'))
    const requests: Array<{ id: number; path?: string; reference?: string }> = []
    let listener: ((event: { source: unknown; data: unknown }) => void) | undefined
    const parent = {
      postMessage: ({ id, path, reference }: Record<string, unknown>) => {
        requests.push({ id: id as number, ...(typeof path === 'string' ? { path } : {}), ...(typeof reference === 'string' ? { reference } : {}) })
      },
    }
    const frame = { fetch: network } as { fetch: typeof fetch }
    // The script is the page's own text, run with its globals bound to the stand-ins, and with Node's Blob, which the
    // test runtime's Response reads (a browser has one Blob).
    new Function('window', 'parent', 'addEventListener', 'document', 'Blob', script)(
      frame,
      parent,
      (type: string, handler: typeof listener) => { if (type === 'message') listener = handler },
      { baseURI: 'http://127.0.0.1:3080/c/session-1' },
      NodeBlob,
    )
    const deliver = (event: { source: unknown; data: unknown }) => { listener?.(event) }
    const answer = (id: number, body: NodeBlob | undefined) => { deliver({ source: parent, data: { avnWorkspaceFile: TOKEN, id, body } }) }
    return { fetch: frame.fetch, network, requests, answer, parent, deliver }
  }

  it('sends a relative fetch to the app and answers it with the file', async () => {
    const page = await bridge()
    const response = page.fetch('./roadster.glb')
    expect(page.requests).toEqual([{ id: 1, path: '/car/roadster.glb' }])
    page.answer(1, new NodeBlob(['GLB'], { type: 'model/gltf-binary' }))
    const settled = await response
    expect(settled.status).toBe(200)
    expect(settled.headers.get('Content-Type')).toBe('model/gltf-binary')
    expect(await settled.text()).toBe('GLB')
    expect(page.network).not.toHaveBeenCalled()
  })

  it('maps a request the page resolved against the inherited app URL back to the file it named', async () => {
    const page = await bridge()
    void page.fetch(new Request('http://127.0.0.1:3080/c/textures/paint.png?v=2'))
    expect(page.requests).toEqual([{ id: 1, path: '/car/textures/paint.png' }])
  })

  it('answers a missing file with 404 and lets remote requests through', async () => {
    const page = await bridge()
    const missing = page.fetch('gone.glb')
    page.answer(1, undefined)
    expect((await missing).status).toBe(404)
    await page.fetch('https://cdn.example/model.glb')
    expect(page.network).toHaveBeenCalledWith('https://cdn.example/model.glb', undefined)
    expect(page.requests).toHaveLength(1)
  })

  it('ignores answers from another sender or with another token', async () => {
    const page = await bridge()
    let settled = false
    void page.fetch('a.bin').then(() => { settled = true })
    page.deliver({ source: {}, data: { avnWorkspaceFile: TOKEN, id: 1, body: new Blob(['x']) } })
    page.deliver({ source: page.parent, data: { avnWorkspaceFile: 'other', id: 1, body: new Blob(['x']) } })
    await Promise.resolve()
    expect(settled).toBe(false)
  })

  it('resolves a URL built from a module address, and keeps a rooted reference for the app to resolve', async () => {
    const page = await bridge()
    void page.fetch(new URL('../models/car.glb', 'https://workspace.invalid/car/src/main.js'))
    void page.fetch('/shared/env.hdr')
    void page.fetch('../../../../outside.bin')
    expect(page.requests).toEqual([
      { id: 1, path: '/car/models/car.glb' },
      { id: 2, reference: '/shared/env.hdr' },
      // An address cannot climb above its root, so neither can a page's relative request.
      { id: 3, path: '/outside.bin' },
    ])
  })

  it('loads an image source set from script through the app', async () => {
    const page = await bridge()
    const image = document.createElement('img')
    image.src = 'textures/paint.png'
    expect(page.requests).toEqual([{ id: 1, path: '/car/textures/paint.png' }])
    expect(image.getAttribute('src')).toBeNull()
    const remote = document.createElement('img')
    remote.setAttribute('src', 'https://cdn.example/a.png')
    expect(remote.getAttribute('src')).toBe('https://cdn.example/a.png')
    expect(page.requests).toHaveLength(1)
  })
})

describe('previewDocument module addresses', () => {
  it('gives a module read from its file its workspace address as import.meta.url, and leaves an inline module alone', async () => {
    const files = reader({ '/Users/me/car/src/scene.js': "export const model = new URL('../roadster.glb', import.meta.url)" })
    const html = [
      '<html><head></head><body>',
      '<script type="module">import { model } from "./src/scene.js"; console.log(model, import.meta.url)</script>',
      '</body></html>',
    ].join('')
    const page = await previewDocument(html, '/Users/me/car/view.html', files.read, new AbortController().signal, TOKEN)
    const doc = new DOMParser().parseFromString(page, 'text/html')

    const imports = (JSON.parse(doc.querySelector('script[type="importmap"]')?.textContent ?? '{}') as { imports: Record<string, string> }).imports
    const url = imports['@avn-workspace//Users/me/car/src/scene.js'] ?? ''
    const scene = new TextDecoder().decode(Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), char => char.charCodeAt(0)))
    expect(scene).toBe("export const model = new URL('../roadster.glb', ({ ...import.meta, url: \"https://workspace.invalid/Users/me/car/src/scene.js\" }).url)")
    expect(doc.querySelector('script[type="module"]')?.textContent).toContain('console.log(model, import.meta.url)')
  })
})

describe('serveFrameFiles', () => {
  /** A frame whose window records what the app sends it. */
  function frame() {
    const element = document.createElement('iframe')
    document.body.append(element)
    const target = element.contentWindow!
    const sent: unknown[] = []
    vi.spyOn(target, 'postMessage').mockImplementation((message: unknown) => { sent.push(message) })
    return { element, target, sent }
  }

  /** Post one request from `source` to the app window. */
  function request(source: Window, data: Record<string, unknown>): void {
    window.dispatchEvent(new MessageEvent('message', { source, data }))
  }

  it('answers the page with the file its reference names, resolved against the page folder', async () => {
    const files = reader({ 'car/roadster.glb': new Blob(['GLB']) })
    const { element, target, sent } = frame()
    const controller = new AbortController()
    serveFrameFiles(element, 'car/view.html', files.read, TOKEN, controller.signal)
    request(target, { avnWorkspaceFile: TOKEN, id: 7, path: '/car/roadster.glb' })
    await vi.waitFor(() => { expect(sent).toHaveLength(1) })
    const answer = sent[0] as { avnWorkspaceFile: string; id: number; body: Blob }
    expect(answer.avnWorkspaceFile).toBe(TOKEN)
    expect(answer.id).toBe(7)
    expect(await answer.body.text()).toBe('GLB')
    controller.abort()
    element.remove()
  })

  it('ignores another token, another sender, and requests after the page goes away', async () => {
    const files = reader({ 'car/a.bin': 'A' })
    const { element, target, sent } = frame()
    const other = frame()
    const controller = new AbortController()
    serveFrameFiles(element, 'car/view.html', files.read, TOKEN, controller.signal)
    request(target, { avnWorkspaceFile: 'other', id: 1, path: '/car/a.bin' })
    request(other.target, { avnWorkspaceFile: TOKEN, id: 2, path: '/car/a.bin' })
    controller.abort()
    request(target, { avnWorkspaceFile: TOKEN, id: 3, path: '/car/a.bin' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(files.asked).toEqual([])
    expect(sent).toEqual([])
    element.remove()
    other.element.remove()
  })

  it('reads an address path at the disk root for a page outside the workspace, and at the workspace root otherwise', async () => {
    const files = reader({ '/Users/me/car/a.bin': 'A', 'car/b.bin': 'B' })
    const outside = frame()
    const inside = frame()
    const controller = new AbortController()
    serveFrameFiles(outside.element, '/Users/me/car/view.html', files.read, TOKEN, controller.signal)
    serveFrameFiles(inside.element, 'car/view.html', files.read, TOKEN, controller.signal)
    request(outside.target, { avnWorkspaceFile: TOKEN, id: 1, path: '/Users/me/car/a.bin' })
    request(inside.target, { avnWorkspaceFile: TOKEN, id: 1, path: '/car/b.bin' })
    await vi.waitFor(() => { expect(outside.sent.length + inside.sent.length).toBe(2) })
    expect(files.asked.sort()).toEqual(['/Users/me/car/a.bin', 'car/b.bin'])
    controller.abort()
    outside.element.remove()
    inside.element.remove()
  })

  it('answers a reference that climbs above the workspace root with no file', async () => {
    const files = reader({})
    const { element, target, sent } = frame()
    const controller = new AbortController()
    serveFrameFiles(element, 'car/view.html', files.read, TOKEN, controller.signal)
    request(target, { avnWorkspaceFile: TOKEN, id: 1, reference: '../../secret' })
    await vi.waitFor(() => { expect(sent).toHaveLength(1) })
    expect((sent[0] as { body: unknown }).body).toBeUndefined()
    expect(files.asked).toEqual([])
    controller.abort()
    element.remove()
  })
})

describe('dependencyVersions', () => {
  it('prefers the installed version from the lock file and falls back to the declared range', () => {
    const lock = JSON.stringify({ packages: { '': {}, 'node_modules/three': { version: '0.169.0' }, 'node_modules/@scope/kit': { version: '2.0.1' } } })
    const manifest = JSON.stringify({ dependencies: { three: '^0.160.0', esbuild: '^0.24.0' } })
    expect(Object.fromEntries(dependencyVersions(lock, manifest))).toEqual({ 'three': '0.169.0', '@scope/kit': '2.0.1', 'esbuild': '^0.24.0' })
    expect(dependencyVersions('not json', undefined).size).toBe(0)
  })
})
