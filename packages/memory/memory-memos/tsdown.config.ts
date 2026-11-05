import { defineConfig } from 'tsdown'

export default defineConfig(['index', 'embedding-worker'].map(name => ({
  entry: [`lib/types/${name}.js`],
  outDir: 'lib',
  format: ['esm' as const],
  platform: 'node' as const,
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})))
