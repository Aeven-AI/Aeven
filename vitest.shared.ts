import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import type { Alias } from 'vite'

const decoratorSyntax = /^\s*@[A-Za-z_$][\w$]*/m

/**
 * Worker arguments that keep process-wide Web Storage from shadowing jsdom storage.
 * Node lists the positive spelling in `allowedNodeEnvironmentFlags` for this negatable flag.
 */
export const vitestExecArgv = process.allowedNodeEnvironmentFlags.has('--webstorage') ? ['--no-webstorage'] : []

const repositoryRoot = dirname(fileURLToPath(import.meta.url))

/** Characters that carry meaning in a RegExp and must survive a specifier literally. */
const regExpMetacharacters = /[.*+?^${}()|[\]\\]/g

/**
 * Turn one tsconfig `paths` key into a pattern matching exactly what TypeScript matches.
 * @param key - the `paths` key, with at most one `*`.
 * @returns an anchored pattern whose only capture, when the key has a `*`, is the substituted suffix.
 */
function aliasPattern(key: string): RegExp {
  const [prefix, suffix] = key.split('*')
  const literal = (part: string): string => part.replace(regExpMetacharacters, '\\$&')
  return suffix === undefined
    ? new RegExp(`^${literal(prefix!)}$`)
    : new RegExp(`^${literal(prefix!)}(.*)${literal(suffix)}$`)
}

/**
 * Workspace specifiers mapped to source, as Vite aliases.
 *
 * Aliases rather than `resolve.tsconfigPaths`, because a path mapping only wins
 * over a package's own `exports` when it is an alias: native tsconfig resolution
 * runs after package resolution, so a workspace specifier resolves through the
 * symlink to built `lib/` whenever that output exists. Two copies of a module
 * then load, `instanceof` fails across them, and every service singleton
 * doubles — the artifact-plane leak `paths` exists to close.
 *
 * `tsconfig.base.json` is the one config in the repository declaring `paths`,
 * so its map is the whole of what test files may resolve. Patterns are anchored
 * and exact ones precede wildcards, matching TypeScript's own preference for
 * the more specific key.
 *
 * @returns one alias per `paths` entry, most specific first.
 */
export function workspaceAliases(): Alias[] {
  const configPath = resolve(repositoryRoot, 'tsconfig.base.json')
  const read = ts.readConfigFile(configPath, ts.sys.readFile)
  if (read.error !== undefined) {
    throw new Error(`vitest: cannot read ${configPath}: ${ts.flattenDiagnosticMessageText(read.error.messageText, ' ')}`)
  }
  const paths: unknown = (read.config as { compilerOptions?: { paths?: unknown } }).compilerOptions?.paths
  if (typeof paths !== 'object' || paths === null) {
    throw new Error(`vitest: ${configPath} declares no compilerOptions.paths to resolve workspace specifiers with.`)
  }
  const entries = Object.entries(paths as Record<string, string[]>)
  return entries
    // A wildcard key would otherwise shadow an exact key naming the same subpath.
    .sort(([left], [right]) => Number(left.includes('*')) - Number(right.includes('*')))
    .map(([key, targets]) => {
      const target = targets[0]
      if (target === undefined) throw new Error(`vitest: path mapping ${key} names no target.`)
      return {
        find: aliasPattern(key),
        replacement: resolve(repositoryRoot, target).replace(/\*/, '$1'),
      }
    })
}

/**
 * Transform standard TypeScript decorators before Vite's default parser sees source files.
 * @returns a pre-transform Vite plugin shared by source-mode test configurations.
 */
export function standardDecoratorPlugin() {
  return {
    name: 'avn-standard-decorators',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      const file = id.split('?', 1)[0]!
      if (!/\.[cm]?tsx?$/.test(file) || !decoratorSyntax.test(code)) return
      const result = ts.transpileModule(code, {
        fileName: file,
        compilerOptions: {
          target: ts.ScriptTarget.ES2024,
          module: ts.ModuleKind.ESNext,
          jsx: file.endsWith('x') ? ts.JsxEmit.ReactJSX : undefined,
          sourceMap: true,
        },
      })
      return {
        code: result.outputText
          .replace(
            /^(\s*)(__esDecorate\()/gmu,
            '$1/* v8 ignore next -- compiler-synthetic decorator accessors have no source behavior */ $2',
          )
          .replace(/\n?\/\/# sourceMappingURL=.*$/u, '\n'),
        map: result.sourceMapText,
      }
    },
  }
}
