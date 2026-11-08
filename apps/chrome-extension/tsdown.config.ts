import { defineConfig } from 'tsdown'

// The unpacked extension: the service worker bundled beside the manifest and icons in dist/.
export default defineConfig({
  entry: { background: 'src/background.ts' },
  outDir: 'dist',
  format: ['esm'],
  platform: 'browser',
  target: 'es2022',
  fixedExtension: false,
  dts: false,
  clean: true,
  copy: ['manifest.json', 'icons'],
})
