/**
 * Which browser actions publish something other people see, and the approval
 * that gates them.
 *
 * Every browser tool surface (the sidebar `preview_*` tools and the Chrome
 * DevTools tools) classifies its actions here, so one per-site session grant
 * covers all of them. Typing, filling, reading, and navigating never ask; a
 * send-like action on a website does: a click on a control whose label is a
 * publishing verb, Enter pressed without Shift, typed text with a line break,
 * a click whose target is unknown, and a page script that may publish (see
 * {@link isSendScript}). Pages served from this machine never ask.
 *
 * @module @aeven/browser-chromium/send-gate
 */

/**
 * Whether a host is served from this machine.
 * @param hostname - the host as `URL.hostname` reports it, bracketed for IPv6.
 * @returns true for `localhost`, its subdomains, the IPv6 loopback, the wildcard address, and any loopback IPv4 address.
 */
export function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || host === '0.0.0.0' || /^127\.\d+\.\d+\.\d+$/.test(host)
}

/**
 * Where a page lives, for the send gate: on this machine or not a web page at
 * all (`local`), on a named website (`site`), or unknown because the caller
 * holds no address for the page.
 */
export type PageSite =
  | { readonly kind: 'local' }
  | { readonly kind: 'site'; readonly site: string }
  | { readonly kind: 'unknown' }

/**
 * Classify a page address.
 * @param url - the page address, or undefined when the caller does not know it.
 * @returns `local` for this machine and non-http(s) pages such as `about:blank`, `site` with the host minus a leading `www.`, or `unknown`.
 */
export function pageSite(url: string | undefined): PageSite {
  if (url === undefined) return { kind: 'unknown' }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    // A non-absolute address such as `about:blank` reaches no website.
    return { kind: 'local' }
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || isLocalHost(parsed.hostname)) return { kind: 'local' }
  return { kind: 'site', site: parsed.hostname.toLowerCase().replace(/^www\./, '') }
}

/** Publishing verbs in the languages Aeven's users browse in, matched as whole words. */
const SEND_WORDS = new RegExp(
  '(?<![\\p{L}\\p{N}])(?:'
  + [
    // English
    'send', 'post', 'publish', 'submit', 'create', 'reply', 'comment', 'share', 'tweet', 'repost', 'retweet', 'invite', 'connect',
    // Dutch
    'verzenden', 'versturen', 'verstuur', 'verzend', 'plaatsen', 'plaats', 'publiceren', 'publiceer', 'delen', 'deel', 'reageren', 'reageer', 'beantwoorden', 'aanmaken', 'indienen', 'uitnodigen', 'verbinden',
    // Spanish
    'enviar', 'publicar', 'responder', 'comentar', 'compartir', 'crear', 'invitar', 'conectar',
    // German
    'senden', 'absenden', 'veröffentlichen', 'posten', 'antworten', 'kommentieren', 'teilen', 'erstellen', 'einladen', 'vernetzen',
    // French
    'envoyer', 'publier', 'répondre', 'commenter', 'partager', 'créer', 'inviter', 'se connecter',
  ].join('|')
  + ')(?![\\p{L}\\p{N}])',
  'iu',
)

/** Publishing verbs in Chinese, which has no word boundaries to match on. */
const SEND_WORDS_CJK = /发送|發送|发布|發布|發佈|提交|回复|回覆|评论|評論|分享|创建|建立|邀请|邀請/

/**
 * Whether a control's accessible label names a publishing action.
 * @param label - the accessible name or visible text of the control.
 * @returns true when the label contains a publishing verb.
 */
export function isSendLabel(label: string): boolean {
  return SEND_WORDS.test(label) || SEND_WORDS_CJK.test(label)
}

/** Accessibility roles that commit an action when clicked; links navigate instead. */
const SEND_ROLES = new Set(['button', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'option'])

/**
 * Whether clicking a control with this role and label publishes something.
 * @param role - the control's accessibility role.
 * @param label - its accessible name.
 * @returns true for a button-like control whose label is a publishing verb.
 */
export function isSendControl(role: string, label: string): boolean {
  return SEND_ROLES.has(role.toLowerCase()) && isSendLabel(label)
}

/**
 * Whether a key chord submits what is being typed.
 * @param key - the key, alone (`Enter`) or as a `+`-joined chord (`Control+Enter`).
 * @param modifiers - modifiers held besides those named in `key`.
 * @returns true for Enter without Shift, which sends a chat message or submits a form; Shift+Enter inserts a line break.
 */
export function isSendKey(key: string, modifiers: readonly string[] = []): boolean {
  const parts = key.split('+').map(part => part.trim().toLowerCase())
  const main = parts.at(-1) ?? ''
  const held = new Set([...parts.slice(0, -1), ...modifiers.map(modifier => modifier.toLowerCase())])
  return (main === 'enter' || main === 'return' || main === 'numpadenter') && !held.has('shift')
}

/** Script calls that act on the page or a server rather than read it. */
const SCRIPT_ACTS = /\.click\s*\(|dispatchEvent\s*\(|\.submit\s*\(|requestSubmit\s*\(|execCommand\s*\(|sendBeacon\s*\(|new\s+XMLHttpRequest/

/** A request method that writes to the server. */
const SCRIPT_WRITES = /\bmethod\s*:\s*['"`](?:POST|PUT|PATCH|DELETE)['"`]/i

/**
 * Whether a page script may publish something: it sends a writing request, or it
 * clicks, dispatches events, or submits and its source names a publishing verb
 * (`[...buttons].find(b => /^send$/i.test(b.innerText)).click()`). A script that
 * only reads the page or fetches with GET does not.
 * @param source - the script's source text.
 * @returns true for a script that may publish.
 */
export function isSendScript(source: string): boolean {
  return SCRIPT_WRITES.test(source) || (SCRIPT_ACTS.test(source) && isSendLabel(source))
}

/** The approval a send-like browser action asks for. */
export interface SendApproval {
  /** What the person reads on the approval card. */
  readonly reason: string
  /** Per-site session grant scope; absent when the site is unknown, so only a one-shot approval is offered. */
  readonly allowSession?: string
  /** Present with `allowSession`: the grant covers every browser tool's sends on that site. */
  readonly allowSessionCoverage?: 'site'
}

/**
 * Build the approval for one send-like action.
 * @param site - the page's site; `unknown` offers only a one-shot approval.
 * @param action - what the action does, in the imperative, such as `Click "Send"`.
 * @returns the reason and the per-site grant offer.
 */
export function sendApproval(site: Exclude<PageSite, { kind: 'local' }>, action: string): SendApproval {
  if (site.kind === 'unknown') {
    return { reason: `${action} on a website. This may send or post something other people see.` }
  }
  return {
    reason: `${action} on ${site.site}. This may send or post something other people see.`,
    allowSession: `site:${site.site}`,
    allowSessionCoverage: 'site',
  }
}
