import { defineConfig } from 'tsdown'

/**
 * Build the package root and its invariant companion as independent bundles.
 *
 * Both entries use `kindPathAgrees` and the `WorkspaceId` cast, which share the
 * schema module the root entry builds its domain spec with. Bundling them
 * together splits that module into a shared `lib/src-<hash>.js` chunk that
 * `files` does not publish, so each entry is built on its own instead; the
 * shared code is a pure predicate and a pure cast, so an inlined copy per bundle
 * carries no state that has to stay identical.
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
    entry: ['lib/types/invariant.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
])
