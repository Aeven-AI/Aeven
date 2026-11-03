/**
 * Git remote URLs as they cross devices: published without credentials, and compared by host and path so the SSH and
 * HTTPS forms of one repository match.
 * @module @aeven/workspace-git-sync/remote
 */

/** `user@host:path`, Git's scp-like SSH form; a single-letter host is a Windows drive, not a host. */
const SCP_LIKE = /^(?:([^@/]+)@)?([^:/]{2,}):(?!\/\/)(.+)$/u

/** URL schemes another device can reach; `file:` and local paths name this device's disk. */
const NETWORK_SCHEMES = new Set(['ssh:', 'git:', 'http:', 'https:', 'git+ssh:', 'ssh+git:'])

interface ParsedRemote {
  host: string
  path: string
  /** The URL to publish: an HTTP URL without user name or password, an SSH URL without a password. */
  published: string
}

function parse(url: string): ParsedRemote | undefined {
  const trimmed = url.trim()
  const scp = SCP_LIKE.exec(trimmed)
  if (scp !== null && !trimmed.includes('://')) {
    const [, user, host = '', path = ''] = scp
    return { host, path, published: `${user === undefined ? '' : `${user}@`}${host}:${path}` }
  }
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    // Neither a URL nor the scp-like form: a local path, which no other device can clone from.
    return undefined
  }
  if (!NETWORK_SCHEMES.has(parsed.protocol) || parsed.hostname === '') return undefined
  const http = parsed.protocol === 'http:' || parsed.protocol === 'https:'
  if (http) parsed.username = ''
  parsed.password = ''
  return { host: parsed.hostname, path: decodeURIComponent(parsed.pathname), published: parsed.toString() }
}

/**
 * A remote URL fit to publish to the account's other devices.
 * @param url - the URL `git remote get-url` reports.
 * @returns the URL without credentials, or undefined for a remote only this device can reach.
 */
export function publicRemote(url: string): string | undefined {
  return parse(url)?.published
}

/**
 * The form two remote URLs share when they name one repository: lower-case host and path, without scheme, user,
 * port, `.git`, and surrounding slashes.
 * @param url - any remote URL.
 * @returns the comparison key, or undefined for a remote only this device can reach.
 */
export function remoteKey(url: string): string | undefined {
  const remote = parse(url)
  if (remote === undefined) return undefined
  const path = remote.path.replace(/^\/?~?\/*/u, '').replace(/\/+$/u, '').replace(/\.git$/u, '')
  return `${remote.host}/${path}`.toLowerCase()
}
