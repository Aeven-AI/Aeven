/**
 * Evidence rules of the capability lifecycle: how one execution is judged, which status a capability's
 * executions support, and what a non-trusted capability tells the model when it is loaded.
 */
import { release } from 'node:os'
import type {
  CapabilityAmendment,
  CapabilityEnvironment,
  CapabilityEvidenceEntry,
  CapabilityRecord,
  CapabilityStatus,
  ExecutionVerdict,
  JudgedExecution,
} from './types.ts'

/** Statuses published through the skill catalog. */
export const EXECUTABLE_STATUSES: readonly CapabilityStatus[] = ['learned', 'trusted', 'needs-validation', 'degraded']

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

function sameEnvironment(a: CapabilityEnvironment, b: CapabilityEnvironment): boolean {
  return a.platform === b.platform && a.arch === b.arch && a.release === b.release
}

/**
 * Judge every execution from its record and later amendments. A correction, a negative rating, a failed
 * report or verification, or a failed turn fails an execution. It is verified when the user rated it
 * positively, or when the model reported a passed verification and at least one tool call it made
 * succeeded; a report alone never verifies. A success report without verification is `succeeded`.
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
    } else if (report?.outcome === 'succeeded') {
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
 * The status a capability's evidence supports. Candidates and retired capabilities only change by the
 * user's hand; for the rest only executions of the current revision count.
 * @param record - the capability.
 * @param judged - its judged executions.
 * @param policy - lifecycle thresholds.
 * @returns the supported status and, when it is trusted, the revision it was trusted at.
 */
export function supportedStatus(record: CapabilityRecord, judged: readonly JudgedExecution[], policy: LifecyclePolicy): { status: CapabilityStatus; trustedRevision?: number } {
  if (record.status === 'candidate' || record.status === 'retired') return { status: record.status }
  const known = judged.filter(item => item.execution.revision === record.revision && item.verdict !== 'unknown')
  const recent = known.slice(-policy.degradeAfter)
  if (recent.length === policy.degradeAfter && recent.every(item => item.verdict === 'failed')) return { status: 'degraded' }
  const successes = known.filter(item => item.verdict === 'verified' || item.verdict === 'succeeded')
  if (successes.length >= policy.trustAfter && successes.some(item => item.verdict === 'verified') && known.at(-1)?.verdict !== 'failed') {
    return { status: 'trusted', trustedRevision: record.revision }
  }
  if (record.trustedRevision !== undefined && record.trustedRevision !== record.revision && !successes.some(item => item.verdict === 'verified')) {
    return { status: 'needs-validation' }
  }
  return { status: 'learned' }
}

/**
 * Evidence note shown above a loaded procedure that is not plainly trustworthy here; empty otherwise.
 * @param record - the capability.
 * @param judged - its judged executions.
 * @param environment - where it is about to run.
 * @returns a short note, or an empty string.
 */
export function evidenceNote(record: CapabilityRecord, judged: readonly JudgedExecution[], environment: CapabilityEnvironment): string {
  const report = 'Report the outcome with capability_manage (action "report") when you are done.'
  if (record.status === 'degraded') {
    const failures = judged.filter(item => item.execution.revision === record.revision && item.verdict === 'failed').slice(-3)
    const reasons = failures.map(item => item.correction ?? item.execution.report?.notes).filter((reason): reason is string => Boolean(reason))
    return `> Status: degraded. Recent runs of this procedure failed${reasons.length > 0 ? `: ${reasons.map(reason => reason.slice(0, 200)).join(' / ')}` : '.'} Verify each step before relying on it, fix the procedure if a step is wrong, and ${report.charAt(0).toLowerCase()}${report.slice(1)}`
  }
  if (record.status === 'needs-validation') {
    return `> Status: needs validation. This procedure changed after it was last verified. Run its verification step. ${report}`
  }
  const successes = judged.filter(item => item.verdict === 'verified' || item.verdict === 'succeeded')
  if (successes.length > 0 && !successes.some(item => sameEnvironment(item.execution.environment, environment))) {
    return `> This procedure has not yet succeeded on ${environment.platform} ${environment.arch} (release ${environment.release}). Verify each step here. ${report}`
  }
  return ''
}
