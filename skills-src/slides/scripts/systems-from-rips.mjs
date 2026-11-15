/**
 * Turns ripped deck folders into design-system files.
 *
 * Every folder under the rip directory holds the slide images and the meta of
 * one Figma deck. Each becomes `systems/<nn>-<slug>/system.json` through
 * extract.py, numbered after the systems that were measured by hand, so the
 * catalogue keeps a stable order as rips are added.
 *
 * Usage: node scripts/systems-from-rips.mjs <rip-dir> [first-index]
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const ripDir = process.argv[2] ?? '/tmp/aeven-rip'
const firstIndex = Number(process.argv[3] ?? 4)

const existing = readdirSync(join(root, 'systems'))
  .filter((name) => /^\d\d-/.test(name))
  .sort()
const taken = new Set(existing)

const folders = readdirSync(ripDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => existsSync(join(ripDir, name, 'meta.json')))
  .sort()

let index = firstIndex
const written = []
for (const folder of folders) {
  const meta = JSON.parse(readFileSync(join(ripDir, folder, 'meta.json'), 'utf8'))
  const slug = folder.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32)
  const id = `${String(index).padStart(2, '0')}-${slug}`
  if (taken.has(id)) continue
  const slides = readdirSync(join(ripDir, folder)).filter((name) => name.endsWith('.png')).length
  if (slides < 4) continue
  execFileSync('python3', [join(here, 'extract.py'), join(ripDir, folder), id], { stdio: 'inherit' })
  const systemPath = join(root, 'systems', id, 'system.json')
  const system = JSON.parse(readFileSync(systemPath, 'utf8'))
  system.name = (meta.title ?? folder).replace(/\s*[|–-]\s*Figma\s*$/, '').trim()
  system.source = meta.url ?? ''
  system.measuredFrom = `${slides} ripped slides`
  writeFileSync(systemPath, JSON.stringify(system, null, 2) + '\n')
  written.push(id)
  index += 1
}

console.log(`wrote ${written.length} systems: ${written.join(', ')}`)
