import { defineConfig } from 'tsdown'

/**
 * Build the provider and worker separately so each inlines shared modules; a
 * multi-entry build creates an unlisted chunk. The path-loaded worker is
 * CommonJS for the same reason as the workflow worker. The worker bundles the
 * vendored SheetJS tarball because installers resolve a published `file:`
 * dependency against the installing project, not this package.
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
    deps: { onlyBundle: ['xlsx'] },
    outputOptions: { inlineDynamicImports: true },
  },
])
