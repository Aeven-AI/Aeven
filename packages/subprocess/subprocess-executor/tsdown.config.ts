import { defineConfig } from 'tsdown'

/**
 * Build the index and the helper as separate single-entry bundles. The helper
 * runs as its own process from `lib/worker.cjs`, loaded by file, so it must not
 * pull in the index's dependencies; separate builds keep it self-contained.
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
  },
])
