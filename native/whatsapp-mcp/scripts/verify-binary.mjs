/** Refuse to pack a platform package whose daemon binary was not built (run `pnpm run build:native` first). */
import { accessSync, constants, readFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
for (const file of manifest.files) {
  try {
    accessSync(file, constants.X_OK)
  } catch {
    console.error(`${manifest.name}: ${file} is missing or not executable; build it with \`pnpm --dir native/whatsapp-mcp run build:native --target <platform>-<arch>\`.`)
    process.exit(1)
  }
}
