/**
 * Project orientation for sessions that run in a project folder. Before the
 * first step whose surface lacks it, one durable, source-attributed message
 * tells the model that the session working directory is the person's own
 * project, summarizes the project from its README, lists its top level, and
 * asks that questions about the project be answered from its files. When the
 * optional `ctx.workspaceRegistry` is mounted, the message also names the
 * session owner's other project folders, because one product often spans
 * several of them. A session without a working directory, such as a personal
 * chat, gets nothing. Reads use the optional `ctx.fs` provider, so providerless
 * products mount it as a no-op.
 *
 * @module @aeven/project-context
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@aeven/agent'
import type { FileSystem } from '@aeven/fs'
import { createUserMessage } from '@aeven/llm'
import type { UserMessage } from '@aeven/session'
import type {} from '@aeven/workspace'

/** Cordis plugin name used by loader diagnostics and message sources. */
export const name = 'project-context'

/** The agent registry that owns pre-step processing. */
export const inject = ['agents']

/** Orientation sources and budgets. Invalid values fail plugin load. */
export interface Config {
  /** README file names tried in the working directory, first existing one wins. */
  readmeNames: string[]
  /** Bytes read from the README before its summary is extracted. */
  maxReadmeBytes: number
  /** Code points of README prose kept in the summary. */
  maxSummaryLength: number
  /** Top-level entries listed before the rest are counted. */
  maxEntries: number
  /** Top-level entry names left out of the listing, in addition to dot-entries. */
  ignoredEntries: string[]
  /** Other project folders of the session owner named before the rest are counted. */
  maxRelatedProjects: number
}

/** One of the session owner's other project folders. */
export interface RelatedProject {
  /** Title the person gave the project folder. */
  title: string
  /** Absolute folder path. */
  path: string
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Partial<Config>, Config> = z.object({
  readmeNames: z.array(z.string()).default(['README.md', 'README']),
  maxReadmeBytes: z.natural().min(1).default(65536),
  maxSummaryLength: z.natural().min(1).default(1200),
  maxEntries: z.natural().min(1).default(60),
  ignoredEntries: z.array(z.string()).default(['node_modules', 'lib', 'dist', 'build', 'coverage']),
  maxRelatedProjects: z.natural().default(20),
})

const closingTag = /<\/project_context/giu

/**
 * Extract opening prose from a README: front matter, fenced code, headings,
 * images, HTML, tables, and short link lines such as language switchers are skipped.
 * @param markdown - README text.
 * @param length - Maximum code points kept before the ellipsis.
 * @returns The opening prose, or an empty string when the README has none.
 */
export function readmeSummary(markdown: string, length: number): string {
  const body = markdown
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u, '')
    .replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gmu, '')
  const paragraphs: string[] = []
  for (const block of body.split(/\r?\n\s*\r?\n/u)) {
    const text = block.trim()
    if (text === '' || /^(#|!\[|<|\||[-*+] |\d+\. )/u.test(text)) continue
    const withoutImages = text.replace(/!\[[^\]]*\]\([^)]*\)/gu, '')
    // A line made of links, such as a language switcher or a navigation bar, carries no prose.
    if (Array.from(withoutImages.replace(/\[[^\]]*\]\([^)]*\)/gu, '').replace(/[\s|·•–—/,]+/gu, '')).length < 20) continue
    const prose = withoutImages
      .replace(/\[([^\]]*)\]\([^)]*\)/gu, '$1')
      .replace(/\s+/gu, ' ')
      .trim()
    paragraphs.push(prose)
  }
  const codePoints = Array.from(paragraphs.join('\n\n'))
  return codePoints.length <= length ? codePoints.join('') : `${codePoints.slice(0, length).join('').trimEnd()}…`
}

/**
 * Render the orientation text for one project folder.
 * @param cwd - The session working directory.
 * @param summary - README prose, or an empty string.
 * @param entries - Top-level listing, directories ending in `/`.
 * @param omitted - Count of entries beyond the listing budget.
 * @param related - The person's other project folders.
 * @param relatedOmitted - Count of project folders beyond the related budget.
 * @returns The model-visible orientation text.
 */
export function renderProjectContext(
  cwd: string,
  summary: string,
  entries: readonly string[],
  omitted: number,
  related: readonly RelatedProject[],
  relatedOmitted: number,
): string {
  const lines = [
    `This conversation runs in the person's own project folder, ${cwd}. When they ask about this project — what it is, how it works, or how it is built, deployed, hosted, scaled, run or paid for — read its README, docs and the code involved before you answer, and follow references from those files into related folders. Answer from what the files say, and search the web only for facts outside the project, such as a provider's prices or limits. If the files do not settle a question, say what you could not find instead of guessing from the project's name.`,
  ]
  if (summary !== '') lines.push('', 'README summary:', summary)
  if (entries.length > 0) {
    lines.push('', `Top level: ${entries.join(', ')}${omitted > 0 ? `, and ${omitted} more` : ''}`)
  }
  if (related.length > 0) {
    lines.push(
      '',
      'The person\'s other project folders, which may hold other parts of the same product, such as its server, website or components; read them the same way when a question reaches into them:',
      ...related.map(project => `- ${project.title}: ${project.path}`),
    )
    if (relatedOmitted > 0) lines.push(`- and ${relatedOmitted} more`)
  }
  // Repository-controlled text must not close the plugin-owned frame.
  return `<project_context>\n${lines.join('\n').replace(closingTag, '<\\/project_context')}\n</project_context>`
}

/**
 * Whether the session's model-visible surface already carries this plugin's orientation.
 * @param agent - The agent whose session surface is scanned.
 * @returns True when a visible message from this plugin exists.
 */
function surfaceHasOrientation(agent: Agent): boolean {
  for (const seq of agent.session.surface.nodes.toReversed()) {
    const event = agent.session.eventAt(seq)
    if (event?.type === 'user/message' && event.data.source.kind === 'plugin' && event.data.source.plugin === name) return true
  }
  return false
}

/**
 * Read the orientation for a project folder.
 * @param fileSystem - The filesystem provider.
 * @param cwd - The session working directory.
 * @param related - The session owner's other project folders.
 * @param config - Orientation sources and budgets.
 * @param signal - Aborts the reads.
 * @returns The orientation message, or undefined when the folder is absent or not a directory.
 */
async function composeOrientation(
  fileSystem: FileSystem,
  cwd: string,
  related: readonly RelatedProject[],
  config: Config,
  signal: AbortSignal,
): Promise<UserMessage | undefined> {
  const root = await fileSystem.resolve(cwd, { signal })
  if ((await fileSystem.stat(root, signal))?.type !== 'directory') return undefined
  let summary = ''
  for (const readmeName of config.readmeNames) {
    const readme = await fileSystem.resolve(readmeName, { cwd, signal })
    if ((await fileSystem.stat(readme, signal))?.type !== 'file') continue
    const bytes = await fileSystem.readBytes(readme, signal, config.maxReadmeBytes)
    summary = readmeSummary(new TextDecoder().decode(bytes), config.maxSummaryLength)
    break
  }
  const ignored = new Set(config.ignoredEntries)
  const listed = (await fileSystem.listDir(root, signal))
    .filter(entry => !entry.name.startsWith('.') && !ignored.has(entry.name))
    .sort((left, right) => Number(right.type === 'directory') - Number(left.type === 'directory') || left.name.localeCompare(right.name))
    .map(entry => entry.type === 'directory' ? `${entry.name}/` : entry.name)
  const entries = listed.slice(0, config.maxEntries)
  const named = related.slice(0, config.maxRelatedProjects)
  const text = renderProjectContext(cwd, summary, entries, listed.length - entries.length, named, related.length - named.length)
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: name, form: 'snapshot', sections: [{ name, text }] },
  })
}

/**
 * Register a prepended pre-step listener for the lifetime of `ctx`.
 * @param ctx - Plugin context; the listener is disposed with it.
 * @param config - Orientation sources and budgets.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.on('agent/pre-step', async ({ agent, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    const fileSystem = ctx.get('fs')
    // A session without a workspace, such as a personal chat, has no project; the Host process
    // cwd is the server's own checkout, not the person's project.
    const cwd = agent.session.header.cwd
    if (fileSystem === undefined || cwd === undefined) return decision
    if (decision.messages.some(message => message.source.kind === 'plugin' && message.source.plugin === name)) return decision
    if (surfaceHasOrientation(agent)) return decision
    // A workspace is reachable only by its owner, so another account's folders never reach this session.
    const owner = agent.session.header.owner
    const related = (ctx.get('workspaceRegistry')?.list() ?? []).flatMap(workspace => (
      workspace.kind === 'folder' && workspace.path !== undefined && workspace.path !== cwd && workspace.owner === owner
        ? [{ title: workspace.title, path: workspace.path }]
        : []
    ))
    const orientation = await composeOrientation(fileSystem, cwd, related, config, signal)
    if (orientation === undefined) return decision
    return { ...decision, messages: [...decision.messages, orientation] }
  }, { prepend: true })
}
