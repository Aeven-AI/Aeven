/**
 * Bundles the exporter and its npm dependencies (docx, jszip, puppeteer-core, @puppeteer/browsers)
 * into one self-contained ESM file, `dist/export.mjs`, so a shipped copy of the skill runs with
 * plain Node and no node_modules.
 *
 * Usage: node scripts/bundle.mjs
 */
import { build } from 'esbuild'

await build({
  entryPoints: [new URL('export.mjs', import.meta.url).pathname],
  outfile: new URL('../dist/export.mjs', import.meta.url).pathname,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  minify: true,
  legalComments: 'external',
  // CommonJS dependencies call require() for Node built-ins; ESM output has no require of its own.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  // Native accelerators the WebSocket client loads only when present.
  external: ['bufferutil', 'utf-8-validate'],
  logLevel: 'warning',
})
console.log('dist/export.mjs written')
