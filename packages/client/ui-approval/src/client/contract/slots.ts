import { PendingResult } from '@aeven/client-store'
/** Approval composer and optional correlated-detail contracts. */
import type { ToolCallId } from '@aeven/llm'
import type { SessionId } from '@aeven/session/types'
import type {
  PropsLocale, PropsRenderSlots, PropsRuntime,
} from '@aeven/client-ui-slots'
import type { ApprovalKey } from '../locales.ts'

/* jscpd:ignore-start -- Approval and Question intentionally own independent pending-settlement lifecycles. */
function settlePendingComposer(settle: () => void, failureMessage: string): Promise<void> {
  try {
    settle()
    return Promise.resolve()
  } catch (error) {
    return Promise.reject(error instanceof Error
      ? error
      : new Error(failureMessage, { cause: error }))
  }
}
/* jscpd:ignore-end */

declare module '@aeven/client-ui-session/client' {
  interface SessionPendingInteractionMap {
    /** Pending approval request. */
    approval: PendingApproval
  }
}

declare module '@aeven/client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Approval prompt copy. */
    approval: ApprovalKey
  }

  interface SlotMap {
    /** Optional detail for the Tool call correlated with an approval request. */
    'conversation.approval.detail': {
      kind: 'single'
      scope: 'session'
      owner: ApprovalDetailOwnerProps
    }
  }
}

/** Stable identity handed to an optional approval-detail renderer. */
export interface ApprovalDetailOwnerProps {
  /** Tool call correlated with the request. */
  callId: ToolCallId
}

/** Client-visible fields of an approval request projected through Remote Events. */
export interface ApprovalPresentationRequest {
  /** Tool requesting the decision. */
  readonly toolName: string
  /** Tool call correlated with the request. */
  readonly callId?: ToolCallId
  /** Human-readable reason supplied by the requester. */
  readonly reason?: string
  /** Whether a session grant is offered for this operation. */
  readonly allowSession?: string
  /**
   * What the offered grant covers (mirrors the Host seam's
   * `SessionGrantCoverage`); absent means the requester's own action repeated.
   */
  readonly allowSessionCoverage?: ApprovalSessionCoverage
  /** Cancellation projected from the Host waterfall. */
  readonly signal?: AbortSignal
}

/**
 * What a session grant covers, for the consent copy that explains it:
 * `'account'` reaches other recipients and content, `'sandbox'` other calls
 * that need the same wider access, `'privilege'` other calls that need the
 * same host-privilege elevation, `'action'` the same action again.
 */
export type ApprovalSessionCoverage = 'action' | 'account' | 'sandbox' | 'privilege'

/** Decisions this interactive Client presentation can return. */
export type ApprovalDecision = 'allowed-once' | 'allowed-session' | 'rejected'

let nextApprovalKey = 0

/** One answerable Client presentation of a pending Host waterfall. */
export class PendingApproval extends PendingResult<ApprovalDecision> {
  /** Domain discriminator used by Session pending-interaction consumers. */
  // oxlint-disable-next-line typescript/prefer-as-const -- the Cordis inspector catalog reads the declared literal type
  readonly kind: 'approval' = 'approval'
  /** Opaque render identity and one-shot remount axis. */
  readonly key: string
  /** Tool requesting the decision. */
  readonly toolName: string
  /** Correlated Tool call, when supplied by the asker. */
  readonly callId: ToolCallId | undefined
  /** Human-readable reason supplied by the asker. */
  readonly reason: string | undefined
  /** Whether a session grant is offered for this operation. */
  readonly allowSession: boolean
  /** What the offered grant covers; `'action'` when the requester declared none. */
  readonly sessionCoverage: ApprovalSessionCoverage
  /**
   * @param sessionId - Agent/Session identity owning the scoped request.
   * @param request - Host approval request projected through the Remote Event.
   */
  constructor(readonly sessionId: SessionId, request: ApprovalPresentationRequest) {
    nextApprovalKey += 1
    super(`pending approval approval:${String(nextApprovalKey)}`, request.signal, 'approval request was aborted')
    this.key = `approval:${String(nextApprovalKey)}`
    this.toolName = request.toolName
    this.callId = request.callId
    this.reason = request.reason
    this.allowSession = request.allowSession !== undefined
    this.sessionCoverage = request.allowSessionCoverage ?? 'action'

  }

  /**
   * Resolve the Host waterfall with the user's decision.
   * @param outcome - supported interactive decision.
   */
  answer(outcome: ApprovalDecision): Promise<void> {
    return settlePendingComposer(() => {
      this.resolve(outcome)
    }, 'pending approval settlement failed')
  }


}

/** Full props of the approval composer takeover. */
export type ApprovalComposerProps =
  PropsRuntime<'conversation.composer'>
  & PropsRenderSlots<'conversation.approval.detail'>
  & { matched: PendingApproval }
  & PropsLocale<'approval'>
