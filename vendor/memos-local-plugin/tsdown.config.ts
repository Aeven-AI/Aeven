import { defineConfig } from 'tsdown'

/**
 * MemOS resolves its SQL migrations next to the compiled `storage/migrator.js`
 * and its consumers import individual modules, so the build keeps tsc's module
 * tree under `lib/` instead of bundling one entry, and copies the migrations
 * beside the migrator.
 */
export default defineConfig({
  entry: ['lib/types/**/*.js'],
  unbundle: true,
  root: 'lib/types',
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  copy: [{ from: 'src/core/storage/migrations/*.sql', to: 'lib/core/storage/migrations' }],
})
