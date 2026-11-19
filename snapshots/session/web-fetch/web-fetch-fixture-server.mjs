/**
 * Deterministic HTTP provider for the web-fetch snapshot scenarios: a small
 * UTF-8 HTML page with a malformed charset declaration, and a one-page PDF
 * served without a file extension in its URL, on an OS-assigned loopback port
 * behind the real address-pinned transport. Recording and replay therefore
 * exercise fetch, markdown rendering, and document text extraction without
 * external network while retaining the recorded request URLs.
 */
import { HttpFetchProvider } from '@aeven/web-fetch-http'
import { applyLoopbackServerEffect } from '../loopback-fixture-server.mjs'

/** Model-visible URLs retained by the recorded sessions, keyed to their loopback paths. */
const RECORDED_URLS = new Map([
  ['http://public.test:43117/menu.html', '/menu.html'],
  ['http://public.test:43117/publicaties/2026-118/deelnemers', '/publicaties/2026-118/deelnemers'],
])

const PAGE = `<!doctype html>
<html><head><title>Menu</title><style>.x{color:red}</style><script>ignored()</script></head>
<body>
<h1>Café menu</h1>
<p>Prices include <strong>service &amp; <em>tax</em></strong> &mdash; updated daily.</p>
<ul><li>Espresso</li><li>Flat white</li></ul>
<table><thead><tr><th>Drink</th><th>Price</th></tr></thead><tbody><tr><td>Espresso</td><td>€2</td></tr><tr><td>Flat white</td><td>€3</td></tr></tbody></table>
<p>See <a href="https://fixture.invalid/specials">today&rsquo;s specials</a>.</p>
</body></html>
`

/** Text lines of the fixture PDF, a fictional tender participant list. */
const PDF_LINES = [
  'Deelnemerslijst DAS Datacenter Services 2026-118',
  'Toegelaten leveranciers per 12 maart 2026:',
  '1. Noordlicht Rekencentra B.V. (Networking, Server)',
  '2. Polderwolk Hosting B.V. (Storage, Housing)',
  '3. Duinrand Integratie B.V. (Integration, Security)',
]

/**
 * Build a minimal one-page PDF with a Helvetica text layer and a byte-exact cross-reference table.
 * @param lines - text lines drawn top to bottom; ASCII without parentheses or backslashes.
 * @returns the complete PDF file.
 */
function buildPdf(lines) {
  const content = `BT /F1 12 Tf 72 720 Td 16 TL ${lines.map(line => `(${line}) Tj T*`).join(' ')} ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let body = '%PDF-1.4\n'
  const offsets = objects.map((object, index) => {
    const offset = body.length
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
    return offset
  })
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  body += offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}

const PDF = buildPdf(PDF_LINES)

/** Cordis plugin name. */
export const name = 'web-fetch-fixture-server'

/** Service used by the fixture provider. */
export const inject = ['web']

const LIMITS = {
  maxResponseBytes: 5_000_000,
  maxDocumentBytes: 25_000_000,
  maxBodyChars: 100_000,
  timeoutMs: 30_000,
  maxRedirects: 5,
  userAgent: 'aeven-snapshot/1.0',
}

/**
 * Register the deterministic provider and start its loopback server.
 * @param ctx - Cordis context; the effect disposes the server with the fiber.
 */
export async function apply(ctx) {
  const readiness = Promise.withResolvers()
  let transportUrl
  let startupError

  const resolveAddresses = async (hostname) => {
    if (hostname !== 'public.test') throw new Error(`unexpected snapshot hostname: ${hostname}`)
    return [{ address: '127.0.0.1', family: 4 }]
  }

  const provider = new HttpFetchProvider(LIMITS, resolveAddresses)
  const unregister = ctx.web.registerFetchProvider({
    id: provider.id,
    available: () => provider.available(),
    fetch: async (request, signal) => {
      const path = RECORDED_URLS.get(request.url)
      if (path === undefined) throw new Error(`unexpected snapshot URL: ${request.url}`)
      await readiness.promise
      if (startupError !== undefined) throw startupError
      const result = await provider.fetch({ url: new URL(path, transportUrl).toString() }, signal)
      return { ...result, url: request.url }
    },
  })
  try {
    await applyLoopbackServerEffect(ctx, {
      label: 'web-fetch-fixture-server',
      requestListener: (req, res) => {
        if (req.url === '/menu.html') {
          res.writeHead(200, { 'content-type': 'text/html; charset=gbk,utf-8' })
          res.end(PAGE)
          return
        }
        if (req.url === '/publicaties/2026-118/deelnemers') {
          res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="deelnemerslijst-2026-118.pdf"' })
          res.end(PDF)
          return
        }
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('not found')
      },
      onListening: (address) => {
        transportUrl = new URL(`http://public.test:${String(address.port)}/`)
        readiness.resolve(undefined)
      },
      onCleanup: () => {
        unregister()
      },
    })
  } catch (cause) {
    startupError = cause
    readiness.resolve(undefined)
    throw cause
  }
}
