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
