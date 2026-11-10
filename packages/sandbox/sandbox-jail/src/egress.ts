/**
 * The egress proxy's process on the Host, the connection tokens it accepts, and the questions it asks. One proxy
 * runs outside every jail, in its own cgroup, and is restarted when it ends; a jailed command reaches it through
 * the relay each jail starts and the socket directory each jail mounts at {@link JAIL_EGRESS_DIR}
 * (`egress-proxy.mjs` and `egress-relay.c`, installed from `host/`, hold the protocol and the limits). While it is
 * down, jailed commands have no network.
 *
 * @module @aeven/sandbox-jail/egress
 */

import { spawn } from 'node:child_process'
import { createHmac, randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { SupervisedProcess } from './supervised.ts'

/** Where every jail mounts the proxy's socket directory, read-only. */
export const JAIL_EGRESS_DIR = '/run/aeven/egress'

/** Where every jail mounts the relay program. */
export const JAIL_EGRESS_RELAY = '/run/aeven/egress-relay'

/** The proxy's socket inside {@link JAIL_EGRESS_DIR}. */
const SOCKET_NAME = 'proxy.sock'

/** What the proxy enforces, written to it as configuration. */
export interface EgressLimits {
  /** Host names a command may reach, or `*.suffix` for every name beneath one. */
  allow: string[]
  /** Destination ports a connection may open, e.g. `[443]`. */
  ports: number[]
  /**
   * Hosts whose Git requests the proxy forwards with the calling account's credential, e.g. `github.com`: `git`
   * inside a jail is pointed at the proxy for `https://<host>/` URLs, and a push that touches anything but a
   * branch, or deletes one, waits for the user's approval.
   */
  gitHosts: string[]
  /** Open connections per account. */
  accountConnections: number
  /** Open connections for all accounts together. */
  connections: number
  /** Bytes per second per account, both directions together. */
  accountBytesPerSecond: number
  /** Bytes per second for all accounts together. */
  bytesPerSecond: number
  /** Bytes per UTC day per account; the count starts over when the proxy restarts. */
  accountBytesPerDay: number
  /** Milliseconds a request may wait for a free connection slot, and again to resolve and reach a destination. */
  connectTimeoutMs: number
  /** Milliseconds a connection may carry nothing before the proxy closes it. */
  idleTimeoutMs: number
}

/** One ref a push changes that needs the user's approval. */
export interface GitRefUpdate {
  /** The full ref name, e.g. `refs/tags/v1.0.0`. */
  ref: string
  kind: 'create' | 'update' | 'delete'
}

/** What the proxy asks the provider while a Git request waits. */
export type EgressQuestion =
  | { type: 'git-token'; account: string; host: string }
  | { type: 'git-approve'; account: string; session: string; host: string; repository: string; updates: GitRefUpdate[] }

/** The provider's answer to one {@link EgressQuestion}, by question type. */
export type EgressAnswer = { token?: string | undefined } | { approved: boolean }

/** Everything one proxy process starts from. */
export interface EgressOptions {
  /** The helper that switches to the sandbox user, when commands run as one; the proxy then shares their user. */
  exec?: string | undefined
  /** Host path of the Node.js that runs the proxy. */
  node: string
  /** Host path of `egress-proxy.mjs`, as `host/install-egress.sh` installs it. */
  script: string
  /** Host directory holding the socket, mounted into every jail. */
  socketDir: string
  /** The cgroup directory the proxy runs in. */
  group: string
  limits: EgressLimits
  /**
   * Answer one question of the proxy. A rejection is logged and answered as no credential and no approval.
   * @param question - the validated question.
   * @param signal - aborts when the request that asked ended first.
   * @returns the answer for the question's type.
   */
  answer: (question: EgressQuestion, signal: AbortSignal) => Promise<EgressAnswer>
  /** Reports a proxy that ended or wrote to stderr. */
  log: (level: 'info' | 'warn', message: string) => void
}

/** One supervised egress proxy and the key of its account tokens. */
export class EgressProxy {
  /** Lives as long as this object, so a restarted proxy accepts the tokens of commands already running. */
  private readonly secret = randomBytes(32)
  private readonly process: SupervisedProcess

  constructor(options: EgressOptions) {
    const config = JSON.stringify({ socket: join(options.socketDir, SOCKET_NAME), secret: this.secret.toString('hex'), ...options.limits })
    this.process = new SupervisedProcess({
      name: 'egress-proxy',
      whileDown: 'jailed commands have no network',
      log: options.log,
      spawn: () => {
        // The shell step joins the proxy's group first, so every byte it copies is charged there.
        const child = spawn('/bin/sh', [
          '-c', 'echo 0 > "$1/cgroup.procs" || exit 125; shift; exec "$@"', 'egress-proxy',
          options.group, ...options.exec === undefined ? [] : [options.exec], options.node, options.script,
        ], { env: {}, stdio: ['pipe', 'pipe', 'pipe'] })
        child.stdin.on('error', () => { /* EPIPE: the process ended; its exit is reported and it restarts. */ })
        // The configuration carries the token key, so it travels on stdin instead of an argument other users can list.
        child.stdin.write(`${config}\n`)
        const asked = new Map<number, AbortController>()
        createInterface({ input: child.stdout }).on('line', (line) => {
          const message = parseMessage(line)
          if (message === undefined) return
          if (message.question === undefined) {
            asked.get(message.id)?.abort()
            return
          }
          const controller = new AbortController()
          asked.set(message.id, controller)
          options.answer(message.question, controller.signal).catch((error: unknown): EgressAnswer => {
            options.log('warn', `egress-proxy: a ${message.question?.type ?? ''} question failed: ${error instanceof Error ? error.message : String(error)}`)
            return { approved: false }
          }).then((answer) => {
            asked.delete(message.id)
            if (!controller.signal.aborted && child.stdin.writable) child.stdin.write(`${JSON.stringify({ id: message.id, ...answer })}\n`)
          }, () => { /* unreachable: the rejection was answered above */ })
        })
        child.on('exit', () => { for (const controller of asked.values()) controller.abort() })
        return child
      },
    })
  }

  /**
   * What the relay of one jail presents to the proxy on every connection.
   * @param account - the account path segment.
   * @param session - the calling conversation, or `-` for a call without one.
   * @returns `<account> <session> <token>`, the token being the hex HMAC-SHA256 of the first two under this proxy's key.
   */
  identity(account: string, session: string): string {
    const subject = `${account} ${session}`
    return `${subject} ${createHmac('sha256', this.secret).update(subject).digest('hex')}`
  }

  /** Stop the proxy and every later restart; open connections end with it. */
  dispose(): void {
    this.process.dispose()
  }
}

/** A proxy stdout line: a question with its id, or the withdrawal of one. */
function parseMessage(line: string): { id: number; question?: EgressQuestion } | undefined {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    // SyntaxError: not a protocol line, such as a runtime's own notice on stdout; nothing asked, nothing answered.
    return undefined
  }
  if (typeof value !== 'object' || value === null) return undefined
  const { id, type, account, session, host, repository, updates } = value as Record<string, unknown>
  if (typeof id !== 'number') return undefined
  if (type === 'cancel') return { id }
  if (typeof account !== 'string' || typeof host !== 'string') return undefined
  if (type === 'git-token') return { id, question: { type, account, host } }
  if (type !== 'git-approve' || typeof session !== 'string' || typeof repository !== 'string' || !Array.isArray(updates)) return undefined
  const refs: GitRefUpdate[] = []
  for (const update of updates as unknown[]) {
    if (typeof update !== 'object' || update === null) return undefined
    const { ref, kind } = update as Record<string, unknown>
    if (typeof ref !== 'string' || (kind !== 'create' && kind !== 'update' && kind !== 'delete')) return undefined
    refs.push({ ref, kind })
  }
  return { id, question: { type, account, session, host, repository, updates: refs } }
}

/**
 * The relay's argv prefix for one jailed command.
 * @param port - the loopback port the relay listens on inside the jail.
 * @param identity - the jail's identity, from {@link EgressProxy.identity}.
 * @returns the argv to place directly before the command.
 */
export function relayArgs(port: number, identity: string): string[] {
  return [JAIL_EGRESS_RELAY, String(port), join(JAIL_EGRESS_DIR, SOCKET_NAME), identity, '--']
}

/**
 * The variables that point programs at the relay: the proxy variables, and Git URL rewrites for the hosts whose
 * Git requests carry the account's credential.
 * @param port - the loopback port the relay listens on inside the jail.
 * @param gitHosts - hosts whose `https://<host>/` Git URLs go to the proxy's Git route.
 * @returns environment entries for the jailed command.
 */
export function relayEnv(port: number, gitHosts: readonly string[]): Record<string, string> {
  const url = `http://127.0.0.1:${String(port)}`
  const git: Record<string, string> = gitHosts.length === 0 ? {} : { GIT_CONFIG_COUNT: String(gitHosts.length) }
  for (const [index, host] of gitHosts.entries()) {
    git[`GIT_CONFIG_KEY_${String(index)}`] = `url.${url}/git/${host}/.insteadOf`
    git[`GIT_CONFIG_VALUE_${String(index)}`] = `https://${host}/`
  }
  return {
    ...git,
    HTTP_PROXY: url, HTTPS_PROXY: url, http_proxy: url, https_proxy: url,
    NO_PROXY: 'localhost,127.0.0.1,::1', no_proxy: 'localhost,127.0.0.1,::1',
    // Node.js reads the variables above only when asked to.
    NODE_USE_ENV_PROXY: '1',
  }
}
