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
    name: 'DeepSeek Harness',
    short_name: 'DSH',
    start_url: '/',
    scope: '/',
    display: 'fullscreen',
    icons: [{
      src: '/favicon.svg',
      sizes: 'any',
      type: 'image/svg+xml',
      purpose: 'any',
    }],
  })
})

it('ships a favicon that switches to a light mark under dark color scheme', async () => {
  const favicon = await readFile(join(DIST_ROOT, 'favicon.svg'), 'utf8')
  // The light fill must live inside the dark-scheme media query, so the icon
  // stays black in light mode and only turns white under a dark scheme.
  expect(favicon).toMatch(/@media \(prefers-color-scheme: dark\)\s*{\s*path\s*{[^}]*fill:\s*#fff/i)
  expect(favicon).toContain('fill="#000"')
})

it('inlines first-paint preloader CSS and destages remaining stylesheets', async () => {
  const index = await readFile(join(DIST_ROOT, 'index.html'), 'utf8')
  const styleOpen = index.indexOf('<style>')
  const styleClose = index.indexOf('</style>')
  const preloader = index.indexOf('id="dsh-preloader"')
  const root = index.indexOf('id="root"')
  const moduleEntry = index.indexOf('<script type="module"')
  expect(styleOpen).toBeGreaterThan(-1)
  expect(styleOpen).toBeLessThan(preloader)
  expect(preloader).toBeGreaterThan(-1)
  expect(preloader).toBeLessThan(root)
  expect(moduleEntry).toBeLessThan(preloader)

  const inline = index.slice(styleOpen, styleClose)
  expect(inline).toContain('#dsh-preloader')
  expect(inline).toContain('dsh-preloader-spin')

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
