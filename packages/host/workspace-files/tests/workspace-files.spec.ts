/**
 * REAL-composition coverage: a test-only cordis.yml booted through the
 * vendored Loader mounts the webserver, Connection, a stub workspace
 * registry, and the workspace-files row. Every assertion observes the served
 * HTTP surface — authentication before any path handling, file serving with
 * declared types and safety headers, unknown workspace and missing file 404s,
 * traversal rejection, 405 on non-GET/HEAD, and route release on fiber
 * disposal (HMR safety).
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import * as Connection from '@aeven/client-connection'
import LocalCredentials from '@aeven/credentials-local'
import * as FrontendStatic from '@aeven/host-frontend-static'
import HttpServer from '@aeven/host-webserver'
import * as WorkspaceFiles from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** The one workspace id the stub registry resolves. */
const WORKSPACE_ID = 'ws-1'

/**
 * Minimal `workspaceRegistry` stand-in: the route reads exactly one member of
 * the real service, so the test owns that lookup rather than booting session
 * persistence to obtain it.
 * @param dir - canonical directory reported for {@link WORKSPACE_ID}.
 * @returns a Cordis plugin providing the stub service.
 */
function stubRegistry(dir: string) {
  return {
    name: 'workspace-registry-stub',
    apply(ctx: Context): void {
      class RegistryStub extends Service {
        constructor(stubCtx: Context) {
          super(stubCtx, 'workspaceRegistry')
        }

        get(id: string): { path: string } | undefined {
          return id === WORKSPACE_ID ? { path: dir } : undefined
        }
      }
      ctx.plugin(RegistryStub)
    },
  }
}

/** Write a workspace fixture and the authenticated Web rows, then boot them through the real Loader. */
async function loadComposition(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-workspace-files-'))
  const dir = join(root, 'work')
  await mkdir(dir)
  await writeFile(join(dir, 'chart.png'), 'PNGBYTES')
  await writeFile(join(dir, 'notes.txt'), 'hello')
  await writeFile(join(dir, 'blob.bin'), 'BLOB')
  await mkdir(join(dir, 'nested'))
  await writeFile(join(dir, 'nested', 'inner.svg'), '<svg/>')
  await writeFile(join(root, 'outside.png'), 'SECRET')
  // The frontend row owns the index seat, which is where Connection mints the
  // browser cookie every other authenticated route then requires.
  const dist = join(root, 'dist')
  await mkdir(dist)
  const distIndex = join(dist, 'index.html')
  await writeFile(distIndex, '<head></head><body>shell</body>')
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@aeven/credentials-local'",
    '  config:',
    `    path: '${join(root, '.credentials.yaml')}'`,
    '    watch: false',
    "- name: '@aeven/host-webserver'",
    '  config:',
    "    host: '127.0.0.1'",
    '    port: 0',
    "- name: '@aeven/client-connection'",
    "- name: 'workspace-registry-stub'",
    '- id: frontend',
    "  name: '@aeven/host-frontend-static'",
    '  config:',
    `    distIndex: '${distIndex}'`,
    '- id: workspace-files',
    "  name: '@aeven/host-workspace-files'",
    '  config:',
    "    mount: '/workspace'",
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@aeven/credentials-local', LocalCredentials],
    ['@aeven/host-webserver', HttpServer],
    ['@aeven/client-connection', Connection],
    ['workspace-registry-stub', stubRegistry(dir)],
    ['@aeven/host-frontend-static', FrontendStatic],
    ['@aeven/host-workspace-files', WorkspaceFiles],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

/** Request one path against the running server; returns status, type, safety headers, and body. */
async function request(
  port: number, path: string, init?: RequestInit,
): Promise<{ status: number; type: string | null; nosniff: string | null; body: string }> {
  const response = await fetch(`http://127.0.0.1:${String(port)}${path}`, init)
  return {
    status: response.status,
    type: response.headers.get('content-type'),
    nosniff: response.headers.get('x-content-type-options'),
    body: await response.text(),
  }
}

describe('real Loader composition', () => {
  it('serves workspace files to authenticated readers and preserves HTTP error semantics', { timeout: 60_000 }, async () => {
    const loaded = await loadComposition()
    const unloaded = [...loaded.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])
    const port = loaded.webServer.port
    const launchUrl = loaded.connection.authenticatedUrl(`http://127.0.0.1:${String(port)}`)
    const exchange = await fetch(launchUrl, { redirect: 'manual' })
    const setCookie = exchange.headers.get('set-cookie')
    if (setCookie === null) throw new Error('authenticated surface did not set a cookie')
    const cookie = setCookie.split(';', 1)[0]!
    const authed = (init?: RequestInit): RequestInit => {
      const headers = new Headers(init?.headers)
      headers.set('cookie', cookie)
      return { ...init, headers }
    }

    // Authentication precedes path handling: an anonymous reader cannot tell a
    // real workspace id from an invented one.
    expect(await request(port, `/workspace/${WORKSPACE_ID}/chart.png`)).toMatchObject({ status: 401 })
    expect(await request(port, '/workspace/nope/chart.png')).toMatchObject({ status: 401 })

    expect(await request(port, `/workspace/${WORKSPACE_ID}/chart.png`, authed())).toMatchObject({
      status: 200,
      type: 'image/png',
      nosniff: 'nosniff',
      body: 'PNGBYTES',
    })
    expect(await request(port, `/workspace/${WORKSPACE_ID}/nested/inner.svg`, authed())).toMatchObject({
      status: 200,
      type: 'image/svg+xml',
      body: '<svg/>',
    })
    expect(await request(port, `/workspace/${WORKSPACE_ID}/notes.txt`, authed())).toMatchObject({
      status: 200,
      type: 'text/plain; charset=utf-8',
    })
    // An unknown extension downloads rather than executing.
    expect(await request(port, `/workspace/${WORKSPACE_ID}/blob.bin`, authed())).toMatchObject({
      status: 200,
      type: 'application/octet-stream',
    })
    // A rewritten file is served fresh under the unchanged URL.
    await writeFile(join(root!, 'work', 'chart.png'), 'REDRAWN')
    expect(await request(port, `/workspace/${WORKSPACE_ID}/chart.png`, authed())).toMatchObject({ body: 'REDRAWN' })

    expect(await request(port, `/workspace/${WORKSPACE_ID}/missing.png`, authed())).toMatchObject({ status: 404 })
    expect(await request(port, `/workspace/${WORKSPACE_ID}/nested`, authed())).toMatchObject({ status: 404 })
    expect(await request(port, '/workspace/unknown-id/chart.png', authed())).toMatchObject({ status: 404 })
    expect(await request(port, '/workspace', authed())).toMatchObject({ status: 404 })
    expect(await request(port, '/workspace/', authed())).toMatchObject({ status: 404 })

    // Traversal cannot reach a sibling of the workspace directory. A plain
    // `..` segment never survives: URL parsing collapses it before the route
    // resolves anything, leaving a path that addresses an unregistered id. An
    // encoded SLASH does survive that normalization and only becomes a `..`
    // segment once the route decodes it, so the resolved-prefix check is what
    // stands between these two requests and the file beside the workspace.
    expect(await request(port, `/workspace/${WORKSPACE_ID}/../outside.png`, authed())).toMatchObject({ status: 404 })
    expect(await request(port, `/workspace/${WORKSPACE_ID}/..%2foutside.png`, authed())).toMatchObject({ status: 403 })
    expect(await request(port, `/workspace/${WORKSPACE_ID}/%2e%2e%2foutside.png`, authed())).toMatchObject({ status: 403 })

    expect(await request(port, `/workspace/${WORKSPACE_ID}/chart.png`, authed({ method: 'POST' }))).toMatchObject({ status: 405 })

    // A filesystem failure that is not a miss is rethrown rather than
    // reported as 404, so the webserver's request-failure handling answers.
    // An over-long name reaches ENAMETOOLONG on every supported platform
    // without depending on process privileges.
    expect(await request(port, `/workspace/${WORKSPACE_ID}/${'n'.repeat(512)}.png`, authed())).toMatchObject({ status: 400 })

    // HMR safety: disposing only the workspace-files entry releases its route
    // while the server keeps running, so the path falls through to the
    // frontend fallback instead of still being served from the workspace.
    const entry = [...loaded.loader.entries()].find(row => row.options.id === 'workspace-files')
    if (entry?.fiber === undefined) throw new Error('workspace-files entry never loaded')
    await entry.fiber.dispose()
    const afterDispose = await request(port, `/workspace/${WORKSPACE_ID}/chart.png`, authed())
    expect(afterDispose.body).not.toBe('REDRAWN')
  })
})
