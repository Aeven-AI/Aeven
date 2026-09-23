/**
 * Public surface of the Markdown engine: the streaming component, the plugin
 * factories a host attaches to it, and the types those two contracts mention.
 *
 * The component itself lives in {@link file://./HyperMarkdown.tsx}; this barrel
 * is the package entry every consumer and the build's single lib entry resolve.
 */
export { default, HyperMarkdown } from './HyperMarkdown.tsx'
export { pointerMovedRecently, watchPointerIntent } from './engine/pointer-intent.ts'
/** The engine's tippy.js tooltip, for hosts that want their controls' tips identical to its toolbars'. */
export { default as TippyTooltip } from './engine/tooltip.tsx'
export type { TooltipHandle as TippyTooltipHandle, TooltipProps as TippyTooltipProps } from './engine/tooltip.tsx'
export type {
  HyperMarkdownAlert,
  HyperMarkdownHandle,
  HyperMarkdownProps,
  HyperMarkdownStore,
} from './HyperMarkdown.tsx'

/** @deprecated Prefer the HyperMarkdown component and its imperative handle. */
export { default as MarkdownStream } from './engine/renderer.tsx'
/** @deprecated Internal engine options retained for API compatibility. */
export type { RendererOptions as MarkdownStreamOptions } from './engine/types.ts'
export type { AllowedTags, LinkSafetyConfig } from './engine/sanitize.ts'
export type {
  CodeComponentProps,
  HtmlMode,
  RendererComponents,
} from './engine/processors.ts'
export type {
  ControlsConfig,
  BlockControls,
  IconMap,
  PreviewConfig,
  Translations,
} from './engine/config.ts'
export type {
  PluginConfig,
  MathPlugin,
  CodeHighlighterPlugin,
  DiagramPlugin,
  DiagramEngine,
  DiagramResult,
} from './engine/plugin-types.ts'

/**
 * Normalise the notations models emit for maths onto the "$"/"$$" remark-math
 * understands. Exported for hosts that run their own pipeline over the same
 * model output and want it to agree with what this component renders.
 */
export { convertMath } from './engine/math-notation.ts'

/**
 * The engine plugins, re-exported from the package root. Each one is its own
 * module so a consumer attaches only the slots it wants; Mermaid and the fence
 * highlighting engine still resolve their heavy libraries lazily, so importing
 * a factory never loads one.
 */
export { katexPlugin } from './engine/plugins/math.ts'
export { highlightPlugin } from './engine/plugins/code.ts'
export { mermaidPlugin } from './engine/plugins/mermaid.ts'
export { cjkPlugin } from './engine/plugins/cjk.ts'
