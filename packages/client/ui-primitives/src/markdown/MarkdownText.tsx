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

import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import HyperMarkdown, {
  cjkPlugin, highlightPlugin, katexPlugin, mermaidPlugin,
} from '@aeven/client-hypermarkdown'
import type {
  CodeComponentProps, ControlsConfig, HyperMarkdownHandle, RendererComponents, Translations,
} from '@aeven/client-hypermarkdown'
import type { StrictFunction } from 'katex'
import 'katex/dist/katex.min.css'
import { useTextAnimation } from './animation.ts'
import { ImageLightbox, type ImageLightboxLabels } from '../ImageLightbox.tsx'
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
  /** Reasoning block chrome, for a caller that renders reasoning at all. */
  reasoning?: MarkdownReasoningLabels | undefined
  /** Enlarged-image dialog copy; images open enlarged on click when present. */
  image?: ImageLightboxLabels | undefined
}

/**
 * Copy for a reasoning block, whose header the engine swaps between the two
 * states: what it says while the model is still thinking, and what it says once
 * the block has settled, with `{seconds}` replaced by the time it took.
 */
export interface MarkdownReasoningLabels {
  /** Header while the reasoning is still arriving. */
  thinking: string
  /** Header once it has finished, containing `{seconds}`. */
  thoughtFor: string
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
  // Remote `https:` images, and absolute local paths, which `resolveImage`
  // turns into this app's authenticated file route. Plain `http:` stays out:
  // it is only ever this app's own origin.
  allowedImagePrefixes: ['https://', '/'],
  allowDataImages: false,
}

/**
 * The URL an authored image loads from: a remote `https:` source as written,
 * and an absolute local path through this app's authenticated `/api/file`
 * route. Anything else shows the image's alt text.
 * @param src - the image source as the markdown author wrote it.
 * @returns the URL to load, or undefined when the source is not displayable.
 */
function resolveImage(src: string): string | undefined {
  if (src.startsWith('https://')) return src
  if (!src.startsWith('/') || src.startsWith('//')) return undefined
  const base = document.baseURI
  if (!base.startsWith('http:') && !base.startsWith('https:')) return undefined
  return new URL(`api/file?path=${encodeURIComponent(safeDecode(src))}`, base).href
}

/** Markdown percent-encodes spaces and non-ASCII in a destination; the file route wants the path. */
function safeDecode(value: string): string {
  try {
    return decodeURI(value)
  } catch {
    // A lone `%` that is not an escape: the authored path is already literal.
    return value
  }
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
            className={css.fileMention}
            title={target.title}
            aria-label={target.label}
            onClick={target.open}
          >
            {value}
          </button>
        </code>
      )
    },
  }
}

/** What every caller supplies, whichever way it hands the source over. */
interface MarkdownTextCommonProps {
  /** Whether the reply is still arriving; feeds the engine's streaming path. */
  streaming?: boolean
  labels: MarkdownLabels
  /** Toolbar controls for rendered blocks; omitted entries retain the engine defaults. */
  controls?: ControlsConfig | undefined
  fileMentions?: MarkdownFileMentions | undefined
  /** Whether an authored image may render beside separately displayed artifacts. */
  imageVisible?: ((src: string) => boolean) | undefined
  /** Keep an enclosing transcript on its live tail after an engine render. */
  scrollDown?: (() => void) | undefined
  /**
   * A block inside this markdown entered or left full screen. The block covers
   * the viewport on its own, but only the host knows the rest of its chrome,
   * which has to yield its stacking order for as long as the block is up.
   */
  onFullscreenChange?: ((fullscreen: boolean) => void) | undefined
  /** Fade newly streamed words in; defaults to the enclosing {@link useTextAnimation} preference. */
  animation?: boolean | undefined
  /** `compact` sets secondary typography for reasoning bodies and other flow-row details. */
  variant?: 'default' | 'compact' | undefined
}

/**
 * The source this component renders: one accumulated markdown string.
 *
 * Reasoning travels inside it as the engine's own `<think>` block, which is the
 * protocol the engine already implements for a model that emits its thinking
 * inline. A caller that holds reasoning separately wraps it — see
 * {@link reasoningSource} — so this component stays a pure function of text.
 */
export type MarkdownTextProps = MarkdownTextCommonProps & { text: string }

/**
 * The engine's reasoning block, wrapped around one block of thinking.
 *
 * The engine recognises a model's thinking by these tags, so a caller holding
 * reasoning separately from the answer says so by wrapping it here rather than
 * asking the engine for a second way to be told the same thing. The tags are
 * the engine's protocol, not the model's: an assistant that emitted them itself
 * is already rendered this way, and the settled and streaming paths both read
 * them.
 *
 * A body that happens to contain the closing tag would end the block early, so
 * the body is defused first — see {@link defuseClosingTag}. What is left is
 * the one input the engine cannot be handed safely, and it is handled here
 * rather than left for a reader to hit.
 *
 * A block that has not finished is left open, with no closing tag: an open
 * block is what the engine draws as still thinking, and it is closed when the
 * reply settles rather than when the reasoning stops arriving — a step's
 * thinking is over when its answer is.
 * @param text - The reasoning body, as markdown.
 * @param open - Whether the block is still being written.
 * @returns The source to append to a reply's accumulated markdown.
 */
export function reasoningSource(text: string, open: boolean): string {
  const body = defuseClosingTag(text)

  return open ? `<think>${body}` : `<think>${body}</think>\n\n`
}

/**
 * Keep a reasoning body from closing its own block.
 *
 * A reply's reasoning is markdown and cannot escape the delimiter: there is no
 * backslash that turns `</think>` back into the characters it spells, because
 * the engine matches the tag after parsing. So the one `<` that could end the
 * block is swapped for its full-width twin, which is the same glyph to a reader
 * and not a tag to the parser. A body without the token comes back untouched.
 * @param text - The reasoning body, as markdown.
 * @returns The body with any literal closing tag made inert.
 */
export function defuseClosingTag(text: string): string {
  return text.replaceAll('</think', '＜/think')
}

/**
 * Render untrusted assistant-authored Markdown as semantic React elements.
 * @param props - `text` carrying the accumulated source preserved by the
 * session projection; `streaming` feeds appends into the engine's streaming
 * path and clearing it finalizes that path through the engine's external-store
 * update; `labels` carries the localized copy this package cannot look up
 * itself, including the reasoning block's two headers when the source contains
 * reasoning, and `fileMentions` links inline-code tokens its resolver
 * recognizes as real files. `labels` must be reference-stable (memoized per
 * locale revision) — a new identity rebuilds the engine's component table and
 * remounts cached blocks. `labels.footnotes` is accepted but not yet applied:
 * the engine names that section itself, and overriding it needs a setting it
 * does not expose.
 * @returns A GFM document with TeX math rendered through KaTeX; raw HTML never
 * enters the DOM, link and image destinations are restricted to safe schemes,
 * and diagram fences stay code blocks.
 */
export const MarkdownText = memo(function MarkdownText({
  text, streaming = false, labels, controls, fileMentions, scrollDown, onFullscreenChange, variant = 'default',
  animation: animationProp, imageVisible,
}: MarkdownTextProps) {
  const imageVisibility = useRef(imageVisible)
  imageVisibility.current = imageVisible
  const imageSource = useCallback((src: string) => imageVisibility.current?.(src) === false ? undefined : resolveImage(src), [])
  const preferredAnimation = useTextAnimation()
  const animation = animationProp ?? preferredAnimation
  const handleRef = useRef<HyperMarkdownHandle>(null)
  // A ref, not state: the write must survive StrictMode's double effect
  // invocation without scheduling a render of its own.
  const applied = useRef<AppliedState | null>(null)

  const translations = useMemo<Partial<Translations>>(() => {
    const reasoning = labels.reasoning

    return {
      copy: labels.code.copyLabel,
      copyCode: labels.code.copyLabel,
      codeCopied: labels.code.copiedLabel,
      ...reasoning === undefined
        ? {}
        : { thinking: reasoning.thinking, thoughtFor: reasoning.thoughtFor },
    }
  }, [labels])

  const components = useMemo(
    () => codeComponents(fileMentions, streaming),
    [fileMentions, streaming],
  )

  // A clicked image opens enlarged in the same dialog tool-result images use.
  const [enlarged, setEnlarged] = useState<{ src: string; alt: string } | null>(null)
  const openImage = useCallback((image: { src: string; alt: string }) => { setEnlarged(image) }, [])
  const closeImage = useCallback(() => { setEnlarged(null) }, [])

  // Writes belong in an effect, never in the render body: the store mutates in
  // place, so a render React discards would corrupt it.
  // Layout effect: settled text lands before the first paint, so the row never
  // paints empty and then grows.
  useLayoutEffect(() => {
    const handle = handleRef.current
    /* v8 ignore next -- the ref is attached by the child's commit, which
       always precedes this parent effect. */
    if (handle === null) return
    const last = applied.current
    // A block mounted settled was built by the engine constructor from `md`.
    if (last === null && !streaming) {
      applied.current = { text, streaming }
      return
    }
    if (!streaming) {
      if (last?.streaming) {
        if (text.startsWith(last.text)) {
          handle.write(text.slice(last.text.length), true)
        } else {
          // The terminal projection replaced the last streaming snapshot.
          // Rebuild and finalize it without the fade: the reader already saw
          // these words, and fading them again would flash the whole reply.
          handle.store.replaceStream(text, true)
        }
        applied.current = { text, streaming }
        return
      }
      if (last !== null && last.text === text) {
        // The same source, already settled: there is nothing left to tell the
        // engine. The ended-streaming case is the `last.streaming` branch
        // above, which is the only one that still owes it a finalizing write.
        applied.current = { text, streaming }
        return
      }
      handle.store.setMarkdown(text)
      applied.current = { text, streaming }
      return
    }
    if (last !== null && last.streaming && text === last.text) return
    if (last === null || !last.streaming || !text.startsWith(last.text)) {
      // Mounted partway through a reply, or the source was rewritten rather
      // than appended to: drop the stream and reseed from the whole text.
      // The seed is text the reader already saw (or is opening onto), so it
      // lands without the fade; the engine keeps the block it leaves open
      // quiet too, and only words in later blocks fade in.
      handle.store.replaceStream(text, false)
    } else {
      handle.write(text.slice(last.text.length))
    }
    applied.current = { text, streaming }
  }, [text, streaming])

  return (
    <>
      <HyperMarkdown
        ref={handleRef}
        md={applied.current === null && !streaming ? text : undefined}
        streaming
        animation={animation}
        html="literal"
        linkSafety={LINK_SAFETY}
        plugins={PLUGINS}
        translations={translations}
        components={components}
        controls={controls}
        className={variant === 'compact' ? `${css.markdown} ${css.compact}` : css.markdown}
        {...scrollDown === undefined ? {} : { scrollDown }}
        {...onFullscreenChange === undefined ? {} : { onFullscreenChange }}
        resolveImage={imageSource}
        {...labels.image === undefined ? {} : { onImageOpen: openImage }}
      />
      {enlarged !== null && labels.image !== undefined && (
        <ImageLightbox images={[enlarged]} index={0} labels={labels.image} onClose={closeImage} />
      )}
    </>
  )
})
