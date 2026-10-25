/**
 * The Web GUI's model-visible surface context: the `app:web-surface` prompt section (how replies render, including
 * how to show the user an image), the `app:web-url` runtime context, the `AVN_WEB_URL` bash variable, and, for a
 * developer deployment, the `harness:source` section. Every composition whose user reads replies in this GUI mounts
 * it: the `web-app` row mounts it for `avn web`, and the desktop shell, which disables that row, mounts it directly.
 * @module @aeven/web-app/surface
 */

import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { addHarnessSourceSection } from '@aeven/app-boot'
import type {} from '@aeven/host-webserver'
import type {} from '@aeven/shell-env'

/** Stable Cordis plugin name. */
export const name = 'web-surface'

/** Services required before the surface context can resolve its URL. */
export const inject = ['webServer']

/** Plugin config. */
export interface Config {
  /**
   * Add the developer orientation: the harness source checkout (`harness:source`), the client rebuild and reload
   * rules, and the replacement-server rule. Only a deployment whose user develops Aeven from this checkout turns it
   * on; for anyone else the text is false and off-topic.
   */
  developerContext: boolean
}

export const Config: z<Config> = z.object({
  developerContext: z.boolean().default(false),
})

/** This avn installation's root, from either this package's source or built entry. */
const SOURCE_ROOT = fileURLToPath(new URL('../../../..', import.meta.url))

/** Environment variable naming the canonical local URL of this Web GUI. */
const AVN_WEB_URL = 'AVN_WEB_URL' as const

// Display-only mirror of the webserver schema's loopback host: the address the
// local URL always prints. Not a source of truth — the schema is.
const LOOPBACK_HOST = '127.0.0.1'

/**
 * Model-visible orientation for sessions whose user reads replies in this GUI; `developer` appends the rules for changing the GUI
 * itself. The text names no process-specific value: the URL reaches the model through the `app:web-url` runtime
 * context, so a server that rebinds to another port does not rewrite a session's system prompt.
 */
function webSurfacePrompt(developer: boolean): string {
  // What the GUI renders is a fact about this surface, not a preference, and it
  // is stated here because a model that cannot see the renderer otherwise
  // assumes a plain-text transcript and refuses requests this surface serves.
  const renderContract = 'Your replies render as GitHub-Flavored Markdown in this GUI, not as plain text. '
    + 'A ```mermaid fence renders as a diagram and TeX math renders through KaTeX. '
    + 'When you write text the user will send on — a message, email, reply, or post — put exactly that text in a ```message fence, '
    + 'which renders as plain prose with a copy button; never put it in a blockquote. '
    + 'Never tell the user you are unable to show a diagram or an image — this surface does both. '
    // A tool's result card folds away with its turn, so the reply is where an
    // image stays visible. The GUI serves an absolute local path itself, so the
    // prompt teaches the path rather than any server URL.
    + 'Tool results, including images a tool returned, fold away when the turn ends; only your reply stays in view. '
    + 'To show the user an image, embed it in your reply as Markdown image syntax with its absolute local file path, '
    + 'for example `![Site plan](/path/to/site-plan.png)`, or with its `https://` URL. '
    + 'The GUI loads local paths itself, so do not construct a server URL for a file. '
    + 'Embed each image you want the user to see once, and never write that an image is shown above unless your reply embeds it. '
  return 'You are interacting with the user through the Aeven Web GUI whose URL the runtime context names. '
    + 'When the user refers to "this page", "this GUI", or "this app" without naming another target, they mean this GUI. '
    + 'The browser provides no implicit DOM, route, or screenshot context. '
    + renderContract.trimEnd()
    + (developer ? ' ' + developerContract : '')
}

/** How changes to this GUI reach the running instance; model-visible only under {@link Config.developerContext}. */
const developerContract = 'The client-plugin HMR receiver is active, but client-plugin changes reload without a refresh only while '
  + '`pnpm run dev:web` is also running from this same checkout to rebuild their bundles; verify that watcher before promising automatic updates. '
  + 'Every other change — the apps/web shell and plain packages — requires rebuilding the affected Web artifacts and verifying this existing URL after a page refresh. '
  + 'Starting another server does not update this GUI. '
  + 'The apps/web Vite entry builds the shell but is not a standalone application because only avn web injects window.__AVN_BOOT__. '
  + 'Do not start a replacement server unless the user asks; if one is needed, use a managed background job and verify its exact URL.'

/**
 * Resolve the canonical loopback URL from the active Web server.
 * @param ctx - a context that can see the `webServer` service.
 * @returns the loopback URL of the bound port.
 */
export function localWebUrl(ctx: Context): string {
  const port = ctx.get('webServer')?.port
  if (port === undefined) throw new Error('web-app: webServer service missing while resolving Web runtime')
  return `http://${LOOPBACK_HOST}:${String(port)}`
}

/**
 * Register the surface context for every agent that can see this context's prompt registry.
 * @param ctx - plugin context carrying the webServer service.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.inject(['systemPrompt'], (promptCtx) => {
    if (config.developerContext) addHarnessSourceSection(promptCtx, SOURCE_ROOT)
    promptCtx.systemPrompt.section({
      name: 'app:web-surface',
      order: promptCtx.systemPrompt.getSectionOrder('WEB_SURFACE'),
      text: webSurfacePrompt(config.developerContext),
    })
    promptCtx.systemPrompt.context({
      name: 'app:web-url',
      order: promptCtx.systemPrompt.getContextOrder('WEB_URL'),
      text: () => `Aeven Web GUI URL: ${localWebUrl(promptCtx)}`,
    })
  })
  ctx.inject(['shellEnv'], (runtimeCtx) => {
    runtimeCtx.shellEnv.register({
      name: 'web-runtime',
      variables: {
        [AVN_WEB_URL]: { description: 'Canonical local URL of the Aeven Web GUI serving this session.' },
      },
      resolve: () => ({ [AVN_WEB_URL]: localWebUrl(runtimeCtx) }),
    })
  })
}
