/** Refuse to pack a platform package whose worker binary was not built (run `pnpm run build:native` first). */
import { accessSync, constants, readFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
for (const file of manifest.files) {
  try {
    accessSync(file, constants.X_OK)
  } catch (error) {
    console.error(`${manifest.name}: ${file} is missing or not executable; build it with \`pnpm --dir native/whisper-cpp run build:native --target <platform>-<arch>\`.`)
    process.exit(1)
  }
}
