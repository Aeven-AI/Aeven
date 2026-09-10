/**
 * Untrusted assistant-Markdown rendered through the HyperMarkdown engine.
 *
 * The engine owns a mutable per-instance store fed by deltas through an
 * imperative handle, while this component's contract is a pure function of the
 * accumulated source text: React re-renders it freely, and a transcript may
 * mount it partway through a reply. The effect below reconciles the two by
 * tracking what the store has already been told and writing only the append,
 * reseeding when the text is not an extension of what it applied last.
 *
 * Finalize flushes the stream through `write(…, true)` and leaves the engine's
 * result mounted. HyperMarkdown publishes that final render through its own
 * external-store hook, so the word-fade spans finish without an adapter-owned
 * timer or a second parse replacing them.
 *
 * Untrusted-output policy: `html: 'literal'` keeps raw HTML out of the DOM
 * entirely — it is never parsed, so it reads as the characters written rather
 * than relying on a sanitizer schema having no gaps. Diagrams render through
 * Mermaid pinned to its strict security level, which is what makes it safe to
 * point a rendering engine at assistant-authored source.
 */

import { memo, useEffect, useMemo, useRef } from 'react'
import HyperMarkdown from '@aeven-ai/hypermarkdown'
import type {
  CodeComponentProps, HyperMarkdownHandle, RendererComponents, Translations,
} from '@aeven-ai/hypermarkdown'
import katexPlugin from '@aeven-ai/hypermarkdown/plugins/math'
import cjkPlugin from '@aeven-ai/hypermarkdown/plugins/cjk'
import highlightPlugin from '@aeven-ai/hypermarkdown/plugins/code'
import mermaidPlugin from '@aeven-ai/hypermarkdown/plugins/mermaid'
import type { StrictFunction } from 'katex'
import 'katex/dist/katex.min.css'
import '@aeven-ai/hypermarkdown/styles.css'
import css from './MarkdownText.module.css'

/**
 * Every localized string this renderer needs. Required, not optional: the
 * package cannot read the application locale, so a caller that omits copy
 * fails typechecking rather than falling back to a built-in language.
 */
export interface MarkdownLabels {
  /** Fence toolbar copy control. */
  code: MarkdownCodeLabels
  /** Heading of the footnote section. */
  footnotes: string
}

/** Copy-button labels forwarded to fence toolbars (this package is cordis-free, so copy arrives via props). */
export interface MarkdownCodeLabels {
  /** Copy-button idle label. */
  copyLabel: string
  /** Copy-button label during the post-copy confirmation window. */
  copiedLabel: string
}

/**
 * File-mention affordance for inline code: the owner resolves an authored
 * token to the file it names, using its own vocabulary of real files — the
 * renderer never guesses at what looks like a path.
 */
export interface MarkdownFileMentions {
  /**
   * Resolve one inline-code token.
   * @param value - The authored token, exactly as written.
   * @returns The opener with its accessible label and full-path title, or
   * undefined when the token names no known file — it then stays inert code.
   */
  resolve(value: string): { open: () => void; label: string; title: string } | undefined
}

/**
 * Engine plugins, built once at module scope: the renderer keys cached blocks
 * by component identity, so a per-render plugin object would remount them.
 * Math runs through KaTeX (the engine normalizes the `\(…\)` and `\[…\]`
 * notations models emit onto remark-math's `$` delimiters). Its strict callback
 * accepts the en dash that KaTeX can render while retaining every other
 * LaTeX-compatibility warning. Emphasis follows CJK flanking rules, and fences
 * are highlighted by highlight.js (the same engine `CodeBlock` and `ReadBlock`
 * use). Mermaid is imported on the first diagram rather than at module load,
 * so a session that never renders one does not pay for it. The plugin's
 * `load()` is what starts that fetch — this component does not set `preload`,
 * which would download the engine on every markdown mount.
 * `securityLevel` is passed explicitly rather than relying on the plugin's
 * default, because the source it renders is model-authored.
 */
const katexStrict: StrictFunction = (errorCode, _errorMessage, token) => {
  if (errorCode === 'unknownSymbol' && token.text === '–') return 'ignore'
  return 'warn'
}

const PLUGINS = {
  math: katexPlugin({ strict: katexStrict }),
  cjk: cjkPlugin(),
  code: highlightPlugin(),
  diagram: mermaidPlugin({ securityLevel: 'strict' }),
}

/**
 * Destination policy for untrusted output. The scheme allowlist is the part
 * that matters: `javascript:`, `data:` and every other scheme are refused for
 * both links and images. Relative destinations are allowed — they resolve
 * against this app's origin, which is a same-origin GET the renderer cannot
 * fully vouch for, but blocking them would also make it impossible to ever
 * show a relative asset, and this is a local single-user tool.
 */
const LINK_SAFETY = {
  allowedProtocols: ['http', 'https', 'mailto'],
  allowedLinkPrefixes: ['*'],
  // Remote `https:` images only. A file this app serves — a workspace path or a
  // plugin media route — is already on the page in the result card of whatever
  // tool produced it, so rendering model-authored markdown for it shows the
  // user the same picture twice. Excluding `http:` excludes this app's own
  // loopback origin, which is the only thing those duplicates point at.
  allowedImagePrefixes: ['https://'],
  allowDataImages: false,
}

/** What the store was last told, so an unchanged render writes nothing. */
interface AppliedState {
  /** The accumulated source already written to the store. */
  text: string
  /** Whether that text was written through the streaming path. */
  streaming: boolean
}

/**
 * The absolute HTTP(S) URL an inline-code token spells, if it spells one.
 * Anything else — a shell command, a relative path, a `javascript:` scheme —
 * stays inert code.
 * @param value - The authored token.
 * @returns The URL to link, or undefined.
 */
function inlineCodeUrl(value: string): string | undefined {
  // The token must be the URL and nothing else. `new URL()` ignores surrounding
  // whitespace, so ` https://example.com ` parses — but a token written with
  // padding is prose about a URL, and promoting it would link text the author
  // did not write as a link.
  if (value.trim() !== value) return undefined
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:' ? value : undefined
  } catch {
    // Relative and otherwise unparsable tokens are not links; new URL() has no
    // other failure mode for strings.
    return undefined
  }
}

/**
 * Build the inline-code component carrying this package's two affordances: a
 * token that spells an absolute HTTP(S) URL becomes a link, and a token the
 * owner recognizes as a real file becomes an opener. Fence bodies carry a
 * `language-*` class and are left alone.
 * @param mentions - The owner's resolver, when the turn supplies one.
 * @param streaming - Whether the reply is still arriving; mentions are withheld
 * until it settles, because a streaming message's vocabulary is not final and
 * a cached block must not bake in a handler that could go stale.
 * @returns A component map claiming inline `code`.
 */
function codeComponents(
  mentions: MarkdownFileMentions | undefined,
  streaming: boolean,
): RendererComponents {
  return {
    code: function InlineCode(props: CodeComponentProps) {
      // `inline` is the engine's answer from the element's ancestry. Reading a
      // `language-*` class instead would call a fence that named no language
      // inline code, and linkify a URL sitting in a plain fence.
      if (!props.inline) {
        return <code className={props.className}>{props.children}</code>
      }
      /* v8 ignore next 2 -- The engine builds inline code from one text node, so a
         non-string child never reaches this arm; the guard narrows the declared
         ReactNode for the URL read below. */
      if (typeof props.children !== 'string') return <code>{props.children}</code>
      const value = props.children
      // Inside a link the affordances are refused outright: an anchor may not
      // contain a button, and a second destination on the same text is a
      // choice the reader never asked to make.
      if (props.insideLink) return <code>{value}</code>
      const url = inlineCodeUrl(value)
      if (url !== undefined) {
        // The anchor sits inside the code element, as the mention opener does:
        // the token is still code, and only its destination is added.
        return (
          <code>
            <a href={url} target="_blank" rel="noopener noreferrer">
              {value}
            </a>
          </code>
        )
      }
      const target = streaming || mentions === undefined ? undefined : mentions.resolve(value)
      if (target === undefined) return <code>{value}</code>
      // The opener sits inside the code element rather than replacing it: the
      // token is still code, and a reader copying it should get the token.
      return (
        <code>
          <button
            type="button"
            className={css.mention}
            title={target.title}
            onClick={target.open}
          >
            {target.label}
          </button>
        </code>
      )
    },
  }
}

/**
 * Render untrusted assistant-authored Markdown as semantic React elements.
 * @param props - Markdown source text preserved by the session projection;
 * `streaming` feeds appends into the engine's streaming path and clearing it
 * finalizes that path through the engine's external-store update; `labels`
 * carries the localized copy this package cannot look up itself, and
 * `fileMentions` links inline-code tokens its resolver recognizes as real
 * files. Both must be reference-stable (memoized per locale revision or per
 * turn) — a new identity rebuilds the engine's component table and remounts
 * cached blocks. `labels.footnotes` is accepted but not yet applied: the engine
 * names that section itself, and overriding it needs a setting it does not
 * expose.
 * @returns A GFM document with TeX math rendered through KaTeX; raw HTML never
 * enters the DOM, link and image destinations are restricted to safe schemes,
 * and diagram fences stay code blocks.
 */
export const MarkdownText = memo(function MarkdownText({ text, streaming = false, labels, fileMentions }: {
  text: string
  streaming?: boolean
  labels: MarkdownLabels
  fileMentions?: MarkdownFileMentions | undefined
}) {
  const handleRef = useRef<HyperMarkdownHandle>(null)
  // A ref, not state: the write must survive StrictMode's double effect
  // invocation without scheduling a render of its own.
  const applied = useRef<AppliedState | null>(null)

  const translations = useMemo<Partial<Translations>>(() => {
    return {
      copy: labels.code.copyLabel,
      copyCode: labels.code.copyLabel,
      codeCopied: labels.code.copiedLabel,
    }
  }, [labels])

  const components = useMemo(
    () => codeComponents(fileMentions, streaming),
    [fileMentions, streaming],
  )

  // Writes belong in an effect, never in the render body: the store mutates in
  // place, so a render React discards would corrupt it.
  useEffect(() => {
    const handle = handleRef.current
    /* v8 ignore next -- the ref is attached by the child's commit, which
       always precedes this parent effect. */
    if (handle === null) return
    const last = applied.current
    if (!streaming) {
      if (last?.streaming) {
        if (text.startsWith(last.text)) {
          handle.write(text.slice(last.text.length), true)
        } else {
          // The terminal projection replaced the last streaming snapshot.
          // Rebuild and finalize it so its final words receive the same fade.
          handle.reset()
          handle.write(text, true)
        }
        applied.current = { text, streaming }
        return
      }
      if (last === null || last.text !== text) handle.store.setMarkdown(text)
      applied.current = { text, streaming }
      return
    }
    if (last !== null && last.streaming && text === last.text) return
    if (last === null || !last.streaming || !text.startsWith(last.text)) {
      // Mounted partway through a reply, or the source was rewritten rather
      // than appended to: drop the stream and reseed from the whole text.
      handle.reset()
      if (text !== '') handle.write(text)
    } else {
      handle.write(text.slice(last.text.length))
    }
    applied.current = { text, streaming }
  }, [text, streaming])

  return (
    <HyperMarkdown
      ref={handleRef}
      streaming
      animation
      html="literal"
      linkSafety={LINK_SAFETY}
      plugins={PLUGINS}
      translations={translations}
      components={components}
      className={css.markdown}
    />
  )
})
