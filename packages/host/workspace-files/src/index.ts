/**
 * @aeven/host-workspace-files — read-only HTTP access to the files
 * of a registered workspace, so a file the agent produces can be referenced
 * from a model reply that the browser renders (a markdown image, a link).
 *
 * One prefix route serves `<mount>/<workspaceId>/<relative path>` from that
 * workspace's canonical directory. Every request passes Connection's
 * Host/Origin fence and browser authentication before any path is resolved,
 * traversal outside the workspace directory is 403, an unknown workspace or
 * absent file is 404, and non-GET/HEAD is 405.
 *
 * EXPOSURE: the whole workspace directory is readable over HTTP to any client
 * holding a valid browser session — source, dotfiles, and credentials
 * included. The route is authenticated, never public, and the server binds
 * loopback unless a deployment widens it.
 * @module @aeven/host-workspace-files
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@aeven/client-connection'
import type {} from '@aeven/host-webserver'
import type { WorkspaceId } from '@aeven/workspace'
import type {} from '@aeven/workspace'

/** Stable Cordis plugin name. */
export const name = 'workspace-files'

/** Services required before the route can be registered. */
export const inject = ['webServer', 'connection', 'workspaceRegistry']

/** Plugin config: where the read-only workspace tree is mounted. */
export interface Config {
  /** Absolute route prefix, no trailing slash. */
  mount: string
}

export const Config: z<Config> = z.object({
  mount: z.string().default('/workspace'),
})

/**
 * Content types served for known extensions. Anything absent ships as
 * `application/octet-stream`, which browsers download rather than execute.
 */
const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.json': 'application/json',
  '.csv': 'text/csv; charset=utf-8',
}

/** Filesystem outcomes that mean "no such file here" rather than a real failure. */
const MISS_CODES: ReadonlySet<string | undefined> = new Set(['ENOENT', 'EISDIR', 'ENOTDIR'])

/**
 * Response headers applied to every served body. `nosniff` keeps the declared
 * type authoritative, and the sandboxed `default-src 'none'` policy is what
 * makes serving `image/svg+xml` safe: an SVG opened as a top-level document
 * cannot run its own scripts or fetch anything. `no-store` keeps a rewritten
 * file from being served from cache under its unchanged URL.
 */
const SAFETY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; sandbox",
  'cache-control': 'no-store',
}

/**
 * Serve one authenticated GET/HEAD request addressed below the mount.
 * @param rest - request pathname with the mount prefix already removed.
 * @param res - the node:http response to write.
 * @param rootOf - resolves a workspace id to its canonical directory, or
 * undefined when no such workspace is registered.
 */
export async function serveWorkspaceFile(
  rest: string,
  res: ServerResponse,
  rootOf: (workspaceId: string) => string | undefined,
): Promise<void> {
  // `rest` is '', '/', '/<id>', or '/<id>/<relative path>'.
  const [, rawId = '', ...segments] = rest.split('/')
  const root = rawId === '' ? undefined : rootOf(rawId)
  if (root === undefined) {
    res.writeHead(404, SAFETY_HEADERS)
    res.end()
    return
  }
  const target = resolve(normalize(join(root, segments.join('/'))))
  // Traversal rejection mirrors frontend-static: the target must be the root
  // itself or stay under it. `sep`, not '/', because resolve() emits backslash
  // paths on Windows.
  if (target !== root && !target.startsWith(root + sep)) {
    res.writeHead(403, SAFETY_HEADERS)
    res.end()
    return
  }
  let body: Buffer
  try {
    body = await readFile(target)
  } catch (error) {
    // Only absent or non-file targets are 404; other filesystem failures reach
    // the webserver's request-failure handling.
    if (!MISS_CODES.has((error as NodeJS.ErrnoException).code)) throw error
    res.writeHead(404, SAFETY_HEADERS)
    res.end()
    return
  }
  res.writeHead(200, {
    ...SAFETY_HEADERS,
    'content-type': MIME[extname(target).toLowerCase()] ?? 'application/octet-stream',
  })
  res.end(body)
}

/**
 * Register the authenticated read-only workspace route.
 * @param ctx - plugin context carrying webServer, connection, and workspaceRegistry.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  const mount = config.mount
  const rootOf = (workspaceId: string): string | undefined =>
    ctx.workspaceRegistry.get(workspaceId as WorkspaceId)?.path
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: mount,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      // Authentication precedes path handling so an unauthenticated caller
      // cannot probe which workspace ids or files exist.
      const rejection = ctx.connection.requestRejection(req)
      if (rejection !== undefined) {
        res.writeHead(rejection, SAFETY_HEADERS)
        res.end()
        return
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, SAFETY_HEADERS)
        res.end()
        return
      }
      /* v8 ignore next -- node:http always sets url on server requests */
      const pathname = new URL(req.url ?? '/', 'http://x').pathname
      await serveWorkspaceFile(decodeURIComponent(pathname).slice(mount.length), res, rootOf)
    },
  }), `workspace-files: ${mount} route`)
}
