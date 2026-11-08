import { defineConfig } from 'tsdown'

// The unpacked extension: the service worker bundled beside the manifest and icons in dist/.
export default defineConfig([
  {
    entry: { background: 'src/background.ts' },
    outDir: 'dist',
    format: ['esm'],
    platform: 'browser',
    target: 'es2022',
    fixedExtension: false,
    dts: false,
    clean: true,
    copy: ['manifest.json', 'icons', 'src/connect.html'],
  },
  // The page Aeven opens to wake the worker when it starts the browser.
  {
    entry: { connect: 'src/connect.ts' },
    outDir: 'dist',
    format: ['iife'],
    platform: 'browser',
    target: 'es2022',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  // The agent pointer as a classic page script, which the worker injects into the agent's tabs.
  {
    entry: { 'overlay-page': '../../packages/experimental/browser-overlay/src/index.ts' },
    outDir: 'dist',
    format: ['iife'],
    globalName: 'AevenOverlayPage',
    platform: 'browser',
    target: 'es2022',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
])
