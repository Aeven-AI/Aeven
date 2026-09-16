/**
 * Shared syntax highlighter for tool cards (`CodeBlock`, `ReadBlock`).
 * Markdown fences go through HyperMarkdown's highlight.js plugin; this module
 * uses the same engine so the client ships one highlighter.
 *
 * Four languages register at boot (javascript, typescript, bash, json). The
 * read card's wider set loads on first use. An unknown language renders plain
 * text. A lazy language that has not registered yet also renders plain, then
 * {@link subscribeGrammarLoaded} re-highlights once the language arrives.
 *
 * @module @aeven/client-ui-primitives/src/markdown/highlight
 */

import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import typescript from 'highlight.js/lib/languages/typescript'
import type { LanguageFn } from 'highlight.js'

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('json', json)

type LangModule = { default: LanguageFn }

/**
 * Read-card languages behind a dynamic import. Boot languages are absent —
 * already registered, so no alias resolves to a missing loader.
 */
const LAZY_LANGUAGES = new Map<string, () => Promise<LangModule>>([
  ['python', () => import('highlight.js/lib/languages/python')],
  ['ruby', () => import('highlight.js/lib/languages/ruby')],
  ['go', () => import('highlight.js/lib/languages/go')],
  ['rust', () => import('highlight.js/lib/languages/rust')],
  ['java', () => import('highlight.js/lib/languages/java')],
  ['c', () => import('highlight.js/lib/languages/c')],
  ['cpp', () => import('highlight.js/lib/languages/cpp')],
  ['csharp', () => import('highlight.js/lib/languages/csharp')],
  ['kotlin', () => import('highlight.js/lib/languages/kotlin')],
  ['swift', () => import('highlight.js/lib/languages/swift')],
  ['php', () => import('highlight.js/lib/languages/php')],
  ['yaml', () => import('highlight.js/lib/languages/yaml')],
  ['ini', () => import('highlight.js/lib/languages/ini')],
  ['markdown', () => import('highlight.js/lib/languages/markdown')],
  ['xml', () => import('highlight.js/lib/languages/xml')],
  ['css', () => import('highlight.js/lib/languages/css')],
  ['scss', () => import('highlight.js/lib/languages/scss')],
  ['less', () => import('highlight.js/lib/languages/less')],
  ['sql', () => import('highlight.js/lib/languages/sql')],
  ['lua', () => import('highlight.js/lib/languages/lua')],
])

/**
 * Fence info strings and read-tool extension hints → highlight.js language
 * ids. A Map so an inherited Object.prototype key cannot resolve.
 */
const LANG_ALIASES = new Map<string, string>([
  ['typescript', 'typescript'],
  ['ts', 'typescript'],
  ['tsx', 'typescript'],
  ['javascript', 'javascript'],
  ['js', 'javascript'],
  ['jsx', 'javascript'],
  ['bash', 'bash'],
  ['sh', 'bash'],
  ['shell', 'bash'],
  ['zsh', 'bash'],
  ['shellscript', 'bash'],
  ['json', 'json'],
  ['jsonc', 'json'],
  ['py', 'python'],
  ['python', 'python'],
  ['rb', 'ruby'],
  ['ruby', 'ruby'],
  ['go', 'go'],
  ['rs', 'rust'],
  ['rust', 'rust'],
  ['java', 'java'],
  ['c', 'c'],
  ['cpp', 'cpp'],
  ['cs', 'csharp'],
  ['csharp', 'csharp'],
  ['kotlin', 'kotlin'],
  ['swift', 'swift'],
  ['php', 'php'],
  ['yaml', 'yaml'],
  ['yml', 'yaml'],
  ['toml', 'ini'],
  ['ini', 'ini'],
  ['md', 'markdown'],
  ['markdown', 'markdown'],
  ['mdx', 'markdown'],
  ['html', 'xml'],
  ['css', 'css'],
  ['scss', 'scss'],
  ['less', 'less'],
  ['sql', 'sql'],
  ['xml', 'xml'],
  ['lua', 'lua'],
])

/**
 * Whether a language hint can use the shared syntax highlighter.
 * @param lang - Language hint from a code surface.
 * @returns Whether the hint resolves to a supported language.
 */
export function supportsHighlighting(lang: string | undefined): boolean {
  return lang !== undefined && LANG_ALIASES.has(lang.toLowerCase())
}

const requested = new Set<string>()
const listeners = new Set<() => void>()
let loadCount = 0

/**
 * Subscribe to lazy-language load completions.
 * @param listener - invoked (no args) on each language-load completion.
 * @returns a disposer that removes the listener.
 */
export function subscribeGrammarLoaded(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * Opaque load counter for `useSyncExternalStore`.
 * @returns the current load count.
 */
export function grammarLoadCount(): number {
  return loadCount
}

/**
 * Ensure `resolved` is registered. Boot languages are always ready; a lazy
 * language starts its import once and reports not-ready until it registers.
 * @param resolved - highlight.js language id.
 * @returns whether highlighting can run now.
 */
function ensureLanguage(resolved: string): boolean {
  const load = LAZY_LANGUAGES.get(resolved)
  if (load === undefined) return true
  if (hljs.getLanguage(resolved) !== undefined) return true
  if (!requested.has(resolved)) {
    requested.add(resolved)
    void load().then((mod) => {
      hljs.registerLanguage(resolved, mod.default)
      loadCount += 1
      for (const listener of listeners) listener()
    })
  }
  return false
}

function decodeEntities(text: string): string {
  return text
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&#x27;', "'")
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/**
 * One highlighted run of a line. Color comes from the `hljs-*` class, styled
 * by the theme sheet — not inline `--shiki-*` properties.
 */
export interface HighlightSpan {
  text: string
  className?: string
}

function pushText(lines: HighlightSpan[][], text: string, className?: string): void {
  const parts = text.split('\n')
  for (const [index, part] of parts.entries()) {
    if (part !== '') {
      const line = lines[lines.length - 1]
      /* v8 ignore next -- split always leaves at least one bucket. */
      if (line === undefined) return
      line.push(className === undefined ? { text: part } : { text: part, className })
    }
    if (index < parts.length - 1) lines.push([])
  }
}

/** Walk highlight.js HTML into per-line runs. Spans are flat, not nested. */
function htmlToLineSpans(html: string): HighlightSpan[][] {
  const lines: HighlightSpan[][] = [[]]
  const token = /<span class="([^"]*)">|<\/span>|([^<]+)/g
  const stack: string[] = []
  for (const match of html.matchAll(token)) {
    const open = match[1]
    const text = match[2]
    if (open !== undefined) {
      stack.push(open)
      continue
    }
    if (text !== undefined) pushText(lines, decodeEntities(text), stack[stack.length - 1])
    else stack.pop()
  }
  return lines
}

function highlightHtml(code: string, resolved: string): string {
  const normalized = code.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
  return hljs.highlight(normalized, { language: resolved, ignoreIllegals: true }).value
}

function spansToLineHtml(line: readonly HighlightSpan[]): string {
  const inner = line.map((span) => {
    const text = escapeHtml(span.text)
    return span.className === undefined ? text : `<span class="${escapeHtml(span.className)}">${text}</span>`
  }).join('')
  return `<span class="line">${inner}</span>`
}

/**
 * Highlight `code` into an `hljs` HTML tree when `lang` is supported. Each
 * source line is a `.line` span so the settled swap matches the streaming
 * token tree (`tabindex="0"` included).
 * @param code - the source text.
 * @param lang - language hint.
 * @returns highlighted HTML, or `undefined` for unknown or not-yet-loaded languages.
 */
export function highlightToHtml(code: string, lang: string | undefined): string | undefined {
  const resolved = lang === undefined ? undefined : LANG_ALIASES.get(lang.toLowerCase())
  if (resolved === undefined) return undefined
  if (!ensureLanguage(resolved)) return undefined
  const lines = dropTerminator(lineSpansFor(code, resolved), code)
  return `<pre class="hljs" tabindex="0"><code class="hljs language-${resolved}">${lines.map(spansToLineHtml).join('\n')}</code></pre>`
}

function lineSpansFor(code: string, resolved: string): HighlightSpan[][] {
  return htmlToLineSpans(highlightHtml(code, resolved))
}

function dropTerminator(lines: HighlightSpan[][], code: string): HighlightSpan[][] {
  const normalized = code.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
  if (!normalized.endsWith('\n') || lines.length <= 1) return lines
  const last = lines[lines.length - 1]
  /* v8 ignore next -- htmlToLineSpans always ends on an empty bucket after a trailing newline. */
  if (last === undefined || last.length !== 0) return lines
  return lines.slice(0, -1)
}

function spansEqual(left: HighlightSpan[], right: HighlightSpan[]): boolean {
  /* v8 ignore next -- a later chunk can re-tokenize a completed line into a different run count. */
  if (left.length !== right.length) return false
  return left.every((span, index) => {
    const other = right[index]
    return other !== undefined && span.text === other.text && span.className === other.className
  })
}

/**
 * Tokenize `code` into per-line runs for a line-numbered view.
 * @param code - the source text.
 * @param lang - language hint.
 * @returns one entry per source line, or `undefined` for unknown or not-yet-loaded languages.
 */
export function highlightLines(code: string, lang: string | undefined): HighlightSpan[][] | undefined {
  const resolved = lang === undefined ? undefined : LANG_ALIASES.get(lang.toLowerCase())
  if (resolved === undefined) return undefined
  if (!ensureLanguage(resolved)) return undefined
  return dropTerminator(lineSpansFor(code, resolved), code)
}

/**
 * Incremental highlighter for one growing streaming fence. highlight.js has
 * no grammar state, so each update re-highlights the accumulated text; completed
 * lines keep their span-array identity when the new highlight matches.
 */
export class StreamingHighlightSession {
  private resolved: string | undefined
  private prefix = ''
  private spans: HighlightSpan[][] = []
  private lastCode: string | undefined
  private lastLang: string | undefined
  private lastResult: HighlightSpan[][] | undefined
  private generation = 0
  private lastFrame: StreamingHighlightFrame | undefined

  private reset(resolved: string | undefined): void {
    this.resolved = resolved
    this.prefix = ''
    this.spans = []
    this.generation += 1
    this.lastFrame = undefined
  }

  /**
   * Tokenize one update as a delta for a retained renderer.
   * @param code - the fence text accumulated so far.
   * @param lang - the language hint.
   * @returns Newly completed lines plus the current tail, or `undefined` for the plain arm.
   */
  updateFrame(code: string, lang: string | undefined): StreamingHighlightFrame | undefined {
    if (code === this.lastCode && lang === this.lastLang && this.lastFrame !== undefined) {
      return this.lastFrame
    }
    this.lastCode = code
    this.lastLang = lang
    this.lastResult = undefined
    const resolved = lang === undefined ? undefined : LANG_ALIASES.get(lang.toLowerCase())
    if (resolved === undefined || !ensureLanguage(resolved)) {
      this.reset(undefined)
      return undefined
    }
    if (resolved !== this.resolved || !code.startsWith(this.prefix)) this.reset(resolved)
    const firstNewLine = this.spans.length
    const all = lineSpansFor(code, resolved)
    const grown = code.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
    const lastNewline = grown.lastIndexOf('\n')
    // The last parsed bucket is the still-growing tail, or the empty
    // terminator htmlToLineSpans adds after a trailing newline. Neither is
    // a newly completed content line.
    const completeUntil = lastNewline < 0 ? 0 : all.length - 1
    const completed = all.slice(0, completeUntil).map((line, index) => {
      const previous = this.spans[index]
      return previous !== undefined && spansEqual(previous, line) ? previous : line
    })
    this.spans = completed
    this.prefix = lastNewline < 0 ? '' : grown.slice(0, lastNewline + 1)
    this.lastFrame = {
      generation: this.generation,
      appended: completed.slice(firstNewLine),
      tail: all.slice(completeUntil),
    }
    return this.lastFrame
  }

  /**
   * Tokenize the fence's current text into per-line highlighted runs.
   * @param code - the fence text accumulated so far.
   * @param lang - the language hint.
   * @returns one entry per line of `code`, or `undefined` for unknown or not-yet-loaded languages.
   */
  update(code: string, lang: string | undefined): readonly HighlightSpan[][] | undefined {
    if (code === this.lastCode && lang === this.lastLang && this.lastResult !== undefined) {
      return this.lastResult
    }
    const frame = this.updateFrame(code, lang)
    if (frame === undefined) return undefined
    this.lastResult = [...this.spans, ...frame.tail]
    return this.lastResult
  }
}

/** One retained-renderer update from {@link StreamingHighlightSession.updateFrame}. */
export interface StreamingHighlightFrame {
  /** Changes whenever prior completed lines must be discarded. */
  readonly generation: number
  /** Completed lines added since the preceding frame in this generation. */
  readonly appended: readonly HighlightSpan[][]
  /** The still-growing final line or lines, replaced by the next frame. */
  readonly tail: readonly HighlightSpan[][]
}
