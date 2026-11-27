/**
 * The native messaging host the Aeven browser extension starts: it relays the
 * browser's length-prefixed JSON messages on stdin and stdout to and from the
 * desktop app's local socket, one JSON message per line there.
 *
 * Started by the launcher `browser-extension.ts` installs, with this app's own
 * runtime in Node mode and the socket path as its argument. It exits when either
 * side closes; when the app is not running it tells the extension so and exits.
 */

import { connect } from 'node:net'

const socketPath = process.argv[2]
if (socketPath === undefined) process.exit(1)

/**
 * Write one message to the browser: a 32-bit native-endian length, then the JSON.
 * @param message - the message.
 */
function toBrowser(message: unknown): void {
  const body = Buffer.from(JSON.stringify(message), 'utf8')
  const header = Buffer.alloc(4)
  header.writeUInt32LE(body.length, 0)
  process.stdout.write(Buffer.concat([header, body]))
}

const socket = connect(socketPath)
socket.on('error', () => {
  toBrowser({ event: 'unavailable', message: 'Aeven is not running' })
  process.exit(0)
})
socket.on('close', () => { process.exit(0) })

let lines = ''
socket.setEncoding('utf8')
socket.on('data', (chunk: string) => {
  lines += chunk
  let newline = lines.indexOf('\n')
  while (newline >= 0) {
    const line = lines.slice(0, newline)
    lines = lines.slice(newline + 1)
    newline = lines.indexOf('\n')
    if (line.trim() !== '') toBrowser(JSON.parse(line))
  }
})

let input = Buffer.alloc(0)
process.stdin.on('data', (chunk: Buffer) => {
  input = Buffer.concat([input, chunk])
  while (input.length >= 4) {
    const length = input.readUInt32LE(0)
    if (input.length < 4 + length) break
    const body = input.subarray(4, 4 + length).toString('utf8')
    input = input.subarray(4 + length)
    socket.write(`${body}\n`)
  }
})
process.stdin.on('end', () => { socket.end() })
