/**
 * Fixtures shared by the project-context suites: a scriptable filesystem
 * provider, a workspace-registry stand-in, a detached session with an agent
 * around it, and one pre-step dispatch.
 */

import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { agentEvents, Inbox, type Agent, type PreStepDecision } from '@aeven/agent'
import { FileSystem, FsTargetKey, FsVersion } from '@aeven/fs'
import type {
  FsDirEntry,
  FsEditOutcome,
  FsEditRequest,
  FsInfo,
  FsPathInfo,
  FsTarget,
  FsWriteIntent,
  FsWriteOutcome,
} from '@aeven/fs'
import { createUserMessage } from '@aeven/llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@aeven/session'
import type { UserMessage } from '@aeven/session'
import * as projectContext from '@aeven/project-context'
import type { Config } from '@aeven/project-context'
import { WorkspaceId } from '@aeven/workspace'
import type { Workspace, WorkspaceKind } from '@aeven/workspace'

/** One seeded target: the metadata `stat` reports and the bytes `readBytes` returns. */
interface SeededTarget {
  type: FsInfo['type']
  content?: string
}

/**
 * Filesystem provider answering from seeded data. Keys are the paths
 * `resolve` produces, so a suite seeds exactly the folder and README names it
 * expects the plugin to reach.
 */
export class FakeFileSystem extends FileSystem {
  /** Seeded targets by resolved key. */
  readonly entries = new Map<string, SeededTarget>()
  /** Seeded directory listings by resolved directory key. */
  readonly listings = new Map<string, FsDirEntry[]>()
  /** Every `resolve` result, in call order. */
  readonly resolved: string[] = []
  /** Every `readBytes` call with the byte cap the plugin asked for. */
  readonly reads: { key: string; maxBytes: number }[] = []
  /** Every listed directory key. */
  readonly listed: string[] = []

  /** Seed one target. */
  seed(key: string, target: SeededTarget): void {
    this.entries.set(key, target)
  }

  /** Seed the direct children {@link listDir} reports for one directory. */
  list(directory: string, entries: readonly FsDirEntry[]): void {
    this.listings.set(directory, [...entries])
  }

  override async resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget> {
    const base = opts?.cwd
    // Plain '…/…' joining, not the host's path rules: these suites compare the
    // same keys on every platform.
    const key = base === undefined || path.startsWith('/') ? path : `${base.replace(/\/+$/u, '')}/${path}`
    this.resolved.push(key)
    return { targetKey: FsTargetKey(key), displayPath: key }
  }

  override processPath(_target: FsTarget): string {
    throw new Error('project-context asks for no process path')
  }

  override fileUrl(_target: FsTarget): string {
    throw new Error('project-context asks for no file URL')
  }

  override contains(_parent: FsTarget, _child: FsTarget): boolean {
    throw new Error('project-context tests no containment')
  }

  override async stat(target: FsTarget, _signal?: AbortSignal): Promise<FsInfo | undefined> {
    const entry = this.entries.get(target.targetKey)
    if (entry === undefined) return undefined
    const info: FsInfo = { version: FsVersion(`v:${target.targetKey}`), type: entry.type }
    if (entry.content !== undefined) info.size = Buffer.byteLength(entry.content, 'utf8')
    return info
  }

  override async lstat(_path: string, _opts?: { cwd?: string }, _signal?: AbortSignal): Promise<FsPathInfo | undefined> {
    throw new Error('project-context stats resolved targets only')
  }

  override async readText(_target: FsTarget, _signal?: AbortSignal): Promise<string> {
    throw new Error('project-context reads README bytes, not decoded text')
  }

  override async streamText(_target: FsTarget, _signal?: AbortSignal): Promise<AsyncIterable<string>> {
    throw new Error('project-context streams nothing')
  }

  override async readBytes(target: FsTarget, _signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array> {
    this.reads.push({ key: target.targetKey, maxBytes })
    return new TextEncoder().encode(this.entries.get(target.targetKey)?.content ?? '')
  }

  override async listDir(target: FsTarget, _signal?: AbortSignal): Promise<FsDirEntry[]> {
    this.listed.push(target.targetKey)
    return this.listings.get(target.targetKey) ?? []
  }

  override async writeText(
    _target: FsTarget,
    _content: string,
    _expected?: FsWriteIntent,
    _signal?: AbortSignal,
  ): Promise<FsWriteOutcome> {
    throw new Error('project-context writes nothing')
  }

  override async editText(
    _target: FsTarget,
    _edit: FsEditRequest,
    _expected?: { version: FsVersion },
    _signal?: AbortSignal,
  ): Promise<FsEditOutcome> {
    throw new Error('project-context edits nothing')
  }
}

/** One directory entry for a seeded listing. */
export function entry(directory: string, name: string, type: FsInfo['type']): FsDirEntry {
  const key = `${directory}/${name}`
  return { name, type, target: { targetKey: FsTargetKey(key), displayPath: key } }
}

/**
 * Build a workspace record carrying the four fields the orientation reads.
 * The rest of the `Workspace` surface stays unimplemented: no suite here
 * mutates or queries a record.
 */
export function workspace(fields: {
  id: string
  kind: WorkspaceKind
  path?: string | undefined
  title?: string
  owner?: string
}): Workspace {
  return {
    id: WorkspaceId(fields.id),
    kind: fields.kind,
    path: fields.path,
    title: fields.title ?? fields.path ?? fields.id,
    owner: fields.owner,
    isDefault: false,
    isBuiltIn: false,
    createdAt: '2026-10-23T00:00:00.000Z',
    updatedAt: '2026-10-23T00:00:00.000Z',
    sessionIds: [],
  } as unknown as Workspace
}

/** A detached session with the header fields project-context reads. */
export function projectSession(options: { cwd?: string; owner?: string; id?: string } = {}): Session {
  const id = SessionId(options.id ?? 'project-session')
  return Session.create(id, undefined, {
    version: SESSION_FORMAT_VERSION,
    id,
    createdAt: 0,
    isSeeded: false,
    ...options.cwd === undefined ? {} : { cwd: options.cwd },
    ...options.owner === undefined ? {} : { owner: options.owner },
  })
}

/** An agent around one session; project-context reads the session and nothing else. */
export function agentFor(session: Session, id = 'agent'): Agent {
  return {
    id: SessionId(id),
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'running',
    ctx: new Context(),
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => { throw new Error('project-context returns its orientation from pre-step') },
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

/** Options for {@link mountProjectContext}. */
export interface MountOptions {
  /** Plugin config; omitted fields take their schema defaults. */
  config?: Partial<Config>
  /** Whether a filesystem provider is mounted. Defaults to true. */
  fs?: boolean
  /** Workspace registry stand-in; omit to leave `ctx.workspaceRegistry` unmounted. */
  workspaces?: readonly Workspace[]
}

/** A mounted context and the provider it holds, when one was mounted. */
export interface Mounted {
  ctx: Context
  fs: FakeFileSystem | undefined
}

/** Mount the agent registry, an optional filesystem provider and workspace registry, then the plugin. */
export async function mountProjectContext(options: MountOptions = {}): Promise<Mounted> {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  let fs: FakeFileSystem | undefined
  if (options.fs !== false) {
    await ctx.plugin(FakeFileSystem)
    fs = ctx.get('fs') as FakeFileSystem
  }
  if (options.workspaces !== undefined) {
    ctx.provide('workspaceRegistry', { list: () => options.workspaces } as never)
  }
  await ctx.plugin(projectContext, options.config ?? {})
  return { ctx, fs }
}

/** Dispatch one `agent/pre-step` through the mounted listener chain. */
export async function preStep(
  ctx: Context,
  agent: Agent,
  decision: PreStepDecision = { kind: 'enter', messages: [] },
  signal: AbortSignal = new AbortController().signal,
): Promise<PreStepDecision> {
  return agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages: [], turn: 1, step: 1, signal },
    () => Promise.resolve(decision),
  )
}

/** The orientation message a decision carries, when the plugin added one. */
export function orientationOf(decision: PreStepDecision): UserMessage | undefined {
  if (decision.kind !== 'enter') throw new Error('expected an entered pre-step')
  return decision.messages.find(message => (
    message.source.kind === 'plugin' && message.source.plugin === projectContext.name
  ))
}

/** The orientation text a decision carries; throws when the plugin added none. */
export function orientationText(decision: PreStepDecision): string {
  const message = orientationOf(decision)
  if (message === undefined) throw new Error('expected an injected project orientation')
  const block = message.content.find(content => content.type === 'text')
  if (block?.type !== 'text') throw new Error('expected orientation text')
  return block.text
}

/** One plugin-sourced user message, for seeding a session surface. */
export function pluginMessage(plugin: string, text: string): UserMessage {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'plugin', plugin } })
}
