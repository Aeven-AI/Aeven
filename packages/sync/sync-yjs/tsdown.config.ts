import { defineConfig } from 'tsdown'

/**
 * Build the provider and its worker separately so each inlines shared modules; a multi-entry build creates an
 * unlisted chunk. The worker is loaded by path, as CommonJS like the other worker-thread bundles.
 */
export default defineConfig([
  {
    entry: ['lib/types/index.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  {
    entry: ['lib/types/worker.js'],
    outDir: 'lib',
    format: ['cjs'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    outputOptions: { inlineDynamicImports: true },
  },
])
