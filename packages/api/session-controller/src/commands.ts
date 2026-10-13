/** Session commands whose activation policy is explicit at each Remote method. */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@aeven/brand'
import type { Agent, ModelSelection as AgentModelSelection } from '@aeven/agent'
import { AttachmentError, admitPromptContent } from '@aeven/attachment'
import type { FileAttachmentRef, ImageAttachmentRef, StoredFileAttachment, StoredImageAttachment } from '@aeven/attachment'
import {
  ReasoningEffortId, createUserMessage, freezeMessage,
} from '@aeven/llm'
import type { MessageSource } from '@aeven/llm'
import { SessionLogOffset, SessionSeq } from '@aeven/session'
import type { SessionEvent, SessionHeader, SessionId, UserMessage } from '@aeven/session'
import { SessionQueryError, type SessionObservation } from '@aeven/session-query'
import { SessionPersistenceBusyError } from '@aeven/session-persistence'
import { SessionTitleInvalidError } from '@aeven/session-title'
import { canonicalClientTimeZone } from '@aeven/util-time'
import { RemoteError, remoteErrorOf } from '@aeven/typert-protocol'
import type { Workspace } from '@aeven/workspace'
import {
  ApiSessionAgentController,
  ApiSessionCwdConflict,
  ApiSessionForeign,
  ApiSessionNotFound,
  ApiSessionPresetConflict,
  ApiSessionSubagentOwnership,
  apiSessionSubagentOwnershipError,
  hasApiSessionSubagentOwner,
  inspectApiSession,
} from './agent.ts'
import type {
  SessionAttachmentRequest,
  SessionAttachmentValue,
  SessionCancelRequest,
  SessionCancelValue,
  SessionCreateRequest,
  SessionCreateValue,
  SessionEditRequest,
  SessionEditValue,
  SessionForkRequest,
  SessionForkValue,
  SessionMoveRequest,
  SessionMoveValue,
  SessionPromptRequest,
  SessionPromptValue,
  SessionRenameRequest,
  SessionRenameValue,
  SessionSelectModelRequest,
  SessionSelectModelValue,
  SessionUpdateQueueRequest,
  SessionUpdateQueueValue,
} from './types.ts'

interface SessionReadState {
  readonly id: SessionId
  readonly header: SessionHeader
  readonly events: readonly SessionEvent[]
}

type PromptContentCandidate =
  | SessionPromptRequest['content'][number]
  | Extract<SessionUpdateQueueRequest['action'], { readonly kind: 'edit' }>['content'][number]

function hasPromptContent(content: readonly PromptContentCandidate[]): boolean {
  return content.some(part => part.type !== 'text' || part.text.trim().length > 0)
}

/** Build the user-message source of a prompt or edit, validating its client time zone and retaining its reported profile name. */
function userSource(request: SessionPromptRequest | SessionEditRequest): MessageSource {
  const profile = request.clientDisplayName === undefined ? {} : { clientDisplayName: request.clientDisplayName }
  if (request.clientTimeZone === undefined) return { kind: 'user', rpcId: request.requestId, ...profile }
  const clientTimeZone = canonicalClientTimeZone(request.clientTimeZone)
  if (clientTimeZone === undefined) {
    throw new RemoteError(
      'session/invalid-time-zone',
      'clientTimeZone must be UTC or a valid IANA Area/Location name',
      { value: request.clientTimeZone },
    )
  }
  return { kind: 'user', rpcId: request.requestId, clientTimeZone, ...profile }
}

/**
 * Resolve an edit target: a user-authored `user/message` that no later rewind
 * discarded, and the seq the rewind cuts at — the `turn/start` of a turn the
 * message opened, or the message itself when it joined a turn another
 * user-authored message opened (steering).
 * @throws RemoteError `session/edit-unavailable` for any other seq.
 */
function editTarget(
  session: Agent['session'],
  request: SessionEditRequest,
): { message: UserMessage; cut: SessionSeq } {
  const unavailable = (): RemoteError => new RemoteError(
    'session/edit-unavailable',
    `seq ${String(request.messageSeq)} is not a current user prompt of session "${request.sessionId}"`,
    { sessionId: request.sessionId, messageSeq: request.messageSeq },
  )
  if (!Number.isSafeInteger(request.messageSeq) || request.messageSeq < 0 || request.messageSeq >= session.seq) {
    throw unavailable()
  }
  const seq = SessionSeq(request.messageSeq)
  const event = session.eventAt(seq)
  if (event?.type !== 'user/message' || event.data.source.kind !== 'user') throw unavailable()
  for (let index = session.seq - 1; index > seq; index--) {
    const later = session.eventAt(SessionSeq(index))
    if (later?.type === 'session/rewind' && later.data.seq <= seq) throw unavailable()
  }
  for (let index = seq - 1; index >= 0; index--) {
    const earlier = session.eventAt(SessionSeq(index))
    if (earlier?.type === 'turn/start') return { message: event.data, cut: earlier.seq }
    if (earlier?.type === 'turn/end') break
    if (earlier?.type === 'user/message' && earlier.data.source.kind === 'user') return { message: event.data, cut: seq }
  }
  throw unavailable()
}

/** Replace the text blocks of a prompt with `text` at the first text position, keeping attachments. */
function editedContent(content: UserMessage['content'], text: string): UserMessage['content'] {
  const edited: UserMessage['content'][number][] = []
  let placed = false
  for (const block of content) {
    if (block.type !== 'text') edited.push(block)
    else if (!placed) {
      edited.push({ type: 'text', text })
      placed = true
    }
  }
  if (!placed) edited.push({ type: 'text', text })
  return edited
}

/** Implements Session business commands delegated by the Session Controller Remote service. */
export class SessionCommandController {
  /**
   * @param ctx - Host context carrying Agent, model, attachment, title, and Workspace services.
   * @param agents - sole owner of create, resume, and Session-local model selection.
   * @param defaultCwd - project directory used when create names neither a Workspace nor a cwd.
   */
  constructor(
    private readonly ctx: Context,
    private readonly agents: ApiSessionAgentController,
    private readonly defaultCwd: string,
  ) {}

  /**
   * Create or idempotently adopt one ordinary Session.
   * @param request - requested identity, location, and Agent preset.
   * @returns the Session identity and resolved preset when configured.
   */
  async create(request: SessionCreateRequest): Promise<SessionCreateValue> {
    if (request.workspaceId !== undefined && request.cwd !== undefined) {
      throw new RemoteError('gateway/bad-request', 'session.create accepts workspaceId or cwd, not both', {})
    }
    const sessionId = request.sessionId ?? brandString<SessionId>(`session-${randomUUID()}`)
    let workspace: Workspace | undefined
    const workspaceId = request.workspaceId ?? (request.cwd === undefined ? this.ctx.workspaceRegistry.defaultWorkspaceId : undefined)
    if (workspaceId !== undefined) {
      workspace = this.ctx.workspaceRegistry.get(workspaceId)
      if (workspace === undefined) {
        throw new RemoteError('workspace/not-found', `workspace "${workspaceId}" not found`, {
          workspaceId,
        })
      }
    }
    // A named workspace supplies the session's location, including the case
    // where it has none: a workspace with no directory binding hands out no
    // cwd, so its sessions are located by the record alone. Falling through to
    // the default cwd there would plant a machine-local path inside a record
    // that is expected to travel between machines, which is the one thing a
    // pathless workspace exists to avoid. Only a request that names no
    // workspace at all falls back to an explicit or deployment-default cwd.
    const cwd = workspace !== undefined
      ? workspace.path
      : request.cwd ?? this.defaultCwd
    let adopted: Agent
    try {
      adopted = await this.agents.ensureSession(
        sessionId,
        cwd,
        request.sessionId !== undefined,
        request.agentPreset,
      )
    } catch (error) {
      this.rejectCreation(sessionId, error)
    }
    if (workspace !== undefined) {
      try {
        await workspace.attachSession(sessionId)
      } catch (error) {
        throw new RemoteError(
          'session/workspace-attach-failed',
          `session "${sessionId}" was created but could not attach to workspace "${workspace.id}": ${String(error)}`,
          { sessionId, workspaceId: workspace.id },
        )
      }
    }
    const agentPreset = this.agents.presetForSession(adopted.session)
    return { sessionId, ...(agentPreset === undefined ? {} : { agentPreset }) }
  }

  /**
   * Validate and install one Session-local model selection.
   * @param request - Session identity and requested model selection.
   * @returns the normalized selection installed for the Session.
   */
  async selectModel(request: SessionSelectModelRequest): Promise<SessionSelectModelValue> {
    const agent = await this.resolveAgent(request.sessionId)
    return this.agents.serializeImageAdmission(agent, async () => {
      try {
        const resolved = await this.ctx.llm.resolveCallConfig({
          provider: request.provider,
          model: request.model,
          ...(request.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: ReasoningEffortId(request.reasoningEffort) }),
        })
        const selected: AgentModelSelection = {
          provider: resolved.provider,
          model: resolved.model,
          ...(resolved.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: resolved.reasoningEffort }),
        }
        this.agents.selectForNextRequest(agent, selected)
        try {
          await this.ctx.agentDefaultModel.saveSelection(selected)
        } catch (error) {
          this.ctx.logger.warn(
            `session-controller: model selection changed for the Session but the default was not saved: ${String(error)}`,
          )
        }
        return { selected: { ...selected } }
      } catch (error) {
        if (remoteErrorOf(error) !== undefined) throw error
        throw new RemoteError(
          'session/model-unavailable',
          error instanceof Error ? error.message : String(error),
          { provider: request.provider, model: request.model },
        )
      }
    })
  }

  /**
   * Normalize and append a user-owned Session title.
   * @param request - Session identity and proposed title.
   * @returns the accepted title and durable event sequence.
   */
  async rename(request: SessionRenameRequest): Promise<SessionRenameValue> {
    const agent = await this.resolveAgent(request.sessionId)
    const titles = this.ctx.get('sessionTitle')
    if (titles === undefined) {
      throw new RemoteError('gateway/internal', 'renaming is unavailable: this deployment mounts no session-title service', {})
    }
    try {
      const accepted = titles.rename(agent.session, request.title)
      return { title: accepted.title, seq: accepted.eventSeq }
    } catch (error) {
      if (error instanceof SessionTitleInvalidError) {
        throw new RemoteError('session/title-invalid', error.message, { sessionId: request.sessionId })
      }
      throw new RemoteError(
        'gateway/internal',
        `failed to rename session "${request.sessionId}": ${String(error)}`,
        {},
      )
    }
  }

  /**
   * Create a new ordinary Session from one completed-turn prefix.
   * @param request - source Session and optional event anchor.
   * @returns the new Session identity.
   */
  async fork(request: SessionForkRequest): Promise<SessionForkValue> {
    let atSeq: ReturnType<typeof SessionSeq> | undefined
    try {
      atSeq = request.atSeq === undefined ? undefined : SessionSeq(request.atSeq)
    } catch {
      throw new RemoteError('gateway/bad-request', 'atSeq must be a non-negative safe integer', {})
    }
    let observed: SessionObservation
    try {
      observed = await this.ctx.sessionQuery.observeSession(request.sessionId)
    } catch (error) {
      if (error instanceof SessionQueryError
        && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND') {
        throw new RemoteError('session/not-found', `session "${request.sessionId}" not found`, {
          sessionId: request.sessionId,
        })
      }
      throw new RemoteError(
        'gateway/internal',
        `fork source unavailable for session "${request.sessionId}": ${String(error)}`,
        {},
      )
    }
    using source = observed
    if (!this.agents.callerMayAccess(source.header)) {
      throw new RemoteError('session/not-found', `session "${request.sessionId}" not found`, {
        sessionId: request.sessionId,
      })
    }
    const lastSeq = source.events.at(-1)?.seq ?? -1
    const anchoredBoundary = atSeq === undefined
      ? undefined
      : source.events.find(event => event.type === 'turn/end' && event.seq >= atSeq)
    const boundary = anchoredBoundary
      ?? (atSeq === undefined || atSeq > lastSeq
        ? source.events.findLast(event => event.type === 'turn/end')
        : undefined)
    if (boundary === undefined) {
      throw new RemoteError(
        'session/fork-unavailable',
        atSeq !== undefined && atSeq <= lastSeq
          ? `session "${request.sessionId}" has not completed the turn containing event ${String(atSeq)}`
          : `session "${request.sessionId}" has no completed turn to fork from`,
        { sessionId: request.sessionId },
      )
    }
    let cut = SessionLogOffset(boundary.seq + 1)
    while (cut < source.events.length && source.events[cut]?.type !== 'turn/start') {
      cut = SessionLogOffset(cut + 1)
    }
    let workspace: Workspace | undefined
    try {
      workspace = await this.forkWorkspace(source.header)
    } catch (error) {
      throw new RemoteError(
        'gateway/internal',
        `failed to resolve fork workspace for session "${request.sessionId}": ${String(error)}`,
        {},
      )
    }
    const childId = brandString<SessionId>(`session-${randomUUID()}`)
    const composition = await this.agents.composeAgent(this.agents.presetForObservation(source))
    try {
      const { provider, model } = this.ctx.agentDefaultModel.currentSelection()
      this.agents.own(await this.ctx.agents.create({
        sessionId: childId,
        seed: source.events.slice(0, cut),
        inheritedEventCount: cut,
        meta: {
          ...(source.header.cwd === undefined ? {} : { cwd: source.header.cwd }),
          parentSession: source.header.id,
          isSeeded: true,
          ...(source.header.owner === undefined ? {} : { owner: source.header.owner }),
          ...(composition.agentPreset === undefined
            ? {}
            : { agentPreset: composition.agentPreset }),
        },
        agentOptions: { provider, model },
        setup: composition.setup,
      }))
    } catch (error) {
      throw new RemoteError(
        'gateway/internal',
        `failed to fork session "${request.sessionId}": ${String(error)}`,
        {},
      )
    }
    if (workspace !== undefined) {
      try {
        await workspace.attachSession(childId)
      } catch (error) {
        throw new RemoteError(
          'session/workspace-attach-failed',
          `session "${childId}" was forked but could not attach to workspace "${workspace.id}": ${String(error)}`,
          { sessionId: childId, workspaceId: workspace.id },
        )
      }
    }
    return { sessionId: childId }
  }

  /**
   * Move one idle Session into another Workspace. A Session's cwd is fixed at
   * creation, so the move writes the complete log into a new Session located
   * at the target Workspace's directory, then deletes the source: its Agent,
   * its stored log, its projection-cache record, and its Workspace and
   * archive entries.
   * @param request - source Session and target Workspace.
   * @returns the identity of the Session that replaces the source.
   */
  async move(request: SessionMoveRequest): Promise<SessionMoveValue> {
    const workspace = this.ctx.workspaceRegistry.get(request.workspaceId)
    if (workspace === undefined
      || !(workspace.isBuiltIn || (this.ctx.get('identityUsers')?.mayAccess(workspace.owner) ?? true))) {
      throw new RemoteError('workspace/not-found', `workspace "${request.workspaceId}" not found`, {
        workspaceId: request.workspaceId,
      })
    }
    const unavailable = (
      reason: 'same-workspace' | 'missing-directory' | 'subagent' | 'managed-workspace',
      message: string,
    ) => new RemoteError('session/move-unavailable', message, { sessionId: request.sessionId, reason })
    if (workspace.sessionIds.includes(request.sessionId)) {
      throw unavailable('same-workspace', `session "${request.sessionId}" already belongs to workspace "${workspace.id}"`)
    }
    // A plugin-declared built-in Workspace such as Automations holds only the
    // Sessions its plugin creates: none moves in, and none of its own moves out.
    const managed = (candidate: { readonly isBuiltIn: boolean, readonly isDefault: boolean }): boolean =>
      candidate.isBuiltIn && !candidate.isDefault
    if (managed(workspace)) {
      throw unavailable('managed-workspace', `workspace "${workspace.id}" holds only the sessions its plugin creates`)
    }
    const source = this.ctx.workspaceRegistry.list().find(candidate => candidate.sessionIds.includes(request.sessionId))
    if (source !== undefined && managed(source)) {
      throw unavailable('managed-workspace', `session "${request.sessionId}" belongs to managed workspace "${source.id}"`)
    }
    if (await workspace.status() === 'missing-dir') {
      throw unavailable('missing-directory', `workspace "${workspace.id}" directory is missing`)
    }
    if (this.ctx.agents.get(request.sessionId)?.status === 'running') {
      throw new RemoteError('session/agent-busy', 'move rejected', { reason: 'the session is running a turn' })
    }
    let observed: SessionObservation
    try {
      observed = await this.ctx.sessionQuery.observeSession(request.sessionId)
    } catch (error) {
      if (error instanceof SessionQueryError
        && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND') {
        throw new RemoteError('session/not-found', `session "${request.sessionId}" not found`, {
          sessionId: request.sessionId,
        })
      }
      throw new RemoteError(
        'gateway/internal',
        `move source unavailable for session "${request.sessionId}": ${String(error)}`,
        {},
      )
    }
    const movedId = brandString<SessionId>(`session-${randomUUID()}`)
    {
      using source = observed
      if (!this.agents.callerMayAccess(source.header)) {
        throw new RemoteError('session/not-found', `session "${request.sessionId}" not found`, {
          sessionId: request.sessionId,
        })
      }
      if (hasApiSessionSubagentOwner(this.ctx, { header: source.header }, undefined)) {
        throw unavailable('subagent', `session "${request.sessionId}" belongs to a subagent`)
      }
      const composition = await this.agents.composeAgent(this.agents.presetForObservation(source))
      try {
        const { provider, model } = this.ctx.agentDefaultModel.currentSelection()
        // The whole log moves, and the source's own fork lineage moves with it:
        // the new Session inherits what the source inherited, from the same parent.
        this.agents.own(await this.ctx.agents.create({
          sessionId: movedId,
          seed: source.events,
          inheritedEventCount: source.inheritedEventCount,
          meta: {
            ...(workspace.path === undefined ? {} : { cwd: workspace.path }),
            ...(source.header.parentSession === undefined ? {} : { parentSession: source.header.parentSession }),
            isSeeded: true,
            ...(source.header.owner === undefined ? {} : { owner: source.header.owner }),
            ...(composition.agentPreset === undefined
              ? {}
              : { agentPreset: composition.agentPreset }),
          },
          agentOptions: { provider, model },
          setup: composition.setup,
        }))
      } catch (error) {
        throw new RemoteError(
          'gateway/internal',
          `failed to move session "${request.sessionId}": ${String(error)}`,
          {},
        )
      }
    }
    try {
      await workspace.attachSession(movedId)
    } catch (error) {
      throw new RemoteError(
        'session/workspace-attach-failed',
        `session "${movedId}" was moved but could not attach to workspace "${workspace.id}": ${String(error)}`,
        { sessionId: movedId, workspaceId: workspace.id },
      )
    }
    try {
      await this.agents.release(request.sessionId)
      await this.ctx.sessionPersistence.delete(request.sessionId)
      await this.ctx.get('sessionProjectionCache')?.forget(request.sessionId)
      await this.ctx.workspaceRegistry.forgetSession(request.sessionId)
    } catch (error) {
      throw new RemoteError(
        'gateway/internal',
        `session moved to "${movedId}" but the original "${request.sessionId}" could not be deleted: ${String(error)}`,
        {},
      )
    }
    this.ctx.emit('api-session/removed', request.sessionId)
    return { sessionId: movedId }
  }

  /**
   * Reject empty content, then admit one prompt after Agent and attachment validation.
   * @param request - Session identity, prompt content, source metadata, and delivery mode.
   * @returns acknowledgement that the Agent accepted the prompt.
   */
  async prompt(request: SessionPromptRequest): Promise<SessionPromptValue> {
    if (!hasPromptContent(request.content)) {
      throw new RemoteError(
        'gateway/bad-request',
        'prompt content must include non-whitespace text or an attachment',
        {},
      )
    }
    const source = userSource(request)
    const agent = await this.resolveAgent(request.sessionId)
    this.assertRouteServed(agent)
    const hasImage = request.content.some(part => part.type === 'image')
    const admit = async (): Promise<SessionPromptValue> => {
      try {
        if (hasImage) {
          const current = this.agents.selectionFor(agent).current
          const model = await this.ctx.llm.resolveModelInfo(current.provider, current.model)
          if (model.inputModalities !== undefined && !model.inputModalities.includes('image')) {
            throw new RemoteError(
              'session/attachment-invalid',
              `Model "${current.model}" does not support image input.`,
              { reason: 'MODEL_DOES_NOT_SUPPORT_IMAGES' },
            )
          }
        }
        const content = await admitPromptContent(this.ctx.attachments, request.content)
        const message: UserMessage = createUserMessage({ content, source })
        if (request.mode === 'steer') agent.steer(message)
        else agent.followup(message)
      } catch (error) {
        if (remoteErrorOf(error) !== undefined) throw error
        if (error instanceof AttachmentError) {
          throw new RemoteError('session/attachment-invalid', error.message, { reason: error.code })
        }
        throw new RemoteError('session/agent-busy', 'prompt rejected', { reason: String(error) })
      }
      return { accepted: true }
    }
    return hasImage ? this.agents.serializeImageAdmission(agent, admit) : admit()
  }

  /**
   * Replace one user prompt's text: stop the running turn, drop queued input,
   * rewind the Session to before the prompt (before its turn when it opened
   * one), and admit the edited prompt as the next turn. Attachments of the
   * original prompt are kept.
   * @param request - Session identity, edited message seq, replacement text, and source metadata.
   * @returns the committed rewind position.
   */
  async edit(request: SessionEditRequest): Promise<SessionEditValue> {
    if (request.text.trim().length === 0) {
      throw new RemoteError('gateway/bad-request', 'edited text must include non-whitespace text', {})
    }
    const source = userSource(request)
    const agent = await this.resolveAgent(request.sessionId)
    if (hasApiSessionSubagentOwner(this.ctx, agent.session, agent)) {
      throw apiSessionSubagentOwnershipError(request.sessionId)
    }
    this.assertRouteServed(agent)
    editTarget(agent.session, request)
    agent.cancel({ kind: 'user' })
    await agent.whenIdle()
    let rewindSeq: number | undefined
    try {
      await agent.runMaintenance(() => {
        // Re-resolved inside the idle phase: a concurrent edit may have rewound past the target.
        const target = editTarget(agent.session, request)
        rewindSeq = agent.session.append('session/rewind', { seq: target.cut }).seq
        agent.followup(createUserMessage({ content: editedContent(target.message.content, request.text), source }))
        return Promise.resolve()
      })
    } catch (error) {
      if (remoteErrorOf(error) !== undefined) throw error
      throw new RemoteError('session/agent-busy', 'edit rejected', { reason: String(error) })
    }
    // oxlint-disable-next-line typescript/no-non-null-assertion -- the resolved maintenance task assigned it
    return { accepted: true, rewindSeq: rewindSeq! }
  }

  /**
   * Read one durable image after proving the Session log references it.
   * @param request - Session and attachment identities used for authorization.
   * @returns the durable attachment reference and base64-encoded bytes.
   */
  async attachment(request: SessionAttachmentRequest): Promise<SessionAttachmentValue> {
    let source: SessionReadState
    try {
      source = await this.readSessionState(request.sessionId)
    } catch (error) {
      if (error instanceof ApiSessionNotFound) {
        throw new RemoteError('session/not-found', error.message, { sessionId: request.sessionId })
      }
      throw new RemoteError(
        'gateway/internal',
        `attachment authorization unavailable for session "${request.sessionId}": ${String(error)}`,
        {},
      )
    }
    const ref = referencedAttachment<ImageAttachmentRef>(source.events, 'image', String(request.attachmentId))
    if (ref === undefined) {
      throw new RemoteError(
        'session/attachment-invalid',
        'Image is not referenced by this session.',
        { reason: 'ATTACHMENT_NOT_REFERENCED' },
      )
    }
    try {
      const stored = await this.ctx.attachments.readImage(ref)
      return {
        attachment: stored.ref,
        data: Buffer.from(stored.data).toString('base64'),
      }
    } catch (error) {
      if (error instanceof AttachmentError) {
        throw new RemoteError('session/attachment-invalid', error.message, { reason: error.code })
      }
      throw new RemoteError('gateway/internal', 'Unable to read image attachment.', {})
    }
  }

  /**
   * Read one stored file original after proving the Session log references it.
   * @param sessionId - Session whose log must cite the file.
   * @param attachmentId - opaque file identifier.
   * @returns the verified original bytes and logged reference, or undefined when the log does not cite it.
   */
  async referencedFile(sessionId: SessionId, attachmentId: string): Promise<StoredFileAttachment | undefined> {
    const source = await this.readSessionState(sessionId)
    const ref = referencedAttachment<FileAttachmentRef>(source.events, 'file', attachmentId)
    return ref === undefined ? undefined : this.ctx.attachments.readFile(ref)
  }

  /**
   * Read one image the addressed Session log cites.
   * @param sessionId - the Session whose log is searched.
   * @param attachmentId - the cited image's reference id.
   * @returns the stored image, or undefined when the log cites no such image.
   */
  async referencedImage(sessionId: SessionId, attachmentId: string): Promise<StoredImageAttachment | undefined> {
    const source = await this.readSessionState(sessionId)
    const ref = referencedAttachment<ImageAttachmentRef>(source.events, 'image', attachmentId)
    return ref === undefined ? undefined : this.ctx.attachments.readImage(ref)
  }

  /**
   * Mutate one still-pending queue occurrence without resuming a cold Agent.
   * @param request - Session, queue item, and requested mutation.
   * @returns acknowledgement that the queue mutation was applied.
   */
  updateQueue(request: SessionUpdateQueueRequest): SessionUpdateQueueValue {
    if (request.action.kind === 'edit') {
      if (request.action.content.some(block => block.type !== 'text')) {
        throw new RemoteError(
          'session/attachment-invalid',
          'queue edits accept text content only',
          { reason: 'QUEUE_EDIT_NON_TEXT' },
        )
      }
      if (!hasPromptContent(request.action.content)) {
        throw new RemoteError(
          'gateway/bad-request',
          'queue edit content must include non-whitespace text',
          {},
        )
      }
    }
    const agent = this.ctx.agents.get(request.sessionId)
    if (agent !== undefined && hasApiSessionSubagentOwner(this.ctx, agent.session, agent)) {
      throw apiSessionSubagentOwnershipError(request.sessionId)
    }
    // Another account's queue reads as one with nothing pending.
    if (agent === undefined || !this.agents.callerMayAccess(agent.session.header)) {
      throw new RemoteError('session/queue-item-not-found', 'queued item is no longer pending', { itemId: request.itemId })
    }
    const nextTurn = agent.inbox.nextTurn.find(message => message.id === request.itemId)
    const nextStep = agent.inbox.nextStep.find(message => message.id === request.itemId)
    const located = nextTurn === undefined
      ? nextStep === undefined ? undefined : { target: 'next-step' as const, message: nextStep }
      : { target: 'next-turn' as const, message: nextTurn }
    if (located === undefined) {
      throw new RemoteError('session/queue-item-not-found', 'queued item is no longer pending', { itemId: request.itemId })
    }
    const { target, message } = located
    if (request.action.kind === 'steer' && (target !== 'next-turn' || agent.status !== 'running')) {
      throw new RemoteError('session/steer-unavailable', 'current turn no longer accepts steering', { itemId: request.itemId })
    }
    if (request.action.kind === 'edit') {
      agent.inbox.replace(request.itemId, freezeMessage<UserMessage>({
        ...message,
        content: [...request.action.content],
      }))
    } else {
      agent.inbox.remove(request.itemId)
      if (request.action.kind === 'steer') agent.steer(message)
    }
    return { accepted: true }
  }

  /**
   * Cancel one live ordinary Agent while retaining pending inbox work.
   * @param request - Session whose active Agent turn is cancelled.
   * @returns acknowledgement that cancellation was requested.
   */
  cancel(request: SessionCancelRequest): SessionCancelValue {
    const agent = this.ctx.agents.get(request.sessionId)
    if (agent === undefined || !this.agents.callerMayAccess(agent.session.header)) {
      throw new RemoteError(
        'session/not-found',
        `session "${request.sessionId}" not found (not attached)`,
        { sessionId: request.sessionId },
      )
    }
    if (hasApiSessionSubagentOwner(this.ctx, agent.session, agent)) {
      throw apiSessionSubagentOwnershipError(request.sessionId)
    }
    agent.cancel({ kind: 'user' }, { keepInbox: true })
    return { accepted: true }
  }

  private assertRouteServed(agent: Agent): void {
    const selection = this.agents.selectionFor(agent).current
    if (!routeServed(this.ctx, selection.provider)) {
      throw new RemoteError(
        'session/model-unavailable',
        `no adapter serves provider "${selection.provider}"; select a model for this session`,
        { provider: selection.provider, model: selection.model },
      )
    }
  }

  private async resolveAgent(sessionId: SessionId): Promise<Agent> {
    const found = await this.agents.resolveAgent(sessionId)
    if ('error' in found) throw found.error
    return found.agent
  }

  private rejectCreation(sessionId: SessionId, error: unknown): never {
    if (remoteErrorOf(error) !== undefined) throw error
    if (error instanceof SessionPersistenceBusyError) {
      throw new RemoteError('session/agent-busy', error.message, { reason: error.message })
    }
    if (error instanceof ApiSessionPresetConflict) {
      throw new RemoteError('agent-preset/conflict', error.message, {
        sessionId: error.sessionId,
        requestedPreset: error.requestedPreset,
        ...(error.existingPreset === undefined ? {} : { existingPreset: error.existingPreset }),
      })
    }
    if (error instanceof ApiSessionCwdConflict) {
      throw new RemoteError('session/conflict', error.message, {
        sessionId: error.sessionId,
        requestedCwd: error.requestedCwd ?? null,
        ...(error.existingCwd === undefined ? {} : { existingCwd: error.existingCwd }),
      })
    }
    if (error instanceof ApiSessionSubagentOwnership) {
      throw apiSessionSubagentOwnershipError(error.sessionId)
    }
    if (error instanceof ApiSessionForeign) {
      throw new RemoteError('session/not-found', error.message, { sessionId: error.sessionId })
    }
    throw new RemoteError('gateway/internal', `failed to create session "${sessionId}": ${String(error)}`, {})
  }

  /** Read one Session's log for the acting caller; another account's Session reads as absent. */
  private async readSessionState(sessionId: SessionId): Promise<SessionReadState> {
    const attached = this.ctx.sessions.get(sessionId)
    const state: SessionReadState = attached !== undefined
      ? { id: attached.id, header: attached.header, events: attached.snapshotEvents() }
      : await inspectApiSession(this.ctx, sessionId)
        .then(inspected => ({ id: inspected.meta.id, header: inspected.meta, events: inspected.events }))
    if (!this.agents.callerMayAccess(state.header)) throw new ApiSessionNotFound(`session "${sessionId}" not found`)
    return state
  }

  private async forkWorkspace(source: SessionHeader): Promise<Workspace | undefined> {
    const workspaces = this.ctx.workspaceRegistry.list()
    const direct = workspaces.find(workspace => workspace.sessionIds.includes(source.id))
    if (direct !== undefined || source.origin !== 'subagent') return direct
    const lineage = await this.ctx.sessionQuery.traceSession(source.id)
    for (const ancestor of lineage.ancestors) {
      const workspace = workspaces.find(candidate => candidate.sessionIds.includes(ancestor.header.id))
      if (workspace !== undefined) return workspace
    }
    return undefined
  }
}

type AttachmentBlockType = 'image' | 'file'

function attachmentBlockIn<Ref extends { readonly attachmentId: unknown }>(
  content: unknown,
  type: AttachmentBlockType,
  match: (ref: Ref) => boolean,
): Ref | undefined {
  if (!Array.isArray(content)) return undefined
  for (const value of content) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
    const block = value as { readonly type?: unknown; readonly attachment?: unknown; readonly content?: unknown }
    if (block.type === type && typeof block.attachment === 'object' && block.attachment !== null) {
      const ref = block.attachment as Ref
      if (match(ref)) return ref
    }
    if (block.type === 'tool-result') {
      const nested = attachmentBlockIn(block.content, type, match)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

function attachmentInEvent<Ref extends { readonly attachmentId: unknown }>(
  event: SessionEvent,
  type: AttachmentBlockType,
  match: (ref: Ref) => boolean,
): Ref | undefined {
  const data = event.data as {
    readonly content?: unknown
    readonly message?: { readonly content?: unknown }
    readonly inserted?: readonly { readonly content?: unknown }[]
    readonly chunk?: { readonly type?: unknown; readonly block?: unknown }
  }
  const direct = attachmentBlockIn(data.content, type, match)
  if (direct !== undefined) return direct
  const message = attachmentBlockIn(data.message?.content, type, match)
  if (message !== undefined) return message
  for (const inserted of data.inserted ?? []) {
    const found = attachmentBlockIn(inserted.content, type, match)
    if (found !== undefined) return found
  }
  return event.type === 'assistant/chunk' && data.chunk?.type === 'block-end'
    ? attachmentBlockIn([data.chunk.block], type, match)
    : undefined
}

/**
 * Find the logged reference of one attachment cited by a Session log.
 * @param events - complete Session events.
 * @param type - content-block type carrying the reference.
 * @param attachmentId - opaque attachment identifier.
 * @returns the logged reference, or undefined when the log never cites it.
 */
function referencedAttachment<Ref extends { readonly attachmentId: unknown }>(
  events: readonly SessionEvent[],
  type: AttachmentBlockType,
  attachmentId: string,
): Ref | undefined {
  for (const event of events) {
    const found = attachmentInEvent<Ref>(event, type, ref => String(ref.attachmentId) === attachmentId)
    if (found !== undefined) return found
  }
  return undefined
}

function routeServed(ctx: Context, provider: string): boolean {
  return ctx.llm.listProviders().some(entry => entry.id === provider)
}
