/** GitHub deliveries to one bot's own endpoint: signature verification, filtering, and the summary a run reads. */
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { GitHubEventFilter } from './types.ts'

/**
 * Whether a body carries GitHub's `X-Hub-Signature-256` for the bot's key.
 * @param secret - the bot's inbound key, which its owner enters as the GitHub webhook secret.
 * @param body - the raw request body.
 * @param header - the presented `X-Hub-Signature-256` value.
 * @returns whether the signature matches, compared in constant time.
 */
export function verifiesGitHub(secret: string, body: Buffer, header: string | undefined): boolean {
  if (header?.startsWith('sha256=') !== true) return false
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(body).digest('hex')}`)
  const actual = Buffer.from(header)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

/** Read a string at a dotted path of a parsed GitHub payload. */
function field(payload: unknown, path: string): string | undefined {
  let value: unknown = payload
  for (const key of path.split('.')) {
    if (value === null || typeof value !== 'object') return undefined
    value = (value as Record<string, unknown>)[key]
  }
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : undefined
}

/**
 * Whether one delivery passes a trigger's filter.
 * @param filter - the trigger's filter.
 * @param event - the `X-GitHub-Event` name.
 * @param payload - the parsed body.
 * @returns whether every present filter field matches.
 */
export function matchesGitHub(filter: GitHubEventFilter, event: string, payload: unknown): boolean {
  if (filter.events !== undefined && filter.events.length > 0 && !filter.events.includes(event)) return false
  if (filter.actions !== undefined && filter.actions.length > 0 && !filter.actions.includes(field(payload, 'action') ?? '')) return false
  if (filter.repository !== undefined && field(payload, 'repository.full_name')?.toLowerCase() !== filter.repository.toLowerCase()) return false
  return true
}

/**
 * The lines a run reads about one delivery: its event, action, repository, sender, and the issue, pull request,
 * comment, or release it concerns.
 * @param event - the `X-GitHub-Event` name.
 * @param payload - the parsed body.
 * @param limit - most characters of the result.
 * @returns the summary, cut at `limit`.
 */
export function summarizeGitHub(event: string, payload: unknown, limit: number): string {
  const subject = ['pull_request', 'issue', 'discussion', 'release', 'check_run', 'workflow_run'].find(key => field(payload, `${key}.html_url`) !== undefined)
  const lines = [
    `GitHub event: ${event}${field(payload, 'action') === undefined ? '' : ` (${field(payload, 'action') ?? ''})`}`,
    ...[['Repository', 'repository.full_name'], ['Sender', 'sender.login'], ['Ref', 'ref']].flatMap(([label, path]) => {
      const value = field(payload, path ?? '')
      return value === undefined ? [] : [`${label ?? ''}: ${value}`]
    }),
    ...subject === undefined ? [] : [
      `${subject}: #${field(payload, `${subject}.number`) ?? '?'} ${field(payload, `${subject}.title`) ?? field(payload, `${subject}.name`) ?? ''}`.trim(),
      `URL: ${field(payload, `${subject}.html_url`) ?? ''}`,
    ],
    ...field(payload, 'comment.html_url') === undefined ? [] : [`Comment by ${field(payload, 'comment.user.login') ?? '?'}: ${field(payload, 'comment.html_url') ?? ''}`, field(payload, 'comment.body') ?? ''],
    ...subject === undefined || field(payload, 'comment.body') !== undefined ? [] : [field(payload, `${subject}.body`) ?? ''],
  ].filter(line => line !== '')
  const text = lines.join('\n')
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}
