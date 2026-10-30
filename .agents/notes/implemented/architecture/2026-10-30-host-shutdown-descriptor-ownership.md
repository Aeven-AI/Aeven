# Host shutdown: the pipes own their descriptors

## Context

On Windows 11 arm64 (Aeven 0.3.28-alpha, bundled Node.js 24.17.0) a `shutdown` message left the
desktop Host process alive. After it, the process answered neither its IPC channel nor its HTTP
server, and the 15 second teardown deadline in `stop()` never printed: both live on the thread that
was blocked.

Instrumenting the built entry showed teardown reaching `requestPipe.destroy()` and then never
returning. The next statement was `closePipeDescriptor(DESKTOP_REQUEST_PIPE_FD)`, a synchronous
`closeSync(3)` on the inherited request pipe. That descriptor still had a libuv read outstanding, so
closing it from the JavaScript thread wedges the thread on Windows.

The Electron shell waits 10 seconds for the child to exit, sends `SIGTERM`, waits 5 more, then
`SIGKILL` (`DesktopHostProcess.stop()`), so quitting the app cost 15 seconds, and the next launch
raced the dying Host while `claimOrAttachHost` polled the runtime lock for up to 30 seconds.

## Decision

The read and write streams own their inherited descriptors. `createReadStream` and
`createWriteStream` receive only `fd`, keeping Node's default `autoClose`, and
`closePipeDescriptor` is gone: teardown destroys the request stream and ends and destroys the
response stream, so libuv closes each descriptor after its pending request finishes.

## Consequences

- Shutdown no longer wedges: a marker trace reaches every teardown step after `shutdown`
  (withdraw the advertised URL, release the client lease, destroy the request pipe, dispose the
  fiber, release the startup lock, settle runs, disconnect IPC).
- Node's own exit path still does not return in this composition: `process.exit()` and
  `process.reallyExit()` are reached and neither terminates the process, while
  `process.kill(process.pid, 'SIGKILL')` ends it 2.5 seconds after `shutdown`. koffi and sharp
  (libvips) each exit normally in isolation, and no `exit` listener is registered, so the block is
  inside native process teardown and needs its own investigation. The shell's 10 s + 5 s wait still
  covers it, which is why a quit takes 15 seconds rather than hanging forever.
