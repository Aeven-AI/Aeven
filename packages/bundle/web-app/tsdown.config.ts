import { defineConfig } from 'tsdown'

/** The root entry set plus `node-mcp`, the plugin the bundle patch names for its npm-shipped MCP servers. */
export default defineConfig({
  entry: ['lib/types/{index,startup,surface,node-mcp}.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
