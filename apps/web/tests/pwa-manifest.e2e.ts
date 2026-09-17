import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const DIST_ROOT = fileURLToPath(new URL('../dist', import.meta.url))

it('ships install metadata with the built web application', async () => {
  const index = await readFile(join(DIST_ROOT, 'index.html'), 'utf8')
  expect(index).toContain('<link rel="manifest" href="./manifest.webmanifest" />')

  const manifest: unknown = JSON.parse(await readFile(join(DIST_ROOT, 'manifest.webmanifest'), 'utf8'))
  expect(manifest).toEqual({
    id: '/',
    name: 'Æven',
    short_name: 'Æven',
    start_url: '/',
    scope: '/',
    display: 'fullscreen',
    icons: [
      // The vector mark carries the crisp small sizes and every desktop
      // surface; the two rasters carry the install sizes, and are the
      // safe-zone crops a launcher masks, so they are declared maskable only.
      {
        src: '/favicon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/web-app-manifest-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/web-app-manifest-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  })
})

it('ships a favicon that switches to a light mark under dark color scheme', async () => {
  const favicon = await readFile(join(DIST_ROOT, 'favicon.svg'), 'utf8')
  // The mark paints with `currentColor`, so an inlined copy inherits the text
  // colour around it and the standalone favicon is the only case that needs a
  // flip of its own: dark by default, light under a dark scheme.
  expect(favicon).toContain('fill="currentColor"')
  const dark = /@media \(prefers-color-scheme: dark\)\s*{([\s\S]*?)\n\t*}/.exec(favicon)?.[1]
  if (dark === undefined) throw new Error('favicon.svg carries no dark-scheme block')
  expect(dark).toMatch(/color:\s*#fff/i)
  // Scoped to the mark: a `:root` rule here would restyle the host document the
  // moment this file is inlined rather than fetched as a favicon.
  expect(dark).not.toContain(':root')
})

it('inlines first-paint preloader CSS and destages remaining stylesheets', async () => {
  const index = await readFile(join(DIST_ROOT, 'index.html'), 'utf8')
  const styleOpen = index.indexOf('<style>')
  const styleClose = index.indexOf('</style>')
  const preloader = index.indexOf('id="avn-preloader"')
  const root = index.indexOf('id="root"')
  const moduleEntry = index.indexOf('<script type="module"')
  expect(styleOpen).toBeGreaterThan(-1)
  expect(styleOpen).toBeLessThan(preloader)
  expect(preloader).toBeGreaterThan(-1)
  expect(preloader).toBeLessThan(root)
  expect(moduleEntry).toBeLessThan(preloader)

  const inline = index.slice(styleOpen, styleClose)
  expect(inline).toContain('#avn-preloader')
  expect(inline).toContain('avn-preloader-spin')

  const fonts = [...index.matchAll(/<link rel="preload" as="font"[^>]+>/g)]
  expect(fonts).toHaveLength(2)
  for (const tag of fonts) expect(tag[0]).toContain('fetchpriority="low"')

  const promoted = [...index.matchAll(/<link rel="preload" as="style"([^>]+) onload="this.onload=null;this.rel='stylesheet'">/g)]
  expect(promoted.length).toBeGreaterThan(0)
  for (const tag of promoted) {
    const attributes = tag[1]
    if (attributes === undefined) throw new Error('destaged stylesheet has no attributes')
    expect(index).toContain(`<noscript><link rel="stylesheet"${attributes}></noscript>`)
  }

  const stylesheets = [...index.matchAll(/<link rel="stylesheet"[^>]+>/g)]
  expect(stylesheets.length).toBe(promoted.length)
  for (const tag of stylesheets) {
    const at = tag.index ?? -1
    const noscriptOpen = index.lastIndexOf('<noscript>', at)
    const noscriptClose = index.indexOf('</noscript>', noscriptOpen)
    expect(noscriptOpen).toBeGreaterThan(-1)
    expect(at).toBeGreaterThan(noscriptOpen)
    expect(at).toBeLessThan(noscriptClose)
  }
})

it('starts render families off the shell execution path and keeps mermaid on demand', async () => {
  const index = await readFile(join(DIST_ROOT, 'index.html'), 'utf8')
  const assets = await readdir(join(DIST_ROOT, 'assets'))
  const entryName = /<script type="module"[^>]+src="\.\/assets\/([^"/]+\.js)"/.exec(index)?.[1]
  if (entryName === undefined) throw new Error('built index has no module entry')
  const entry = await readFile(join(DIST_ROOT, 'assets', entryName), 'utf8')
  expect(assets.some(name => /^katex-[^.]+\.js$/.test(name))).toBe(true)
  expect(assets.some(name => /^hljs-[^.]+\.js$/.test(name))).toBe(true)
  expect(assets.some(name => /^mdast-[^.]+\.js$/.test(name))).toBe(true)
  expect(assets.some(name => /^syntax-[^.]+\.js$/.test(name))).toBe(false)
  expect(assets.some(name => /^primitives-[^.]+\.js$/.test(name))).toBe(true)
  expect(index).not.toMatch(/modulepreload[^>]+(?:katex|hljs|mdast|primitives)-/)
  expect(entry).toMatch(/import\("\.\/primitives-[^.]+\.js"\)/)
  expect(assets.some(name => /^shiki-[^.]+\.js$/.test(name))).toBe(false)
  expect(assets.some(name => /^m-core-[^.]+\.js$/.test(name))).toBe(true)
  expect(assets.some(name => /^m-asset-[^.]+\.js$/.test(name))).toBe(true)
  expect(index).not.toMatch(/modulepreload[^>]+(?:m-core|m-asset|langs\/)/)
  expect(index).not.toContain('vendor-')
})
