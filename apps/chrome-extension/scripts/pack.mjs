// Packs dist/ as the zip the Chrome Web Store takes: the same files, with the
// manifest's `key` removed, because the store refuses a key and signs the item
// under the id it assigned. Writes store/aeven-extension-<version>.zip.
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const staging = join(root, 'store', 'staging')
rmSync(staging, { recursive: true, force: true })
cpSync(join(root, 'dist'), staging, { recursive: true })
const manifest = JSON.parse(readFileSync(join(staging, 'manifest.json'), 'utf8'))
delete manifest.key
writeFileSync(join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
const zip = join(root, 'store', `aeven-extension-${manifest.version}.zip`)
rmSync(zip, { force: true })
mkdirSync(dirname(zip), { recursive: true })
execFileSync('zip', ['-qr', '-X', zip, '.'], { cwd: staging })
rmSync(staging, { recursive: true, force: true })
console.log(zip)
