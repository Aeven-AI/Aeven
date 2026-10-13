/**
 * The skills this package ships: every rendered body stays below the preset's
 * tool-result pruner threshold, every resource a body names exists and stays
 * readable below the same threshold, the shipped directory reaches a session
 * catalog through the provider the presets mount, and each composition that
 * discovers local skills also mounts the shipped directory.
 *
 * The catalog description cap mirrors `@aeven/tool-skill`'s default, which is
 * what truncates a description before the model sees it.
 */

import { lstatSync, readFileSync, readdirSync, readlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { evaluate } from '@deepseek-ai/cordis-plugin-loader'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import SkillRegistry, { renderSkillContent } from '@aeven/skill'
import * as SkillFileSystem from '@aeven/skill-filesystem'
import { COMPOSITION_FILE, SHIPPED_PRESET_ROOT } from '@aeven/agent-presets'

const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url))
/** The `aeven` preset owns the shipped skills; the other presets mount that directory. */
const SHIPPED_SKILLS = join(PACKAGE_ROOT, 'presets', 'aeven', 'skills')
const REPOSITORY_SKILLS = fileURLToPath(new URL('../../../../.agents/skills/', import.meta.url))

/**
 * `packages/bundle/base/cordis.patch.yml` prunes a tool result only above this
 * many code points, so a skill rendered below it reaches the model intact.
 */
const PRUNER_THRESHOLD_CHARS = 8192
/** `@aeven/tool-skill`'s `DEFAULT_CATALOG_DESCRIPTION_MAX_LENGTH`. */
const CATALOG_DESCRIPTION_MAX_LENGTH = 500

const names = readdirSync(SHIPPED_SKILLS, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .sort()

/** The file one shipped skill's body comes from. */
const skillFile = (name: string): string => join(SHIPPED_SKILLS, name, 'SKILL.md')

/** Split a shipped skill file into its frontmatter and the body the `skill` tool returns. */
function split(name: string): { frontmatter: Record<string, unknown>; body: string } {
  const text = readFileSync(skillFile(name), 'utf8')
  if (!text.startsWith('---\n')) throw new Error(`${name}: SKILL.md must start with YAML frontmatter`)
  const end = text.indexOf('\n---\n', 4)
  if (end < 0) throw new Error(`${name}: frontmatter is not closed`)
  const frontmatter = yaml.load(text.slice(4, end))
  if (typeof frontmatter !== 'object' || frontmatter === null || Array.isArray(frontmatter)) {
    throw new Error(`${name}: frontmatter must be a YAML object`)
  }
  return { frontmatter: frontmatter as Record<string, unknown>, body: text.slice(end + 5).trim() }
}

/** Every `references/…` or `scripts/…` path a body names, in a link or in a command. */
function referencedPaths(body: string): string[] {
  const matches = [...body.matchAll(/(?:references|scripts)\/[A-Za-z0-9._/-]+/g)].map(match => match[0])
  return [...new Set(matches)].sort()
}

/** What `read` returns for a file: every line prefixed by its number and a tab. */
function lineNumbered(text: string): string {
  return text.split('\n').map((line, index) => `${index + 1}\t${line}`).join('\n')
}

interface CompositionRow {
  id?: unknown
  config?: unknown
}

/** Find one entry through a composition's nested groups. */
function findRow(rows: unknown[], id: string): CompositionRow | undefined {
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue
    const candidate = row as CompositionRow
    if (candidate.id === id) return candidate
    if (Array.isArray(candidate.config)) {
      const nested = findRow(candidate.config, id)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

/** Read and validate one shipped preset's Cordis entry list. */
function shippedRows(preset: string): unknown[] {
  const file = join(SHIPPED_PRESET_ROOT, preset, COMPOSITION_FILE)
  const rows: unknown = yaml.load(readFileSync(file, 'utf8'), { schema: entryListSchema })
  if (!Array.isArray(rows)) throw new Error(`${preset}: ${COMPOSITION_FILE} must contain a Cordis entry list`)
  return rows
}

describe('the shipped skills', () => {
  it('ships at least one skill', () => {
    expect(names.length).toBeGreaterThan(0)
  })

  it('carries a catalog entry the model can act on', () => {
    for (const name of names) {
      const { frontmatter } = split(name)
      expect(frontmatter.name, name).toBe(name)
      const description = frontmatter.description
      expect(typeof description, name).toBe('string')
      expect(String(description).length, name).toBeLessThanOrEqual(CATALOG_DESCRIPTION_MAX_LENGTH)
      expect(String(description), name).toMatch(/\bUse\b/)
    }
  })

  it('renders every body below the pruner threshold', () => {
    for (const name of names) {
      const { body } = split(name)
      const rendered = renderSkillContent({
        name,
        provider: 'filesystem',
        resourceBase: { kind: 'directory', path: join(SHIPPED_SKILLS, name) },
        content: body,
      })
      expect(Array.from(rendered).length, name).toBeLessThan(PRUNER_THRESHOLD_CHARS)
    }
  })

  it('names only resources it ships, each readable below the threshold', () => {
    for (const name of names) {
      const paths = referencedPaths(split(name).body)
      expect(paths.length, `${name} names no resource`).toBeGreaterThan(0)
      for (const path of paths) {
        const file = join(SHIPPED_SKILLS, name, path)
        const text = readFileSync(file, 'utf8')
        if (path.endsWith('.md')) {
          expect(Array.from(lineNumbered(text)).length, `${name}: ${path}`).toBeLessThan(PRUNER_THRESHOLD_CHARS)
        }
      }
    }
  })

  it('keeps one home per skill, with a repository alias', () => {
    for (const name of names) {
      const alias = join(REPOSITORY_SKILLS, name, 'SKILL.md')
      if (!lstatSync(alias).isSymbolicLink()) {
        // Git materializes a link target as a plain file where symbolic links are off.
        expect(process.platform, `${name}: alias is a second copy`).toBe('win32')
        expect(readFileSync(alias, 'utf8'), name).toBe(readFileSync(skillFile(name), 'utf8'))
        continue
      }
      expect(resolve(join(REPOSITORY_SKILLS, name), readlinkSync(alias)), name).toBe(skillFile(name))
    }
  })

  it('reaches a session catalog through the provider the presets mount', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SkillRegistry)
      await ctx.plugin(SkillFileSystem, { customSkillDirs: [SHIPPED_SKILLS], includeDefaultRoots: false, watch: false })
      expect((await ctx.skills.list()).map(skill => skill.name).sort()).toEqual(names)
      const loaded = await ctx.skills.get(names[0] as string)
      expect(loaded?.resourceBase).toEqual({ kind: 'directory', path: join(SHIPPED_SKILLS, names[0] as string) })
      expect(loaded?.content).toBe(split(names[0] as string).body)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('mounts the shipped directory from every composition that discovers local skills', () => {
    const presets = readdirSync(SHIPPED_PRESET_ROOT, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort()
    const mounted: string[] = []
    for (const preset of presets) {
      const row = findRow(shippedRows(preset), 'skill-filesystem')
      if (row === undefined) continue
      const dirs = (row.config as { customSkillDirs?: unknown } | undefined)?.customSkillDirs
      expect(Array.isArray(dirs), `${preset}: skill-filesystem must mount the shipped skills`).toBe(true)
      const [entry] = dirs as unknown[]
      const baseUrl = pathToFileURL(join(SHIPPED_PRESET_ROOT, preset, COMPOSITION_FILE)).href
      const resolved: unknown = evaluate({ baseUrl }, (entry as { __jsExpr: string }).__jsExpr)
      expect(typeof resolved, preset).toBe('string')
      expect(resolve(String(resolved)), preset).toBe(resolve(SHIPPED_SKILLS))
      mounted.push(preset)
    }
    expect(mounted).toEqual(['aeven', 'cordis', 'ptc', 'standard'])
  })
})
