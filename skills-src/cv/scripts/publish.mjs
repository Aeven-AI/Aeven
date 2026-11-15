/**
 * Publishes the skill into an Aeven checkout as the `aeven` preset's built-in `cv` skill.
 *
 * Writes `packages/preset/agent-presets/presets/aeven/skills/cv/` from scratch:
 *   SKILL.md
 *   scripts/render.mjs, cv.mjs, icons.mjs, blocks.mjs, kit.mjs, fonts.mjs   (Node built-ins only)
 *   scripts/export.mjs                                  (the bundled exporter, no node_modules)
 *   systems/<NN-id>/…                                   every system with a layouts.mjs
 *   fonts/<family>/manifest.json + *.woff2              only the families those systems name;
 *                                                       TTF styles listed, their files not shipped
 *
 * Usage: node scripts/publish.mjs [path to the aeven checkout]
 * Without a path it publishes into the checkout this folder sits in (`skills-src/` at its root).
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const checkout = process.argv[2] ?? resolve(root, '..', '..')
const preset = join(resolve(checkout), 'packages/preset/agent-presets/presets/aeven')
if (!existsSync(preset)) throw new Error(`${checkout} is not an aeven checkout`)
const target = join(preset, 'skills/cv')

execFileSync('node', [join(root, 'scripts/bundle.mjs')], { stdio: 'inherit' })

rmSync(target, { recursive: true, force: true })
mkdirSync(join(target, 'scripts'), { recursive: true })
cpSync(join(root, 'SKILL.md'), join(target, 'SKILL.md'))
for (const file of ['render.mjs', 'cv.mjs', 'icons.mjs', 'fonts.mjs', 'blocks.mjs', 'kit.mjs']) cpSync(join(root, 'scripts', file), join(target, 'scripts', file))
cpSync(join(root, 'dist/export.mjs'), join(target, 'scripts/export.mjs'))
cpSync(join(root, 'dist/export.mjs.LEGAL.txt'), join(target, 'scripts/export.LEGAL.txt'))

const slug = (family) => family.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const families = new Set()
for (const entry of readdirSync(join(root, 'systems'), { withFileTypes: true })) {
  const dir = join(root, 'systems', entry.name)
  if (!entry.isDirectory() || !existsSync(join(dir, 'layouts.mjs'))) continue
  cpSync(dir, join(target, 'systems', entry.name), { recursive: true })
  const { type } = JSON.parse(readFileSync(join(dir, 'system.json'), 'utf8'))
  for (const family of [type.fonts.text, type.fonts.display]) if (family) families.add(family)
}
for (const family of families) {
  const from = join(root, 'fonts', slug(family))
  const manifest = JSON.parse(readFileSync(join(from, 'manifest.json'), 'utf8'))
  const to = join(target, 'fonts', slug(family))
  mkdirSync(to, { recursive: true })
  // The shipped copy carries the WOFF2 files CVs embed. The TTF files stay in this repository;
  // their manifest entries ship, so the exporter knows each family's weights and downloads the
  // TTF files from Google Fonts when it embeds or installs them.
  writeFileSync(join(to, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  for (const face of manifest.web) cpSync(join(from, face.file), join(to, face.file))
}
console.log(`published ${readdirSync(join(target, 'systems')).length} systems and ${families.size} font families to ${target}`)
