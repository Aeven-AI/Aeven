// @vitest-environment jsdom
/**
 * The rendered view of a workspace HTML page: its workspace stylesheets, scripts, images, and CSS `url()`s are
 * inlined, remote and inline references stay as written, and the document carries its own content policy.
 */
import { describe, expect, it } from 'vitest'
import { dependencyVersions, previewDocument, resolveReference } from '../src/client/preview.ts'

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
    const page = await previewDocument(html, 'site/index.html', files.read, new AbortController().signal)
    const doc = new DOMParser().parseFromString(page, 'text/html')

    expect(doc.querySelector('link[rel="stylesheet"]')).toBeNull()
    expect(doc.querySelector('style')?.textContent).toMatch(/url\("data:image\/png;base64,/)
    const script = doc.querySelector('script')
    expect(script?.hasAttribute('src')).toBe(false)
    expect(script?.textContent).toBe('document.title = "ran"')
    expect(doc.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/png;base64,/)
    expect(files.asked.sort()).toEqual(['site/app.js', 'site/bg.png', 'site/img/logo.png', 'site/style.css'])
  })

  it('leaves remote, inline, and missing references as written', async () => {
    const files = reader({})
    const html = '<link rel="stylesheet" href="https://cdn.example/a.css"><img src="data:image/gif;base64,R0"><img src="missing.png">'
    const page = await previewDocument(html, 'index.html', files.read, new AbortController().signal)
    const doc = new DOMParser().parseFromString(page, 'text/html')

    expect(doc.querySelector('link')?.getAttribute('href')).toBe('https://cdn.example/a.css')
    expect([...doc.querySelectorAll('img')].map(image => image.getAttribute('src'))).toEqual(['data:image/gif;base64,R0', 'missing.png'])
    expect(files.asked).toEqual(['missing.png'])
  })

  it('heads the document with a content policy and keeps an inlined script from closing its element', async () => {
    const files = reader({ 'x.js': 'const s = "</script><b>"' })
    const page = await previewDocument('<script src="x.js"></script>', 'index.html', files.read, new AbortController().signal)
    const doc = new DOMParser().parseFromString(page, 'text/html')

    expect(doc.head.firstElementChild?.getAttribute('http-equiv')).toBe('Content-Security-Policy')
    expect(doc.head.firstElementChild?.getAttribute('content')).toContain("default-src 'none'")
    expect(doc.querySelectorAll('script')).toHaveLength(1)
    expect(doc.querySelector('b')).toBeNull()
  })

  it('stops when the file view moves on', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(previewDocument('<p>hi</p>', 'index.html', reader({}).read, controller.signal)).rejects.toThrow()
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
    const page = await previewDocument(html, 'vase/index.html', files.read, new AbortController().signal)
    const doc = new DOMParser().parseFromString(page, 'text/html')

    const three = '@avn-workspace/vase/node_modules/three/build/three.module.js'
    const entry = doc.querySelector('script[type="module"]')
    expect(entry?.hasAttribute('src')).toBe(false)
    expect(entry?.textContent).toContain(`from '${three}'`)
    expect(entry?.textContent).toContain('import("@avn-workspace/vase/src/late.js")')
    expect(entry?.textContent).toContain('import.meta.url')
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
    const page = await previewDocument(html, 'app/index.html', files.read, new AbortController().signal)
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
    const page = await previewDocument(html, '/Users/me/vase/index.html', files.read, new AbortController().signal)
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
    const page = await previewDocument(html, '/Users/me/vase/index.html', files.read, new AbortController().signal)
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
    const page = await previewDocument(html, 'app/index.html', files.read, new AbortController().signal)
    const map = new DOMParser().parseFromString(page, 'text/html').querySelector('script[type="importmap"]')
    expect(map).toBeNull()
  })

  it('adds no import map to a page without modules', async () => {
    const page = await previewDocument('<html><head></head><body><p>hi</p></body></html>', 'a.html', reader({}).read, new AbortController().signal)
    expect(new DOMParser().parseFromString(page, 'text/html').querySelector('script[type="importmap"]')).toBeNull()
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
