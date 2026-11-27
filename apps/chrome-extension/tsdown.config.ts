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
    // dist/ is tracked in git; builds overwrite it in place so a stale output shows in `git status`.
    clean: false,
    // The status tag's font (SIL OFL 1.1) and its licence, from the web client's self-hosted copy.
    copy: ['manifest.json', 'icons', 'src/connect.html', '../web/src/assets/fonts/google-sans-flex-latin-wght-normal.woff2', '../web/src/assets/fonts/LICENSE-GoogleSansFlex.txt'],
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
  // The agent's indicator (glow, status tag, tab icon) as a classic page script, which the worker injects into the agent's tabs.
  {
    entry: { 'indicator-page': 'src/indicator-page.ts' },
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
