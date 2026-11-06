/**
 * The executor helper: a small child of the Host that keeps a pool of idle
 * launchers and hands each one's stdin, stdout, stderr, and control pipe to
 * the Host as open descriptors. A launcher is a `bash` that blocks reading a
 * script from its control pipe, then `eval`s it; the script `exec`s the
 * command, so the command keeps the launcher's pid and process group. The
 * helper reports each launcher's pid when it is ready and its exit status when
 * it ends, refills the pool when the Host takes a launcher, and kills its idle
 * launchers when the Host disconnects.
 *
 * Usage: `node worker.cjs <pool size>`, with an IPC channel to the Host.
 *
 * @module @aeven/subprocess-executor/worker
 */

import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import type { Socket } from 'node:net'

/**
 * Reads the whole control pipe with one `cat` (bash's `read` takes a byte per
 * system call from a socket, and every script carries the command's whole
 * environment), keeping trailing newlines through the `x` sentinel; closes
 * every descriptor above stderr so the command inherits none of the helper's
 * or the Host's sockets; and runs the script. The loop takes no redirection of
 * its own: bash would park stderr above 2 for it and lose it to the loop.
 */
const LAUNCHER = 'script=$(/bin/cat <&3; printf x); script=${script%x}; for fd in /dev/fd/*; do fd=${fd##*/}; [ "$fd" -gt 2 ] && eval "exec $fd<&-"; done; eval "$script"'

/** The descriptors handed to the Host, in this order, before `ready`. */
const HANDLES = ['stdin', 'stdout', 'stderr', 'control'] as const

const poolSize = Number(process.argv[2])
if (!Number.isInteger(poolSize) || poolSize < 1 || process.send === undefined) {
  process.stderr.write('subprocess-executor helper: usage: helper <pool size>, started with an IPC channel\n')
  process.exit(2)
}
const toHost = process.send.bind(process)

/**
 * Send to the Host while it is connected; after it leaves, nothing is listening.
 * @param message - the message.
 * @param handle - a descriptor to hand over with it.
 */
function send(message: object, handle?: Socket): void {
  if (!process.connected) return
  if (handle === undefined) toHost(message)
  else toHost(message, handle, { keepOpen: false })
}

let nextId = 0
let idle = 0
const launchers = new Map<number, ChildProcess>()
const taken = new Set<number>()

/** Start one launcher and hand its descriptors to the Host. */
function start(): void {
  const id = ++nextId
  const child = spawn('/bin/bash', ['--noprofile', '--norc', '-c', LAUNCHER], {
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    env: {},
  })
  launchers.set(id, child)
  idle += 1
  child.on('error', (error) => {
    launchers.delete(id)
    if (!taken.delete(id)) idle -= 1
    send({ t: 'gone', id, code: null, signal: null, message: error.message })
  })
  // The Host may have taken a launcher whose `taken` notice has not arrived yet,
  // so `gone` carries the exit status too: the Host settles a command it started.
  child.on('exit', (code, signal) => {
    launchers.delete(id)
    if (taken.delete(id)) {
      send({ t: 'exit', id, code, signal })
    } else {
      idle -= 1
      send({ t: 'gone', id, code, signal, message: `launcher exited before the Host's notice (${String(code ?? signal)})` })
      fill()
    }
  })
  if (child.pid === undefined) return
  HANDLES.forEach((which, index) => {
    send({ t: 'handle', id, which }, child.stdio[index] as Socket)
  })
  send({ t: 'ready', id, pid: child.pid })
}

/** Keep the pool at its size. */
function fill(): void {
  while (idle < poolSize) start()
}

process.on('message', (message: { t?: unknown; id?: unknown }) => {
  if (message.t !== 'taken' || typeof message.id !== 'number' || !launchers.has(message.id)) return
  taken.add(message.id)
  idle -= 1
  fill()
})

/**
 * Kill the launchers nobody took and exit. The Host owns every command it
 * started and terminates those itself.
 */
function shutDown(): void {
  for (const [id, child] of launchers) {
    if (taken.has(id) || child.pid === undefined) continue
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      // ESRCH: the idle launcher already ended.
    }
  }
  process.exit(0)
}

// A Host that dies without closing the channel still leaves this process reparented.
const host = process.ppid
setInterval(() => { if (process.ppid !== host) shutDown() }, 1000)
process.on('disconnect', shutDown)
process.on('SIGTERM', shutDown)

fill()
