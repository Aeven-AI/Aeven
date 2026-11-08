import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: ['lib/types/main.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    // koffi locates its native binary through its per-platform package, so it ships in node_modules.
    deps: { neverBundle: ['electron', 'koffi'] },
  },
  // The native messaging host the Aeven browser extension starts (browser-extension.ts).
  {
    entry: { 'native-host': 'lib/types/native-host.js' },
    outDir: 'lib',
    format: ['esm' as const],
    platform: 'node' as const,
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  // The agent pointer as a classic page script, which the main process injects
  // into the Chrome tabs the agent drives (browser-chrome.ts).
  {
    entry: { 'overlay-page': '../../packages/experimental/browser-overlay/src/index.ts' },
    outDir: 'lib',
    format: ['iife' as const],
    globalName: 'AevenOverlayPage',
    platform: 'browser' as const,
    target: 'es2022',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  // Sandboxed Electron preloads run as CommonJS even though the application
  // package is ESM, and can require only `electron`.
  ...['preload-app'].map(name => ({
    entry: { [name]: `lib/types/${name}.js` },
    outDir: 'lib',
    format: ['cjs' as const],
    platform: 'node' as const,
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: { neverBundle: ['electron'] },
  })),
])
