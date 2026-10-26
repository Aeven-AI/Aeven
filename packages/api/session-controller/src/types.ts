/** Browser-safe request, result, and lifecycle vocabulary for the Session Remote service. */

import type {
  AttachmentIdType, ImageAttachmentLimits, ImageAttachmentRef, ImageMediaType,
} from '@aeven/attachment'
import type { Branded } from '@aeven/brand'
import type { MessageId } from '@aeven/llm/brand'
import type { ContentBlock } from '@aeven/llm/types'
import type { ChunkRow } from '@aeven/session/chunk-rows'
import type { SessionId, SessionSeq } from '@aeven/session/types'
import type { SessionProjectionMap } from '@aeven/session-projection/types'
import type { JobId } from '@aeven/jobs/brand'
import type { NativeFileApplication } from '@aeven/native-command/types'
import type { JsonValue } from '@aeven/util-values'
import type { WorkspaceId } from '@aeven/workspace/types'

declare module '@aeven/session-projection/types' {
  interface SessionProjectionStateMap {
    /** Host state persisted for cold Session list summaries. */
    sessionListMetadata: SessionListMetadata
    /** Host state for the boot-constant image-limit view. */
    imageLimits: null
    /** Host state for the file-intake view, computed from current reader readiness. */
    fileIntake: null
    /** Durable model selection already used by a request and still pending for a later request. */
    modelSelection: ModelSelectionProjectionState
  }
  interface SessionProjectionMap {
    /** Persisted facts used to summarize a Session without activating it. */
    sessionListMetadata: SessionListMetadata
    /** Image-intake limits enforced by the Session prompt endpoint. */
    imageLimits: ImageAttachmentLimits
    /** File-intake limits and accepted formats enforced by the upload route. */
    fileIntake: FileIntake
    /** Durable model selection already used and selected for the next request. */
    modelSelection: ModelSelectionProjection
  }
}

declare module '@aeven/session/types' {
  interface SessionEventMap {
    /**
     * Complete validated model selection requested for subsequent prompt
     * assembly. Log-only: it never enters derived model history.
     */
    'model/selection': ModelSelection
  }
}

/** Persisted hints used to summarize a cold Session. */
export interface SessionListMetadata {
  /** Whether the folded prefix contains no turn. */
  readonly blank: boolean
  /** Latest human-authored prompt time in the folded prefix. */
  readonly lastPromptAt: number | null
}

/** Every available cached wire value used as partial, possibly stale Session-list hints. */
export interface SessionProjectionHints {
  readonly asOfSeq: number
  /** Provider-validated values present in the cache; omitted keys remain unknown. */
  readonly values: SessionProjectionValues
}

/** Complete projection values at an exact Session event cursor. */
export interface SessionProjectionBaseline {
  readonly asOfSeq: number
  /** Provider-validated values; omitted keys are absent capabilities at this cut. */
  readonly values: SessionProjectionValues
}

/** Typed known projections plus JSON-safe values contributed outside this compilation face. */
export type SessionProjectionValues = Partial<SessionProjectionMap>
  & Readonly<Record<string, SessionProjectionValue>>

/** Browser-submitted prompt content; the Host promotes image bytes and staged file uploads to durable references. */
export type PromptContentPart =
  | { readonly type: 'text'; readonly text: string }
  | {
    readonly type: 'image'
    readonly mediaType: ImageMediaType
    readonly data: string
    readonly name?: string
  }
  | {
    readonly type: 'file'
    /** Single-use identifier returned by the Host upload route. */
    readonly uploadId: string
  }

/** File-intake limits and formats the upload route and prompt admission enforce. */
export interface FileIntake {
  readonly maxFileBytes: number
  readonly maxFilesPerMessage: number
  readonly maxMessageFileBytes: number
  /** Lowercase extensions without the dot accepted by a ready reader. */
  readonly extensions: readonly string[]
  /** Media types accepted by a ready reader. */
  readonly mediaTypes: readonly string[]
}

/** Upload route response after the file and its text are durable and staged. */
export interface FileUploadValue {
  readonly uploadId: string
  readonly name: string
  readonly mediaType: string
  readonly bytes: number
  /** Characters of extracted text. */
  readonly chars: number
  readonly truncated: boolean
  readonly pages?: number
}

/** Upload route failure body. */
export interface FileUploadFailure {
  /** Stable attachment or extraction failure code. */
  readonly code: string
  readonly message: string
}

/** Complete model selection for one Session. */
export interface ModelSelection {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/** Host fold state for durable model selection. */
export interface ModelSelectionProjectionState {
  /** Selection consumed by the latest recorded model request. */
  readonly lastUsed: ModelSelection | null
  /** Later user selection not yet consumed by a matching model request. */
  readonly pending: ModelSelection | null
}

/** Client view of the durable model-selection fold. */
export interface ModelSelectionProjection {
  /** Selection consumed by the latest recorded model request. */
  readonly lastUsed: ModelSelection | null
  /** Selection the next request should use, falling back to {@link lastUsed}. */
  readonly next: ModelSelection | null
}

/** One adapter-owned reasoning effort for an exact model route. */
export interface ModelReasoningEffort {
  readonly id: string
  readonly name: string
  readonly description?: string
}

/** Selectable reasoning metadata for one exact model route. */
export interface ModelReasoning {
  readonly efforts: readonly ModelReasoningEffort[]
  readonly defaultEffort?: string
}

/** One model displayed inside its provider group. */
export interface ModelCatalogModel {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly reasoning?: ModelReasoning
}

/** One provider and its successfully loaded model catalog. */
export interface ModelProviderGroup {
  readonly id: string
  readonly name: string
  readonly models: readonly ModelCatalogModel[]
}

/** One provider whose model catalog lookup failed. */
export interface ModelCatalogFailure {
  readonly id: string
  readonly name: string
  readonly message: string
}

/** Host-generation model catalog and the default used by unconfigured Sessions. */
export interface ModelCatalog {
  readonly default: ModelSelection
  /** Provider routes currently able to serve a request, including empty catalogs. */
  readonly routableProviders: readonly string[]
  readonly groups: readonly ModelProviderGroup[]
  readonly failures: readonly ModelCatalogFailure[]
}

/** One client-requested mutation of a still-pending queue item. */
export type QueueAction =
  | {
    readonly kind: 'edit'
    /** Non-empty text-only replacement content. */
    readonly content: readonly ContentBlock[]
  }
  | { readonly kind: 'remove' }
  | { readonly kind: 'steer' }

/** One Session list entry. */
export interface SessionSummary {
  readonly sessionId: SessionId
  /** Session header creation time, epoch ms. */
  readonly createdAt: number
  readonly updatedAt: number
  readonly running: boolean
  readonly blank: boolean
  readonly parentSessionId?: SessionId
  readonly origin?: 'subagent'
  readonly cwd?: string
  readonly projections?: SessionProjectionHints
}

/** One session-content search result. */
export interface SessionSearchItem {
  readonly sessionId: SessionId
  /** Exact current-surface event containing the ranked match. */
  readonly seq: SessionSeq
  readonly snippet: string
}

/** Maximum number of Sessions returned by one search. */
export const SESSION_SEARCH_RESULT_LIMIT = 20

/** Maximum search snippet length in Unicode code points. */
export const SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS = 240

declare module '@aeven/typert-protocol' {
  interface RemoteErrorDetailsMap {
    'session/model-unavailable': { readonly provider: string; readonly model: string }
    'session/conflict': {
      readonly sessionId: SessionId
      /**
       * The cwd the request asked for, or `null` when it named a workspace that
       * has no directory. `null` rather than an optional property because this
       * is a Remote boundary detail and `undefined` is not JSON.
       */
      readonly requestedCwd: string | null
      readonly existingCwd?: string
    }
    'session/agent-busy': { readonly reason: string }
    'session/invalid-time-zone': { readonly value: string }
    'session/workspace-attach-failed': { readonly sessionId: SessionId; readonly workspaceId: string }
    'agent-preset/conflict': {
      readonly sessionId: SessionId
      readonly requestedPreset: string
      readonly existingPreset?: string
    }
    'session/attachment-invalid': { readonly reason: string }
    'session/queue-item-not-found': { readonly itemId: MessageId }
    'session/steer-unavailable': { readonly itemId: MessageId }
    'session/title-invalid': { readonly sessionId: SessionId }
    'session/label-target-invalid': { readonly sessionId: SessionId }
    'session/search-disabled': Record<string, never>
    'session/fork-unavailable': { readonly sessionId: SessionId }
    /** The Session cannot leave its current place for the named Workspace. */
    'session/move-unavailable': {
      readonly sessionId: SessionId
      readonly reason: 'same-workspace' | 'missing-directory' | 'subagent' | 'managed-workspace'
    }
    /** The edit target is not a current user-authored prompt of the Session. */
    'session/edit-unavailable': { readonly sessionId: SessionId; readonly messageSeq: number }
    /** The Session's latest turn did not end in a failure, or later activity followed it. */
    'session/retry-unavailable': { readonly sessionId: SessionId }
    'subagent/not-found': {
      readonly parentSessionId: SessionId
      readonly childSessionId: SessionId
    }
    'subagent/catalog-diagnostic': {
      readonly parentSessionId: SessionId
      readonly childSessionId: SessionId
      readonly reason: 'corrupt' | 'unsupported' | 'unavailable'
    }
  }
}

/** Session-addressed request for the human-invocable skill catalog. */
export interface SkillListRequest {
  readonly sessionId: SessionId
}

/** One skill available to the Session's human-facing composer. */
export interface SkillEntry {
  /** Kebab-case identifier referenced as `/name`. */
  readonly name: string
  /** Short routing description. */
  readonly description: string
  /** Optional extra routing guidance. */
  readonly whenToUse?: string
  /** Whether the same skill is also advertised to the model. */
  readonly modelInvocable: boolean
}

/** Human-invocable skills visible through one Session's composition. */
export interface SkillListValue {
  readonly skills: readonly SkillEntry[]
}

/** Session list request. */
export interface SessionListRequest {
  readonly cursor?: string
}

/** Session list response value. */
export interface SessionListValue {
  readonly items: readonly SessionSummary[]
}

/** Session search request. */
export interface SessionSearchRequest {
  readonly query: string
}

/** Session search response value. */
export interface SessionSearchValue {
  readonly items: readonly SessionSearchItem[]
  readonly hasMore: boolean
}

/** Session creation or explicit-id adoption request. */
export interface SessionCreateRequest {
  readonly workspaceId?: WorkspaceId
  readonly cwd?: string
  readonly sessionId?: SessionId
  readonly agentPreset?: string
}

/** Session creation response value. */
export interface SessionCreateValue {
  readonly sessionId: SessionId
  readonly agentPreset?: string
}

/** Session model-selection request. */
export interface SessionSelectModelRequest extends ModelSelection {
  readonly sessionId: SessionId
}

/** Accepted model selection after Host resolution. */
export interface SessionSelectModelValue {
  readonly selected: ModelSelection
}

/** Session rename request. */
export interface SessionRenameRequest {
  readonly sessionId: SessionId
  readonly title: string
}

/** Normalized title and the durable event position that committed it. */
export interface SessionRenameValue {
  readonly title: string
  readonly seq: number
}

/** Session bookmark request. */
export interface SessionLabelRequest {
  readonly sessionId: SessionId
  /** The logged point to label. */
  readonly at: number
  /** The label to set; text that normalizes to nothing removes the bookmark at `at`. */
  readonly label: string
}

/** What a label write left at its point. */
export interface SessionLabelValue {
  readonly at: number
  /** The text the point now carries, or `null` when the write removed it. */
  readonly label: string | null
  readonly seq: number
}

/** Session fork request. */
export interface SessionForkRequest {
  readonly sessionId: SessionId
  readonly atSeq?: number
}

/** Identity of a newly forked Session. */
export interface SessionForkValue {
  readonly sessionId: SessionId
}

/** Session move request. */
export interface SessionMoveRequest {
  readonly sessionId: SessionId
  /** Workspace the Session moves into; its directory becomes the Session's cwd. */
  readonly workspaceId: WorkspaceId
}

/** Identity of the Session that replaces the moved one. */
export interface SessionMoveValue {
  readonly sessionId: SessionId
}

/** Session prompt request. */
export interface SessionPromptRequest {
  /** Client-minted identity persisted on the exact accepted user message. */
  readonly requestId: SessionRequestId
  readonly sessionId: SessionId
  readonly mode: 'queue' | 'steer'
  /** At least one non-whitespace text part or attachment. */
  readonly content: readonly PromptContentPart[]
  readonly clientTimeZone?: string
  /** Display name from the browser's restored account profile. */
  readonly clientDisplayName?: string
}

/** Receipt after one prompt enters the target Agent inbox. */
export interface SessionPromptValue {
  readonly accepted: true
}

/** Request to replace one user prompt's text and discard it, with its turn when it opened one, and everything after. */
export interface SessionEditRequest {
  /** Client-minted identity persisted on the replacement user message. */
  readonly requestId: SessionRequestId
  readonly sessionId: SessionId
  /** Event seq of the user-authored `user/message` being edited. */
  readonly messageSeq: number
  /** Replacement text with at least one non-whitespace character; the prompt's attachments are kept. */
  readonly text: string
  readonly clientTimeZone?: string
  /** Display name from the browser's restored account profile. */
  readonly clientDisplayName?: string
}

/** Receipt after the rewind commits and the replacement prompt enters the Agent inbox. */
export interface SessionEditValue {
  readonly accepted: true
  /** Seq of the committed `session/rewind` event. */
  readonly rewindSeq: number
}

/** Request to continue a Session whose latest turn ended in a failure. */
export interface SessionRetryRequest {
  readonly sessionId: SessionId
}

/** Receipt after the continuation notice enters the Agent inbox as the next turn. */
export interface SessionRetryValue {
  readonly accepted: true
}

/** Durable image read request. */
export interface SessionAttachmentRequest {
  readonly sessionId: SessionId
  readonly attachmentId: AttachmentIdType
}

/** Durable image read response value. */
export interface SessionAttachmentValue {
  readonly attachment: ImageAttachmentRef
  readonly data: string
}

/** Pending queue mutation request. */
export interface SessionUpdateQueueRequest {
  readonly sessionId: SessionId
  readonly itemId: MessageId
  readonly action: QueueAction
}

/** Receipt after one pending queue mutation commits. */
export interface SessionUpdateQueueValue {
  readonly accepted: true
}

/** Active-turn cancellation request. */
export interface SessionCancelRequest {
  readonly sessionId: SessionId
}

/** Receipt after cancellation is admitted to the live Agent. */
export interface SessionCancelValue {
  readonly accepted: true
}

/** Request to open one path prepared by a Session-aware caller on the Host desktop. */
export interface SessionOpenWorkspacePathRequest {
  /** File-manager navigation when requested; omission uses the default application. */
  readonly action?: 'reveal'
  /** Registered application identifier; ignored for reveal. Omission preserves the operating system default. */
  readonly application?: string
  /** Path after best-effort Session workspace resolution, in Host filesystem syntax. */
  readonly path: string
}

/** Confirmation that the Host handed a workspace path to its native opener. */
export interface SessionOpenWorkspacePathValue {
  readonly opened: true
}

/** Client-minted prompt identity used to reconcile optimistic and durable messages. */
export type SessionRequestId = Branded<'session-request-id'>

declare module '@aeven/llm' {
  interface MessageSourceMap {
    /** Browser prompt correlation, optional Host-validated time zone, and reported profile name. */
    'user-rpc': { kind: 'user'; rpcId: SessionRequestId; clientTimeZone?: string; clientDisplayName?: string }
  }
}

/** Durable identity selecting an ordinary Session or one direct subagent child. */
export type SessionAddress =
  | { readonly kind: 'session'; readonly sessionId: SessionId }
  | {
    readonly kind: 'subagent'
    readonly parentSessionId: SessionId
    readonly childSessionId: SessionId
    readonly mode: 'one-shot' | 'continuable'
  }

/** One raw Session event in the Remote journal. */
export interface SessionEventEntry {
  readonly type: 'event'
  readonly event: SessionWireEvent
}

/** v0-compatible Session metadata carried on the browser wire. */
export interface SessionWireHeader {
  readonly version: number
  readonly id: SessionId
  readonly createdAt: number
  readonly cwd?: string
  readonly parentSession?: SessionId
  /** Exact inherited prefix length; absent for an unseeded Session. */
  readonly seedLength?: number
  readonly origin?: 'subagent'
  readonly delegationDepth?: number
  readonly agentPreset?: string
}

/** Browser wire form of one Session surface operation. */
export type SessionWireSurfaceOp =
  | 'append'
  | { readonly op: 'replace'; readonly start: number; readonly end: number }

/** Event-shaped wire representation of one packed chunk row. */
export type ChunkRowEvent = {
  [Kind in ChunkRow['type']]: {
    readonly type: `chunkrow/${Kind}`
    readonly seq: number
    readonly time: number
    readonly data: Extract<ChunkRow, { readonly type: Kind }>['data']
  }
}[ChunkRow['type']]

/** One lossless run of consecutive Assistant delta events in a history page. */
export interface SessionChunkRun {
  readonly type: 'chunks'
  readonly event: ChunkRowEvent
}

/** One history-page record: a raw event or a packed Assistant delta run. */
export type SessionHistoryRecord = SessionEventEntry | SessionChunkRun

/** Session event wire form; durable readers own recognition of merge-extensible event names. */
export interface SessionWireEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: JsonValue
  readonly ignorable?: true
  readonly sourceEventSeqs?: number[]
  readonly surfaceOp?: SessionWireSurfaceOp
}

/** One message-aligned history request, backwards by default. */
export interface SessionPageRequest {
  readonly address: SessionAddress
  /** Inclusive log cut obtained from the corresponding follow opening frame. */
  readonly throughSeq: number
  /** Exclusive upper bound; the page ends here and is read backwards. */
  readonly beforeSeq?: number
  /**
   * Exclusive lower bound; the page begins after this seq and is read
   * forwards. Serves a caller holding a window short of the cursor and asking
   * for what follows it. Mutually exclusive with `beforeSeq`.
   */
  readonly afterSeq?: number
  readonly maxMessages?: number
}

/** One live event request for a durable Session address. */
export interface SessionFollowRequest {
  readonly address: SessionAddress
  readonly maxMessages?: number
}

/** One contiguous backwards page of a Session log. */
export interface SessionPage {
  readonly records: readonly SessionHistoryRecord[]
  readonly hasMore: boolean
}

/** Complete opening window followed by ordered events appended after its cursor. */
export type SessionFollowFrame =
  | {
    readonly type: 'snapshot'
    readonly header: SessionWireHeader
    readonly cursor: number
    readonly records: readonly SessionHistoryRecord[]
    readonly hasMore: boolean
    readonly projections: SessionProjectionBaseline
  }
  | SessionEventEntry

/** One pending inbox occurrence in the authoritative queue snapshot. */
export interface SessionQueuedItem {
  readonly id: MessageId
  readonly placement: 'queued' | 'steering' | 'context'
  /** Prompt-RPC identity from the queued message's user source; clients retire the matching local submission echo on it. */
  readonly rpcId?: SessionRequestId
  /** JSON-safe message fields consumed by pending-queue presentation. */
  readonly message: {
    readonly id: MessageId
    readonly content: readonly JsonValue[]
  }
}

/** Browser-safe background-job row. */
export interface SessionJob {
  readonly id: JobId
  readonly kind: string
  readonly label: string
  readonly status: 'running' | 'stopping' | 'completed' | 'killed' | 'failed'
  readonly detail?: string
  readonly startedAt: number
  readonly finishedAt?: number
}

/** Complete live control baseline emitted once per control stream generation. */
export interface SessionControlBaseline {
  readonly queues: Readonly<Record<SessionId, readonly SessionQueuedItem[]>>
  readonly jobs: Readonly<Record<SessionId, readonly SessionJob[]>>
  readonly projections: Readonly<Record<SessionId, SessionProjectionBaseline>>
}

/** One finished projection value and its durable watermark. */
export interface SessionProjectionUpdate {
  readonly sessionId: SessionId
  readonly key: string
  readonly value: JsonValue
  readonly seq: number
}

/** Host-wide live state stream. Each generation starts with exactly one baseline. */
export type SessionControlFrame =
  | { readonly type: 'baseline'; readonly value: SessionControlBaseline }
  | {
    readonly type: 'queue'
    readonly sessionId: SessionId
    readonly items: readonly SessionQueuedItem[]
    /**
     * User-authored messages this splice claimed into a turn (removed without a cancel
     * outcome); each is logged as `user/message` unless its turn ends first.
     */
    readonly claimed?: readonly MessageId[]
  }
  | { readonly type: 'jobs'; readonly sessionId: SessionId; readonly jobs: readonly SessionJob[] }
  | ({ readonly type: 'projection' } & SessionProjectionUpdate)

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A Session became visible to Session list consumers.
     * @mode emit
     * @param summary - initial list row for the Session.
     */
    'api-session/added'(summary: SessionSummary): void
    /**
     * A Session left the live Host registry.
     * @mode emit
     * @param sessionId - removed Session identity.
     */
    'api-session/removed'(sessionId: SessionId): void
    /**
     * One Agent changed running state.
     * @mode emit
     * @param sessionId - Agent and Session identity.
     * @param running - whether the Agent is running.
     */
    'api-session/status'(sessionId: SessionId, running: boolean): void
    /**
     * One user-authored durable message advanced Session list activity.
     * @mode emit
     * @param sessionId - addressed Session identity.
     * @param updatedAt - durable message time used for list ordering.
     */
    'api-session/activity'(sessionId: SessionId, updatedAt: number): void
    /**
     * One Agent failed outside a durable turn position.
     * @mode emit
     * @param sessionId - Agent and Session identity.
     * @param message - user-safe failure chain.
     */
    'api-session/error'(sessionId: SessionId, message: string): void
  }
}

/** JSON-compatible projection value accepted by list consumers. */
export type SessionProjectionValue = JsonValue

/** One image model a provider serves. */
export interface ImageModelEntry {
  /** Provider route id that serves this model; what a request names. */
  provider: string
  /** The provider's model id, verbatim. */
  id: string
  /** Human-readable name where the provider's catalog states one. */
  label?: string
  /** One-line note a selector can show beside the label. */
  description?: string
}

/** Every image model this deployment can reach, in provider registration order. */
export interface ImageModelCatalog {
  /** The models, in provider registration order; empty where no media seam is composed. */
  models: ImageModelEntry[]
}

/** Every video model this deployment can reach, in provider registration order. */
export interface VideoModelCatalog {
  /** The models, in the image catalog's entry shape; empty where no media seam is composed. */
  models: ImageModelEntry[]
}

/** Application metadata returned by the serving desktop for one file. */
export type SessionWorkspacePathApplication = NativeFileApplication
