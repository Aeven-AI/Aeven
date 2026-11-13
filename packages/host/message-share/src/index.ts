/**
 * Public links to shared assistant messages.
 *
 * The `messageShare` Remote publishes one finalized assistant message, without the prompt
 * that led to it, to the Aeven API, which serves it at a public URL; lists the
 * signed-in account's links; and deletes them. The snapshot is built here from the
 * persisted Session log, never from text a browser sends, and every API call carries the
 * signed-in user's own Aeven access token, so links are filed per account.
 * @module @aeven/host-message-share
 */

import type {} from '@aeven/attachment'
import type {} from '@aeven/identity-user'
import type {} from '@aeven/workspace'
import { Buffer } from 'node:buffer'
import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { credentialRef, type CredentialRef } from '@aeven/credentials'
import type { MessageId } from '@aeven/llm/brand'
import type { SessionInspection } from '@aeven/session-persistence'
import type { SessionId } from '@aeven/session/types'
import { TypertRemoteService, Remote } from '@aeven/typert-protocol'
import { ShareApi, ShareApiError } from './api.ts'
import { buildSnapshot, findShareTarget, responseText, type ShareTarget } from './snapshot.ts'
import type {
  MessageShareCreateRequest,
  MessageShareDeleteAllValue,
  MessageShareDeleteRequest,
  MessageShareDeleteValue,
  MessageShareFailureCode,
  MessageShareLink,
  MessageShareListRequest,
  MessageShareListValue,
  MessageSharePreview,
  MessageShareRejected,
  MessageShareResult,
} from './types.ts'

export type * from './types.ts'

/** Deployment settings. */
export interface Config {
  /** Aeven API origin that stores and serves share links, such as `https://api.aeven.io`. */
  readonly apiUrl: string
  /** Credential holding each user's Aeven access token. */
  readonly credentialRef: string
  /** Budget for one API call, in milliseconds. */
  readonly timeoutMs: number
  /** Path prefix of the workspace-files route, so a Markdown image served from it is published; absent when that route is not mounted. */
  readonly workspaceMount?: string
  /** Images one share carries at most; the Aeven API's own ceiling must be at least this. */
  readonly maxImages: number
  /** Largest image one share carries, in bytes; the Aeven API's own ceiling must be at least this. */
  readonly maxImageBytes: number
  /** Pixel budget an image content block is scaled down to before it is sent. */
  readonly imageMaxPixels: number
  /** Encoded size an image content block is compressed toward before it is sent, in bytes. */
  readonly imageTargetBytes: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    messageShare: MessageShareService
  }
}

/** Build a frozen refusal. */
function rejected(code: MessageShareFailureCode): MessageShareRejected {
  return Object.freeze({ ok: false, error: Object.freeze({ code }) })
}

/** Reject a non-HTTPS origin outside loopback and an origin with embedded credentials. */
function endpoint(value: string): string {
  const url = new URL(value)
  if (url.username || url.password || url.hash
    || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('message-share: apiUrl requires HTTPS, or HTTP on loopback, without embedded credentials')
  }
  return url.href
}

/** Validate the workspace-files prefix: absolute, without a trailing slash. */
function mountPath(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  if (!value.startsWith('/') || value.endsWith('/')) {
    throw new Error(`message-share: workspaceMount "${value}" must start with "/" and must not end with "/"`)
  }
  return value
}

/**
 * Remote service behind the share button and the link manager. It reads persisted
 * Session history and never creates or resumes an Agent or Session.
 */
export class MessageShareService extends TypertRemoteService {
  static inject = ['sessionPersistence', 'sessions', 'credentials', 'identityUsers']

  /** Loader validation for the deployment settings. */
  static Config: s<Config> = s.object({
    apiUrl: s.string().required(),
    credentialRef: s.string().default('AEVEN_TOKEN'),
    timeoutMs: s.natural().min(1).default(60_000),
    workspaceMount: s.string(),
    maxImages: s.natural().default(8),
    maxImageBytes: s.natural().min(1).default(4 * 1024 * 1024),
    imageMaxPixels: s.natural().min(1).default(1600 * 1600),
    imageTargetBytes: s.natural().min(1).default(400 * 1024),
  })

  private readonly api: ShareApi
  private readonly ref: CredentialRef
  private readonly workspaceMount: string | undefined

  /**
   * @param ctx - Host context carrying Session persistence, credentials, and identity.
   * @param config - validated deployment settings.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'messageShare')
    this.ref = credentialRef(config.credentialRef)
    this.workspaceMount = mountPath(config.workspaceMount)
    this.api = new ShareApi({
      apiUrl: endpoint(config.apiUrl),
      timeoutMs: config.timeoutMs,
      sessionToken: async owner => (await this.ctx.credentials.resolve(this.ref, owner).catch(() => undefined))?.value,
    })
  }

  /** Nothing to open: links live on the Aeven API. */
  protected [Service.init](): void {}

  /**
   * Publish one finalized assistant message, or refresh the snapshot behind the link the
   * message already has.
   * @param request - Session and message to share.
   * @returns the link, or why it was refused.
   */
  @Remote('create')
  async create(request: MessageShareCreateRequest): Promise<MessageShareResult<MessageShareLink>> {
    const located = await this.locate(request)
    if ('ok' in located) return located
    const { owner, inspection, target } = located
    const attachments = this.ctx.get('attachments')
    const workspaces = this.ctx.get('workspaceRegistry')
    const snapshot = await buildSnapshot(target, {
      cwd: inspection.meta.cwd,
      workspaceRoots: workspaces?.list().map(workspace => workspace.path).filter((path): path is string => path !== undefined) ?? [],
      workspaceMount: this.workspaceMount,
      workspaceRoot: id => workspaces?.list().find(workspace => workspace.id === id)?.path,
      readAttachment: async (ref) => {
        if (attachments === undefined) return undefined
        // The share-size copy keeps the request small; a store that cannot derive one sends the stored image.
        const budget = { maxPixels: this.config.imageMaxPixels, maxBytes: this.config.imageTargetBytes }
        const scaled = await attachments.readImageRequest(ref, budget).catch(() => undefined)
        if (scaled !== undefined) return { mediaType: scaled.mediaType, data: scaled.data }
        return { mediaType: ref.mediaType, data: (await attachments.readImage(ref)).data }
      },
      maxImages: this.config.maxImages,
      maxImageBytes: this.config.maxImageBytes,
    })
    if (snapshot.response.trim() === '') return rejected('target-not-found')
    return await this.settle(() => this.api.create(owner, request, snapshot))
  }

  /**
   * Draw the card the message's link unfurls with, before any link exists; nothing is stored.
   * @param request - Session and message to preview.
   * @returns the PNG, or why it was refused.
   */
  @Remote('preview')
  async preview(request: MessageShareCreateRequest): Promise<MessageShareResult<MessageSharePreview>> {
    const located = await this.locate(request)
    if ('ok' in located) return located
    const text = responseText(located.target)
    if (text.trim() === '') return rejected('target-not-found')
    return await this.settle(async () => Object.freeze({
      mediaType: 'image/png' as const,
      data: Buffer.from(await this.api.card(located.owner, request, text)).toString('base64'),
    }))
  }

  /**
   * Read one page of the signed-in account's links, newest first.
   * @param request - the previous page's cursor, if any.
   * @returns the page, or why it was refused.
   */
  @Remote('list')
  async list(request: MessageShareListRequest): Promise<MessageShareResult<MessageShareListValue>> {
    const owner = this.owner()
    if (owner === undefined) return rejected('signed-out')
    return await this.settle(() => this.api.list(owner, request.cursor))
  }

  /**
   * Delete one of the signed-in account's links; its public page then says the link no longer exists.
   * @param request - the link to delete.
   * @returns the removal, or why it was refused.
   */
  @Remote('delete')
  async delete(request: MessageShareDeleteRequest): Promise<MessageShareResult<MessageShareDeleteValue>> {
    const owner = this.owner()
    if (owner === undefined) return rejected('signed-out')
    return await this.settle(async () => {
      await this.api.remove(owner, request.shareId)
      return Object.freeze({ removed: true as const })
    })
  }

  /**
   * Delete every link of the signed-in account.
   * @returns how many links were deleted, or why it was refused.
   */
  @Remote('deleteAll')
  async deleteAll(): Promise<MessageShareResult<MessageShareDeleteAllValue>> {
    const owner = this.owner()
    if (owner === undefined) return rejected('signed-out')
    return await this.settle(async () => Object.freeze({ removed: await this.api.removeAll(owner) }))
  }

  /**
   * The acting account, the Session it may read, and the finalized message in it.
   * @returns them, or the refusal when one is missing.
   */
  private async locate(request: MessageShareCreateRequest): Promise<
    { readonly owner: string; readonly inspection: SessionInspection; readonly target: ShareTarget } | MessageShareRejected
  > {
    const owner = this.owner()
    if (owner === undefined) return rejected('signed-out')
    const inspection = await this.inspectSession(request.sessionId)
    if (inspection === undefined) return rejected('session-not-found')
    const target = await this.findTarget(inspection, request.messageId)
    if (target === undefined) return rejected('target-not-found')
    return { owner, inspection, target }
  }

  /** The signed-in account acting on this call. */
  private owner(): string | undefined {
    return this.ctx.identityUsers.actingUser()?.id
  }

  /** Run one API call, mapping its refusal into the result union. */
  private async settle<T>(call: () => Promise<T>): Promise<MessageShareResult<T>> {
    try {
      return Object.freeze({ ok: true, value: await call() })
    } catch (error) {
      if (error instanceof ShareApiError) return rejected(error.code)
      this.ctx.logger('message-share').warn(`share call failed: ${error instanceof Error ? error.message : String(error)}`)
      return rejected('unavailable')
    }
  }

  /**
   * Inspect a persisted Session the acting user may read.
   * @returns the inspection, or undefined when the Session is absent or another account's.
   */
  private async inspectSession(sessionId: SessionId): Promise<SessionInspection | undefined> {
    if (this.ctx.sessions.get(sessionId) === undefined && await this.ctx.sessionPersistence.snapshot(sessionId) === undefined) {
      return undefined
    }
    const inspection = await this.ctx.sessionPersistence.inspect(sessionId)
    return this.ctx.identityUsers.mayAccess(inspection.meta.owner) ? inspection : undefined
  }

  /**
   * Find the message in the persisted log; a live Session is flushed first when the
   * message has not reached storage yet.
   */
  private async findTarget(inspection: SessionInspection, messageId: MessageId): Promise<ShareTarget | undefined> {
    const found = findShareTarget(inspection.events, messageId)
    if (found !== undefined) return found
    const live = this.ctx.sessions.get(inspection.meta.id)
    if (live === undefined || !(await this.ctx.sessions.flush(live))) return undefined
    return findShareTarget((await this.ctx.sessionPersistence.inspect(inspection.meta.id)).events, messageId)
  }
}

export default MessageShareService
