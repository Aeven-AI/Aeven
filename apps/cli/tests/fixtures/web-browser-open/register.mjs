import { existsSync, rmSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { join } from 'node:path'

const openerUrl = new URL('./open.mjs', import.meta.url).href
// Every stop below goes through the CLI's SIGTERM handler, as a supervisor's stop does: a bare `process.exit`
// would skip the application's disposal and end its worker threads mid-call.
// A second SIGTERM escalates to a forced exit, so the fixture sends one.
let stopped = false
const stop = () => {
  if (stopped) return
  stopped = true
  process.kill(process.pid, 'SIGTERM')
}
const exitMarker = join(process.cwd(), `.aeven-browser-open-${process.pid}`)

const markerPoll = setInterval(() => {
  if (!existsSync(exitMarker)) return
  rmSync(exitMarker, { force: true })
  clearInterval(markerPoll)
  stop()
}, 25)
markerPoll.unref()

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'open') return { shortCircuit: true, url: openerUrl }
    return nextResolve(specifier, context)
  },
})

// The SSH case has no opener helper to stop the long-lived Web process.
if (process.env.AVN_BROWSER_OPEN_TEST_EXIT_ON_READY === '1') {
  const originalLog = console.log
  console.log = (...args) => {
    originalLog(...args)
    if (typeof args[0] === 'string' && args[0].startsWith('avn web: ')) {
      setTimeout(stop, 250)
    }
  }
}

if (process.env.AVN_BROWSER_OPEN_TEST_EXIT_ON_FAILURE === '1') {
  const originalError = console.error
  console.error = (...args) => {
    originalError(...args)
    if (typeof args[0] === 'string' && args[0].startsWith('web-app: could not open the default browser because ')) {
      setTimeout(stop, 0)
    }
  }
}
