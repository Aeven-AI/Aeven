/**
 * A read-only web server for one folder, bound to the loopback address on a free port for the length of one
 * screenshot. A page that loads JavaScript modules cannot run from a `file:` address, so a page on disk is
 * opened through this server instead. It serves files inside the folder only: no listings, no path outside it
 * through `..` or a symbolic link, and nothing but GET and HEAD.
 * @module @aeven/host-artifact-previews/folder-server
 */
import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, join, sep } from 'node:path'

/** Content types of what web pages load; anything else is served as bytes. */
const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.wasm': 'application/wasm', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
}

/** A running folder server. */
export interface FolderServer {
  /** The server's origin, such as `http://127.0.0.1:53211`. */
  readonly origin: string
  /** Stop the server. */
  close(): Promise<void>
}

/**
 * Serve one folder until closed.
 * @param folder - absolute folder path.
 * @returns the running server.
 */
export async function serveFolder(folder: string): Promise<FolderServer> {
  const root = await realpath(folder)
  const server: Server = createServer((request, response) => {
    void (async () => {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405).end()
        return
      }
      let relative: string
      try {
        relative = decodeURIComponent(new URL(request.url ?? '/', 'http://local').pathname)
      } catch {
        // A path that does not decode names no file.
        response.writeHead(400).end()
        return
      }
      try {
        const file = await realpath(join(root, relative))
        if (file !== root && !file.startsWith(`${root}${sep}`)) throw new Error('outside the folder')
        const info = await stat(file)
        if (!info.isFile()) throw new Error('not a file')
        response.writeHead(200, {
          'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
          'Content-Length': String(info.size),
          'Cache-Control': 'no-store',
        })
        if (request.method === 'HEAD') response.end()
        else createReadStream(file).pipe(response)
      } catch {
        // Absent, outside the folder, or not a regular file: all read as absent.
        response.writeHead(404).end()
      }
    })()
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { resolve() })
  })
  const { port } = server.address() as AddressInfo
  return {
    origin: `http://127.0.0.1:${String(port)}`,
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections()
      server.close(() => { resolve() })
    }),
  }
}
