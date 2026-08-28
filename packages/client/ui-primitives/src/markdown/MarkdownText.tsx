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
 * The finalize swap goes through `setMarkdown`, not a `write(…, true)`
 * finalize, because streamed output is chunk-dependent for fences and tables
 * (the per-line and per-row caches are what make streaming cheap) while
 * `setMarkdown` runs the one-shot settled parse. Routing the swap through it
 * makes the settled DOM identical however the reply was chunked.
 *
 * Untrusted-output policy: `html: 'literal'` keeps raw HTML out of the DOM
 * entirely — it is never parsed, so it reads as the characters written rather
 * than relying on a sanitizer schema having no gaps. Diagrams render through
 * Mermaid pinned to its strict security level, which is what makes it safe to
 * point a rendering engine at assistant-authored source.
 */

import { memo, useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import HyperMarkdown from '@aeven-ai/hypermarkdown'
import type { HyperMarkdownHandle, RendererComponents, Translations } from '@aeven-ai/hypermarkdown'
import katexPlugin from '@aeven-ai/hypermarkdown/plugins/math'
import cjkPlugin from '@aeven-ai/hypermarkdown/plugins/cjk'
import highlightPlugin from '@aeven-ai/hypermarkdown/plugins/code'
import mermaidPlugin from '@aeven-ai/hypermarkdown/plugins/mermaid'
import 'katex/dist/katex.min.css'
import '@aeven-ai/hypermarkdown/styles.css'
import css from './MarkdownText.module.css'

/** Copy-button labels forwarded to fence toolbars (this package is cordis-free, so copy arrives via props). */
export interface MarkdownCodeLabels {
  /** Copy-button idle label. */
  copyLabel?: string | undefined
  /** Copy-button label during the post-copy confirmation window. */
  copiedLabel?: string | undefined
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
 * notations models emit onto remark-math's `$` delimiters), emphasis follows
 * CJK flanking rules, and fences are highlighted by highlight.js. Mermaid is
 * imported on the first diagram rather than at module load, so a session that
 * never renders one does not pay for it. `preload` on the component then
 * starts that fetch on mount instead of waiting for the first diagram, so a
 * diagram that arrives mid-reply does not stall on a cold download — the
 * engine stays a separate chunk either way, off the initial load.
 * `securityLevel` is passed explicitly rather than relying on the plugin's
 * default, because the source it renders is model-authored.
 */
const PLUGINS = {
  math: katexPlugin(),
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
  allowedImagePrefixes: ['*'],
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
    code: function InlineCode(props: { children?: ReactNode; className?: string }) {
      const value = typeof props.children === 'string' ? props.children : undefined
      if (value === undefined || props.className !== undefined) {
        return <code className={props.className}>{props.children}</code>
      }
      const url = inlineCodeUrl(value)
      if (url !== undefined) {
        return (
          <a href={url} target="_blank" rel="noreferrer noopener">
            <code>{value}</code>
          </a>
        )
      }
      const target = streaming || mentions === undefined ? undefined : mentions.resolve(value)
      if (target === undefined) return <code>{value}</code>
      return (
        <button
          type="button"
          className={css.mention}
          title={target.title}
          onClick={target.open}
        >
          {target.label}
        </button>
      )
    },
  }
}

/**
 * Render untrusted assistant-authored Markdown as semantic React elements.
 * @param props - Markdown source text preserved by the session projection;
 * `streaming` feeds appends into the engine's streaming path and clearing it
 * swaps to the settled parse; `codeLabels` forwards localized copy-button
 * labels to fence toolbars, and `fileMentions` links inline-code tokens its
 * resolver recognizes as real files. Both must be reference-stable (memoized
 * per locale revision or per turn) — a new identity rebuilds the engine's
 * component table and remounts cached blocks.
 * @returns A GFM document with TeX math rendered through KaTeX; raw HTML never
 * enters the DOM, link and image destinations are restricted to safe schemes,
 * and diagram fences stay code blocks.
 */
export const MarkdownText = memo(function MarkdownText({ text, streaming = false, codeLabels, fileMentions }: {
  text: string
  streaming?: boolean
  codeLabels?: MarkdownCodeLabels | undefined
  fileMentions?: MarkdownFileMentions | undefined
}) {
  const handleRef = useRef<HyperMarkdownHandle>(null)
  // A ref, not state: the write must survive StrictMode's double effect
  // invocation without scheduling a render of its own.
  const applied = useRef<AppliedState | null>(null)

  const translations = useMemo<Partial<Translations>>(() => {
    const labels: Partial<Translations> = {}
    if (codeLabels?.copyLabel !== undefined) {
      labels.copy = codeLabels.copyLabel
      labels.copyCode = codeLabels.copyLabel
    }
    if (codeLabels?.copiedLabel !== undefined) labels.codeCopied = codeLabels.copiedLabel
    return labels
  }, [codeLabels])

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
      if (last === null || last.text !== text || last.streaming) handle.store.setMarkdown(text)
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
      html="literal"
      preload
      linkSafety={LINK_SAFETY}
      plugins={PLUGINS}
      translations={translations}
      components={components}
      className={css.markdown}
    />
  )
})
