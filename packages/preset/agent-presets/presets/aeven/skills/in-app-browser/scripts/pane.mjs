// Drive the in-app browser pane: list its CDP targets, capture its page as a PNG,
// press a toolbar control, or evaluate an expression in the page or the app window.
//
// The pane is a `<webview>` inside the application window. Both are DevTools
// targets on the application's debug port; nothing here uses the preview_* tools,
// so prefer those for reading and interacting with the page.
//
// Node >= 22 (global fetch and WebSocket), no dependencies.
//
//   node pane.mjs list [--port <n>]
//   node pane.mjs capture --out <file.png> [--match <url substring>] [--port <n>]
//   node pane.mjs click "<aria label>" [--port <n>]
//   node pane.mjs eval <webview|page> "<expression>" [--port <n>]

const DEFAULT_PORTS = [9222, 9223, 9224, 9225]
const TIMEOUT_MS = 5000

/**
 * Parse `--flag value` pairs and positional arguments.
 * @param argv - arguments after the script name.
 * @returns flags, positionals, and the optional `--port`.
 */
function parseArgs(argv) {
  const flags = new Map()
  const positional = []
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token.startsWith('--')) {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`${token} needs a value`)
      flags.set(token.slice(2), value)
      i += 1
    } else positional.push(token)
  }
  const port = flags.get('port')
  return { flags, positional, port: port === undefined ? undefined : Number(port) }
}

/**
 * Answer whether a debug port serves the DevTools protocol.
 * @param port - candidate TCP port.
 * @returns the protocol version, or undefined when nothing answers.
 */
async function probe(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) })
    if (!response.ok) return undefined
    return await response.json()
  } catch {
    return undefined
  }
}

/**
 * Find the application's debug port.
 * @param requested - port from `--port`, when given.
 * @returns the answering port.
 * @throws when no candidate answers.
 */
async function findPort(requested) {
  const candidates = requested === undefined ? DEFAULT_PORTS : [requested]
  for (const port of candidates) {
    const version = await probe(port)
    if (version !== undefined) return { port, version }
  }
  throw new Error(`no DevTools endpoint answered on ${candidates.join(', ')}; is the application running?`)
}

/**
 * List the DevTools targets on a port.
 * @param port - the answering port.
 * @returns the target list.
 */
async function listTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!response.ok) throw new Error(`GET /json/list answered ${response.status}`)
  return await response.json()
}

/**
 * Open a CDP session over one target.
 * @param wsUrl - the target's `webSocketDebuggerUrl`.
 * @returns `send`, `evaluate`, and `close`.
 */
async function connect(wsUrl) {
  const socket = new WebSocket(wsUrl)
  const pending = new Map()
  let nextId = 0
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const entry = pending.get(message.id)
    if (entry === undefined) return
    pending.delete(message.id)
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)))
    else entry.resolve(message.result)
  })
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', () => reject(new Error(`cannot attach to ${wsUrl}`)), { once: true })
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = (nextId += 1)
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (exceptionDetails) throw new Error(JSON.stringify(exceptionDetails))
    return result.value
  }
  return { send, evaluate, close: () => socket.close() }
}

/**
 * Choose the pane's page target.
 * @param targets - the target list.
 * @param match - optional URL substring, for a window with several panes.
 * @returns the chosen target.
 */
function pickWebview(targets, match) {
  const panes = targets.filter((target) => target.type === 'webview')
  if (panes.length === 0) throw new Error('no webview target: the pane is closed, or the app was restarted')
  const chosen = match === undefined ? panes : panes.filter((pane) => (pane.url ?? '').includes(match))
  if (chosen.length === 0) throw new Error(`no pane matches "${match}"; open panes: ${panes.map((pane) => pane.url).join(', ')}`)
  if (chosen.length > 1) throw new Error(`several panes match; pass --match with one of: ${chosen.map((pane) => pane.url).join(', ')}`)
  return chosen[0]
}

/**
 * Find the application window that hosts the pane, by asking each page target for
 * a `<webview>` element.
 * @param targets - the target list.
 * @returns the hosting target.
 */
async function pickAppPage(targets) {
  const pages = targets.filter((target) => target.type === 'page' && !String(target.url ?? '').startsWith('devtools://'))
  for (const page of pages) {
    const session = await connect(page.webSocketDebuggerUrl)
    try {
      const hostsPane = await session.evaluate("document.querySelector('webview') !== null")
      if (hostsPane === true) return page
    } catch {
      // A target that refuses evaluation is not the window hosting the pane.
    } finally {
      session.close()
    }
  }
  throw new Error('no application window hosts a webview; is the pane open?')
}

/**
 * Report the pane targets, and whether an application window hosts them.
 * @param port - the answering port.
 * @returns the report the `list` command prints.
 */
async function list(port) {
  const targets = await listTargets(port)
  let host = null
  try {
    host = await pickAppPage(targets)
  } catch {
    // The page target is optional for reading; its absence is reported, not thrown.
  }
  return {
    port,
    panes: targets.filter((target) => target.type === 'webview').map((target) => ({ url: target.url, title: target.title })),
    appWindow: host === null ? null : { url: host.url, title: host.title },
    otherTargets: targets.filter((target) => !['webview', 'page'].includes(target.type)).length,
  }
}

/**
 * Capture the pane's page to a file.
 * @param port - the answering port.
 * @param out - destination path.
 * @param match - optional URL substring.
 * @returns the file and the page's own reading of its viewport.
 */
async function capture(port, out, match) {
  const { writeFile } = await import('node:fs/promises')
  const target = pickWebview(await listTargets(port), match)
  const session = await connect(target.webSocketDebuggerUrl)
  try {
    await session.send('Page.enable')
    const { data } = await session.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
    await writeFile(out, Buffer.from(data, 'base64'))
    const page = await session.evaluate('({url: location.href, title: document.title, innerWidth, innerHeight, dpr: devicePixelRatio})')
    return { out, ...page }
  } finally {
    session.close()
  }
}

/**
 * Press one toolbar control in the application window that hosts the pane.
 * @param port - the answering port.
 * @param label - the control's `aria-label`.
 * @returns the control that was pressed.
 */
async function click(port, label) {
  const target = await pickAppPage(await listTargets(port))
  const session = await connect(target.webSocketDebuggerUrl)
  try {
    const result = await session.evaluate(`(() => {
      const pane = document.querySelector('webview').closest('div').parentElement.parentElement
      const control = pane.querySelector('[aria-label=' + JSON.stringify(${JSON.stringify(label)}) + ']')
      if (control === null) return { ok: false, reason: 'no control with that aria-label' }
      if (control.disabled === true) return { ok: false, reason: 'control is disabled' }
      control.click()
      return { ok: true, tag: control.tagName, label: ${JSON.stringify(label)}, address: pane.querySelector('[aria-label="Address"]')?.value ?? null }
    })()`)
    if (result.ok !== true) throw new Error(result.reason)
    return result
  } finally {
    session.close()
  }
}

/**
 * Evaluate an expression in the pane or in the application window.
 * @param port - the answering port.
 * @param where - `webview` for the page, `page` for the window hosting the pane.
 * @param expression - expression evaluated for its value.
 * @returns the value.
 */
async function evaluateIn(port, where, expression) {
  const targets = await listTargets(port)
  const target = where === 'webview' ? pickWebview(targets) : await pickAppPage(targets)
  const session = await connect(target.webSocketDebuggerUrl)
  try {
    return await session.evaluate(expression)
  } finally {
    session.close()
  }
}

const { flags, positional, port: requested } = parseArgs(process.argv.slice(2))
const [command] = positional

try {
  const { port, version } = await findPort(requested)
  let result
  switch (command) {
    case 'list': result = await list(port); break
    case 'capture': {
      const out = flags.get('out')
      if (out === undefined) throw new Error('capture needs --out <file.png>')
      result = await capture(port, out, flags.get('match'))
      break
    }
    case 'click': {
      const label = positional[1]
      if (label === undefined) throw new Error('click needs an aria label, for example: click "Copy screenshot"')
      result = await click(port, label)
      break
    }
    case 'eval': {
      const [, where, expression] = positional
      if (where !== 'webview' && where !== 'page') throw new Error('eval needs a target: webview or page')
      if (expression === undefined) throw new Error('eval needs an expression')
      result = await evaluateIn(port, where, expression)
      break
    }
    default:
      throw new Error('usage: pane.mjs list | capture --out <file.png> | click "<aria label>" | eval <webview|page> "<expression>"')
  }
  console.log(JSON.stringify({ port, browser: version.Browser, ...result }, null, 2))
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2))
  process.exitCode = 1
}
