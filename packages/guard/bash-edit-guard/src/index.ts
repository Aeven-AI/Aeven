/**
 * Bash edit guard: refuse a shell command that changes an existing source file in place, so
 * edits go through the edit and write tools, which fail when the replaced text is absent, require
 * the file to have been read, and record the change. Creating new files, writing logs or scratch
 * output, installs, builds, and every other program run pass untouched.
 *
 * Detection reads the command text. A command is refused when it names an existing file with a
 * source extension and either edits in place (`sed -i`, `perl -i`), writes through a scripting
 * call (`open(…, 'w')`, `write_text`, `writeFileSync`, …), or redirects (`>`, `>>`, `tee`) into it.
 * Files under the system temporary directories are never refused.
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

const TEMP_ROOTS = [tmpdir(), '/tmp', '/private/tmp', '/var/folders', '/private/var/folders'].map(root => resolve(root))

/** Every capture group 2 of a global pattern over the command. */
function captures(pattern: RegExp, command: string): string[] {
  return [...command.matchAll(pattern)].map(match => match[2]).filter((value): value is string => value !== undefined)
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
  const existingSource = (token: string, bases: readonly string[]): string | undefined => {
    if (!extensions.has(extname(token).slice(1).toLowerCase())) return undefined
    const candidates = isAbsolute(token) ? [token] : bases.map(base => join(base, token))
    for (const candidate of candidates) {
      const path = resolve(candidate)
      if (TEMP_ROOTS.some(root => path === root || path.startsWith(`${root}/`))) continue
      // A path that vanishes or is unreadable between the two calls is not an existing file.
      try {
        if (existsSync(path) && statSync(path).isFile()) return path
      } catch {
        continue
      }
    }
    return undefined
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
    const bases = [workdir, ...captures(CD, command).map(dir => resolve(workdir, dir))]

    const targets = [...captures(REDIRECT, command), ...captures(TEE, command)]
    if (IN_PLACE.test(command) || SCRIPT_WRITE.test(command)) targets.push(...captures(PATH_TOKEN, command))
    for (const token of targets) {
      const path = existingSource(token, bases)
      if (path === undefined) continue
      const shown = relative(workdir, path) || path
      return `${exec.name} refused: this command would change the existing file ${shown.startsWith('..') ? path : shown} in place. `
        + 'Change existing files with the edit tool (or write to replace a whole file): it fails when the text to replace is absent and records the change. '
        + `Keep ${exec.name} for builds, git, installs, and running programs; creating new files and writing scratch output are not refused.`
    }
    return undefined
  }), 'bash-edit-guard.guard')
}
