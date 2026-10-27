/**
 * Bash edit guard: refuse a shell command that changes an existing source file in place, so
 * edits go through the edit and write tools, which fail when the replaced text is absent, require
 * the file to have been read, and record the change. Creating new files, writing logs or scratch
 * output, installs, builds, and every other program run pass untouched.
 *
 * Detection reads the command text. A command is refused when it names an existing file with a
 * source extension and either edits in place (`sed -i`, `perl -i`), writes through a scripting
 * call (`open(…, 'w')`, `write_text`, `writeFileSync`, …), or redirects (`>`, `>>`, `tee`) into it.
 * When every scripting write names its file as a string literal, only those files are checked, so a
 * script that reads a source file and writes scratch output passes. A relative path resolves against
 * the last `cd` before it in the command, or the working directory when none precedes it. Files under
 * the system temporary directories are never refused.
 * @module @aeven/bash-edit-guard
 */

import { existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ToolExecution } from '@aeven/tools'
import type {} from '@aeven/working-directory'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'bash-edit-guard'

/** The tool registry this plugin guards. */
export const inject = ['tools']

/** Plugin configuration; every field is changeable from `cordis.yml`. */
export interface Config {
  /** Shell tool names whose commands are checked. */
  tools: string[]
  /** File extensions, without the dot, that count as source files. */
  sourceExtensions: string[]
}

/** Validated schema for {@link Config}. */
export const Config: z<Config> = z.object({
  tools: z.array(z.string()).default(['bash']),
  sourceExtensions: z.array(z.string()).default([
    'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs',
    'css', 'scss', 'sass', 'less', 'html', 'htm', 'vue', 'svelte', 'astro',
    'json', 'jsonc', 'md', 'mdx', 'yml', 'yaml', 'toml',
    'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'php',
    'sh', 'zsh', 'sql', 'graphql', 'svg', 'xml',
  ]),
})

const IN_PLACE = /\b(?:g?sed)\s+(?:-[a-zA-Z]*i|--in-place)\b|\bperl\s+-[a-zA-Z]*i/
// eslint-disable-next-line @stylistic/max-len -- Keep the write-pattern alternatives in one regular expression.
const SCRIPT_WRITE = /\bopen\([^)]*,\s*(?:mode\s*=\s*)?['"][wax]\+?b?['"]|\.write_(?:text|bytes)\(|\b(?:writeFileSync|appendFileSync|writeFile|appendFile)\(|\bFile\.write\(/
const REDIRECT = /(?:^|[^<>&0-9])>>?\|?\s*(['"]?)([^\s;&|<>'"()]+)\1/g
const TEE = /\btee\s+(?:-a\s+)?(['"]?)([^\s;&|<>'"()]+)\1/g
const PATH_TOKEN = /(['"`]?)([\w./@~+-]+\.\w+)\1/g
const CD = /\bcd\s+(['"]?)([^\s;&|'"()]+)\1/g
const SCRIPT_WRITE_ALL = new RegExp(SCRIPT_WRITE.source, 'g')
// eslint-disable-next-line @stylistic/max-len -- Keep the literal write-target alternatives in one regular expression.
const LITERAL_WRITE = /\bopen\(\s*(['"])([^'"]+)\1\s*,\s*(?:mode\s*=\s*)?['"][wax]\+?b?['"]|\bPath\(\s*(['"])([^'"]+)\3\s*\)\.write_(?:text|bytes)\(|\b(?:writeFileSync|appendFileSync|writeFile|appendFile)\(\s*(['"`])([^'"`]+)\5|\bFile\.write\(\s*(['"])([^'"]+)\7/g

const TEMP_ROOTS = [tmpdir(), '/tmp', '/private/tmp', '/var/folders', '/private/var/folders'].map(root => resolve(root))

/** A path a command names, with the offset that decides which `cd` it follows. */
interface PathToken {
  readonly path: string
  readonly index: number
}

/** Every capture group 2 of a global pattern over the command. */
function captures(pattern: RegExp, command: string): PathToken[] {
  return [...command.matchAll(pattern)].flatMap(match => match[2] === undefined ? [] : [{ path: match[2], index: match.index }])
}

/** The literal file each scripting write names; one capture group per alternative of {@link LITERAL_WRITE}. */
function literalWrites(command: string): PathToken[] {
  return [...command.matchAll(LITERAL_WRITE)].flatMap((match) => {
    const path = match[2] ?? match[4] ?? match[6] ?? match[8]
    return path === undefined ? [] : [{ path, index: match.index }]
  })
}

/**
 * Register the command check on the tool registry.
 * @param ctx - Host context carrying the tool registry.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const tools = new Set(config.tools)
  const extensions = new Set(config.sourceExtensions.map(extension => extension.replace(/^\./, '').toLowerCase()))

  /** Absolute existing source file a command token names, or undefined. */
  const existingSource = (token: string, base: string): string | undefined => {
    if (!extensions.has(extname(token).slice(1).toLowerCase())) return undefined
    const path = resolve(isAbsolute(token) ? token : join(base, token))
    if (TEMP_ROOTS.some(root => path === root || path.startsWith(`${root}/`))) return undefined
    // A path that vanishes or is unreadable between the two calls is not an existing file.
    try {
      return existsSync(path) && statSync(path).isFile() ? path : undefined
    } catch {
      return undefined
    }
  }

  ctx.effect(() => ctx.tools.guard((exec: ToolExecution) => {
    if (!tools.has(exec.name)) return undefined
    const args = exec.arguments as { command?: unknown; workdir?: unknown } | null
    if (typeof args?.command !== 'string') return undefined
    const command = args.command
    const session = exec.agent?.session
    const sessionCwd = (session === undefined ? undefined : ctx.get('workingDirectory')?.of(session) ?? session.header.cwd)
      ?? process.cwd()
    const workdir = typeof args.workdir === 'string' ? resolve(sessionCwd, args.workdir) : sessionCwd
    // Each `cd` resolves against the directory the one before it entered.
    const cds: Array<{ readonly dir: string; readonly index: number }> = []
    for (const cd of captures(CD, command)) cds.push({ dir: resolve(cds.at(-1)?.dir ?? workdir, cd.path), index: cd.index })
    const baseAt = (index: number): string => cds.findLast(cd => cd.index < index)?.dir ?? workdir

    const targets = [...captures(REDIRECT, command), ...captures(TEE, command)]
    const literal = literalWrites(command)
    if (IN_PLACE.test(command)) targets.push(...captures(PATH_TOKEN, command))
    else if (literal.length > 0 && literal.length === [...command.matchAll(SCRIPT_WRITE_ALL)].length) targets.push(...literal)
    else if (SCRIPT_WRITE.test(command)) targets.push(...captures(PATH_TOKEN, command))
    for (const token of targets) {
      const path = existingSource(token.path, baseAt(token.index))
      if (path === undefined) continue
      const shown = relative(workdir, path) || path
      return `${exec.name} refused: this command would change the existing file ${shown.startsWith('..') ? path : shown} in place. `
        + 'Change existing files with the edit tool (or write to replace a whole file): it fails when the text to replace is absent and records the change. '
        + `Keep ${exec.name} for builds, git, installs, and running programs; creating new files and writing scratch output are not refused.`
    }
    return undefined
  }), 'bash-edit-guard.guard')
}
