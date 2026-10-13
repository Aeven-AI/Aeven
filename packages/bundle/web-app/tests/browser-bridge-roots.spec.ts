/**
 * The Chrome DevTools MCP row declares the file root its client may hand to the
 * browser.
 *
 * `chrome-devtools-mcp` restricts every path to the OS temp directory when the
 * connecting client negotiates no MCP roots, and `@aeven/mcp-client` declares
 * no capabilities. An upload the user chose in Downloads and a screenshot
 * written into the workspace were both refused with `Access denied: path … is
 * not within any of the configured workspace roots`, so the row carries an
 * explicit `--workspace` value.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Script } from 'node:vm'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

const root = fileURLToPath(new URL('..', import.meta.url))

/** A parsed Loader entry row from the bundle's patch file. */
interface Row {
  id?: string
  config?: Record<string, unknown>
}

/** Read the bundle's patch file and flatten its insert lists. */
function rows(): Row[] {
  const parsed = yaml.load(
    readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8'),
    { schema: entryListSchema },
  )
  if (!Array.isArray(parsed)) throw new TypeError('web-app patch must parse to a patch list')
  return parsed.flatMap((patch: unknown): Row[] =>
    typeof patch === 'object' && patch !== null
      ? ((patch as { insert?: Row[] }).insert ?? [])
      : [],
  )
}

/** The `mcp-chrome-devtools` row's argument list. */
function chromeDevtoolsArgs(): unknown[] {
  const row = rows().find(candidate => candidate.id === 'mcp-chrome-devtools')
  const args = row?.config?.['args']
  if (!Array.isArray(args)) throw new TypeError('mcp-chrome-devtools must declare an args array')
  return args
}

describe('web-app bundle browser bridge', () => {
  it('passes the Host user home as the workspace its client may hand over', () => {
    const args = chromeDevtoolsArgs()
    const rootFlag = args.indexOf('--workspace')
    expect(rootFlag).toBeGreaterThan(-1)
    expect(args[rootFlag + 1]).toEqual({
      __jsExpr: 'process.env.HOME ?? process.env.USERPROFILE',
    })
    // The server attaches to the Chrome the Host started, on the same port.
    expect(args).toContain('--browser-url=http://127.0.0.1:9333')
  })

  it('avoids the two arguments that do not restrict or do not match', () => {
    const args = chromeDevtoolsArgs()
    const text = args.map(String).join(' ')
    // Deprecated upstream: it disables the guard the root above still applies.
    expect(text).not.toContain('allow-unrestricted-paths')
    // Upstream's suggested replacement, which builds a `//` prefix in the
    // containment check and therefore matches no path at all.
    expect(args).not.toContain('--workspace=/')
  })

  it('resolves that root from HOME, and from USERPROFILE when HOME is unset', () => {
    const args = chromeDevtoolsArgs()
    const expression = (args[args.indexOf('--workspace') + 1] as { __jsExpr: string }).__jsExpr
    const resolveWith = (env: Record<string, string | undefined>): string =>
      new Script(`(${expression})`).runInNewContext({ process: { env } })
    expect(resolveWith({ HOME: '/Users/tester' })).toBe('/Users/tester')
    expect(resolveWith({ USERPROFILE: 'C:\\Users\\tester' })).toBe('C:\\Users\\tester')
  })
})
