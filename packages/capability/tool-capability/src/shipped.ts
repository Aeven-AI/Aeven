/**
 * Procedures a composition ships for every owner: one Markdown file each, read from the configured directories when
 * the plugin loads and registered with the memory service, which recalls them beside each owner's learned procedures.
 *
 * @module @aeven/tool-capability/shipped
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { shippedProcedureId, type MemoryDomain, type ShippedProcedure } from '@aeven/memory'

/** Kebab-case procedure name, as learned procedures use. */
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/

/** YAML frontmatter between `---` lines, then the Markdown procedure. */
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/

/** Longest summary recall may deliver: the bound learned procedure summaries keep. */
const SUMMARY_MAX = 950

/** Domains a shipped procedure may declare; one never belongs to a workspace, so `project` is excluded. */
const DOMAINS = ['experience', 'world'] as const satisfies readonly MemoryDomain[]

/**
 * Read every `.md` file of the given directories as a shipped procedure. The frontmatter holds `name` (kebab-case),
 * `description` (one line), `summary` (the condensed procedure recall delivers, at most 950 characters), and an
 * optional `domain` (`experience`, the default, or `world`); the body is the full procedure.
 * @param directories - absolute directories, read in order.
 * @returns the procedures.
 * @throws Error naming the file when a directory cannot be read, a file is malformed, or a name repeats.
 */
export function readShippedProcedures(directories: readonly string[]): ShippedProcedure[] {
  const procedures: ShippedProcedure[] = []
  const names = new Set<string>()
  for (const directory of directories) {
    for (const file of readdirSync(directory).filter(entry => entry.endsWith('.md')).sort()) {
      const path = join(directory, file)
      const procedure = parseShippedProcedure(readFileSync(path, 'utf8'), path)
      if (names.has(procedure.name)) throw new Error(`${path}: shipped procedure ${procedure.name} is defined twice`)
      names.add(procedure.name)
      procedures.push(procedure)
    }
  }
  return procedures
}

/**
 * Parse one shipped procedure file.
 * @param text - the file's text.
 * @param path - the file, for error messages.
 * @returns the procedure.
 * @throws Error naming the file and the field when the file is malformed.
 */
function parseShippedProcedure(text: string, path: string): ShippedProcedure {
  const match = FRONTMATTER.exec(text)
  if (match === null) throw new Error(`${path}: a shipped procedure starts with --- frontmatter`)
  const meta: unknown = parse(match[1] ?? '')
  const field = (key: string): string => {
    const value = typeof meta === 'object' && meta !== null ? (meta as Record<string, unknown>)[key] : undefined
    if (typeof value !== 'string' || value.trim() === '') throw new Error(`${path}: frontmatter needs a non-empty ${key}`)
    return value.trim()
  }
  const name = field('name')
  if (!NAME.test(name)) throw new Error(`${path}: name ${name} is not kebab-case`)
  const description = field('description')
  if (description.includes('\n')) throw new Error(`${path}: description is one line`)
  const summary = field('summary')
  if (summary.length > SUMMARY_MAX) throw new Error(`${path}: summary is ${summary.length} characters; the limit is ${SUMMARY_MAX}`)
  const declared = typeof meta === 'object' && meta !== null ? (meta as Record<string, unknown>).domain : undefined
  if (declared !== undefined && !(DOMAINS as readonly unknown[]).includes(declared)) throw new Error(`${path}: domain is one of ${DOMAINS.join(', ')}`)
  const content = (match[2] ?? '').trim()
  if (content === '') throw new Error(`${path}: the procedure body is empty`)
  return {
    id: shippedProcedureId(name),
    name,
    description,
    summary,
    content,
    domain: (declared as MemoryDomain | undefined) ?? 'experience',
  }
}
