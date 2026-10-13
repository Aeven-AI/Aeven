/**
 * Evidence rules for judging recorded executions and deriving procedure status.
 */
import { release } from 'node:os'
import type {
  CapabilityAmendment,
  CapabilityEnvironment,
  CapabilityEvidenceEntry,
  CapabilityExecution,
  CapabilityRecord,
  CapabilityStatus,
  ExecutionVerdict,
  JudgedExecution,
} from './types.ts'

/** Statuses that accept execution evidence, including deliberate candidate validation. */
export const EXECUTABLE_STATUSES: readonly CapabilityStatus[] = ['candidate', 'learned', 'trusted', 'needs-validation', 'degraded']

/** Evidence thresholds of the lifecycle. */
export interface LifecyclePolicy {
  /** Successful executions of the current revision needed to become trusted; at least one must be verified. */
  readonly trustAfter: number
  /** Consecutive failed executions of the current revision that degrade a capability. */
  readonly degradeAfter: number
}

/**
 * The environment this Host process runs in.
 * @returns platform, architecture, and major OS release.
 */
export function currentEnvironment(): CapabilityEnvironment {
  return { platform: process.platform, arch: process.arch, release: release().split('.')[0] ?? '' }
}

function observedSuccess(execution: CapabilityExecution): boolean {
  return execution.endReason === 'completed' && execution.tools.length > 0 && execution.tools.at(-1)?.failed === false
}

/**
 * Judge every execution from its record and later amendments. A correction, a negative rating, a failed
 * report or verification, or a failed turn fails an execution. It is verified when the user rated it
 * positively, or when the model reported a passed verification and at least one tool call it made
 * succeeded; a report alone never verifies. A success report without verification is `succeeded`, and so is
 * an unreported execution observed to succeed: its turn completed, it called tools, and its last tool call
 * did not fail.
 * @param entries - execution log in append order.
 * @returns executions in append order with their verdicts.
 */
export function judge(entries: readonly CapabilityEvidenceEntry[]): JudgedExecution[] {
  const amendments = new Map<string, CapabilityAmendment[]>()
  for (const entry of entries) {
    if (entry.kind === 'execution') continue
    amendments.set(entry.executionId, [...amendments.get(entry.executionId) ?? [], entry])
  }
  return entries.flatMap((entry) => {
    if (entry.kind !== 'execution') return []
    const later = amendments.get(entry.id) ?? []
    const correction = later.findLast(item => item.kind === 'correction')
    const rated = later.findLast(item => item.kind === 'rating')
    const rating = rated?.kind === 'rating' ? rated.rating : undefined
    const report = entry.report
    let verdict: ExecutionVerdict = 'unknown'
    if (correction !== undefined || rating === 'negative' || report?.outcome === 'failed' || report?.validation === 'failed' || entry.endReason === 'error') {
      verdict = 'failed'
    } else if (rating === 'positive' || (report?.outcome === 'succeeded' && report.validation === 'passed' && entry.tools.some(tool => !tool.failed))) {
      verdict = 'verified'
    } else if (report?.outcome === 'succeeded' || (report === undefined && observedSuccess(entry))) {
      verdict = 'succeeded'
    }
    return [{
      execution: entry,
      verdict,
      ...correction?.kind === 'correction' ? { correction: correction.text } : {},
      ...rating === undefined ? {} : { rating },
    }]
  })
}

/**
 * The status a capability's evidence supports; only executions of the current revision count. A candidate
 * becomes learned on its first successful execution and is retired when its first executions all fail.
 * A retired capability only changes by the user's hand.
 * @param record - the capability.
 * @param judged - its judged executions.
 * @param policy - lifecycle thresholds.
 * @returns the supported status and, when it is trusted, the revision it was trusted at.
 */
export function supportedStatus(record: CapabilityRecord, judged: readonly JudgedExecution[], policy: LifecyclePolicy): { status: CapabilityStatus; trustedRevision?: number } {
  if (record.status === 'retired') return { status: record.status }
  const known = judged.filter(item => item.execution.revision === record.revision && item.verdict !== 'unknown')
  const recent = known.slice(-policy.degradeAfter)
  const failing = recent.length === policy.degradeAfter && recent.every(item => item.verdict === 'failed')
  if (record.status === 'candidate') {
    if (failing) return { status: 'retired' }
    return { status: known.some(item => item.verdict === 'verified' || item.verdict === 'succeeded') ? 'learned' : 'candidate' }
  }
  if (failing) return { status: 'degraded' }
  const successes = known.filter(item => item.verdict === 'verified' || item.verdict === 'succeeded')
  if (successes.length >= policy.trustAfter && successes.some(item => item.verdict === 'verified') && known.at(-1)?.verdict !== 'failed') {
    return { status: 'trusted', trustedRevision: record.revision }
  }
  if (record.trustedRevision !== undefined && record.trustedRevision !== record.revision && !successes.some(item => item.verdict === 'verified')) {
    return { status: 'needs-validation' }
  }
  return { status: 'learned' }
}
