/**
 * Credential redaction for learned procedures. A procedure is distilled from tool output and recalled into later
 * prompts of its owner, so a token a tool printed would otherwise be stored and replayed. Matching favours
 * precision over recall: known credential formats, private-key blocks, URL user info, `Bearer`/`Basic` values, and
 * values assigned to credential-named keys that mix letters and digits or are long. Placeholders such as `$TOKEN`,
 * `${API_KEY}`, and `<api-key>`, and paths such as `~/.config/token`, are kept.
 */

/** What every matched value is replaced with. */
const REDACTED = '[redacted]'

/** PEM private-key blocks of any algorithm. */
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g

/**
 * Credentials recognizable by format alone: OpenAI/Anthropic/DeepSeek-style `sk-`, xAI, GitHub, GitLab, npm,
 * Slack, AWS access key ids, Google API keys, and JSON Web Tokens.
 */
const KNOWN_FORMATS = new RegExp([
  String.raw`\bsk-[A-Za-z0-9_-]{20,}`,
  String.raw`\bxai-[A-Za-z0-9]{20,}`,
  String.raw`\bgh[pousr]_[A-Za-z0-9]{36,}`,
  String.raw`\bgithub_pat_[A-Za-z0-9_]{40,}`,
  String.raw`\bglpat-[A-Za-z0-9_-]{20,}`,
  String.raw`\bnpm_[A-Za-z0-9]{36,}`,
  String.raw`\bxox[abposr]-[A-Za-z0-9-]{10,}`,
  String.raw`\b(?:AKIA|ASIA)[0-9A-Z]{16}\b`,
  String.raw`\bAIza[0-9A-Za-z_-]{35}`,
  String.raw`\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}`,
].join('|'), 'g')

/** An HTTP authorization value after its scheme. */
const AUTHORIZATION = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]{16,}=*/g

/** User info of a URL such as `https://user:password@host`. */
const URL_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi

/** Characters a key name is made of, in lower case because the pattern below is case-insensitive. */
const KEY_CHARS = String.raw`[a-z0-9_.-]`

/** Key names that announce a credential. */
const CREDENTIAL_KEY = String.raw`api[_-]?key|access[_-]?key|private[_-]?key|token|secret|password|passwd|credential`

/** A value assigned with `=` or `:` to a key whose name says it holds a credential. */
const ASSIGNED = new RegExp(
  String.raw`\b(` + KEY_CHARS + String.raw`*(?:` + CREDENTIAL_KEY + String.raw`)` + KEY_CHARS + String.raw`*)`
  + String.raw`(["']?\s*[:=]\s*["']?)([^\s"'\x60,;)}\]]{8,})`,
  'gi',
)

/**
 * Values that name a credential instead of holding one: shell, template, and angle-bracket placeholders, an
 * already redacted value, and file paths.
 */
const PLACEHOLDER = /^(?:\$|<|\{|\[|%|\/|~|\.)/

/**
 * Replace credentials in procedure text with `[redacted]`.
 * @param text - procedure content, summary, description, request, or supporting file.
 * @returns the text with every recognized credential replaced; text without one is returned unchanged.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(PRIVATE_KEY, REDACTED)
    .replace(KNOWN_FORMATS, REDACTED)
    .replace(AUTHORIZATION, `$1 ${REDACTED}`)
    .replace(URL_USERINFO, `$1${REDACTED}@`)
    .replace(ASSIGNED, (match: string, key: string, separator: string, value: string) =>
      PLACEHOLDER.test(value) || !credentialShaped(value) ? match : `${key}${separator}${REDACTED}`)
}

/**
 * Whether an assigned value looks like a credential rather than a setting or a word: it mixes letters and digits,
 * or is at least 24 characters long.
 * @param value - the assigned value.
 * @returns true when the value should be redacted.
 */
function credentialShaped(value: string): boolean {
  return value.length >= 24 || (/[A-Za-z]/.test(value) && /\d/.test(value))
}
