/**
 * Provider-neutral subscription usage projection shared by every usage reader.
 *
 * Each provider reports quota differently — Codex returns used-percent windows
 * plus a credit count, Claude returns three utilization buckets, Grok returns a
 * single billing period plus a prepaid cent balance — so every reader
 * normalizes into the one shape the Settings card renders.
 *
 * Two conventions are fixed here because the card compares providers
 * side by side:
 * - Percentages are **remaining**, floored. Both upstream clients floor their
 *   own display (Grok to match the backend spending limiter's `as u8`
 *   truncation), so 99.994% used reads as `1%` remaining rather than `0%`.
 * - `resetsAt` is always epoch **seconds**. Codex reports epoch seconds
 *   already; Claude and Grok report RFC 3339 strings.
 *
 * @module @aeven/subscription-auth/usage-view
 */

/**
 * Whether the signed-in account may use this provider's subscription models.
 *
 * A free account is not an error: every provider answers its usage request
 * successfully and simply reports nothing to meter, and Grok additionally
 * serves a capped free allowance. The card needs these apart because they are
 * different answers to "why did my model call fail".
 */
export type UsageEntitlement =
	/** Quota windows resolved; the subscription covers this provider. */
	| 'entitled'
	/** The call succeeded but the plan carries no metered subscription quota. */
	| 'no-subscription'
	/** The provider refused: no entitlement, or a server-side access gate. */
	| 'not-entitled'
	/** The provider directs quota questions elsewhere (Grok's billing redirect). */
	| 'redirected'
	/** Not yet determined — no successful read since sign-in. */
	| 'unknown'

/**
 * Which quota window a bar describes. The client owns the visible wording;
 * this names the window so a provider cannot ship untranslated copy.
 * `custom` defers to {@link UsageWindow.labelText}.
 */
export type UsageWindowLabel =
	| 'fiveHour'
	| 'weekly'
	| 'weeklyOpus'
	| 'monthly'
	| 'session'
	| 'codeReview'
	| 'usage'
	| 'custom'

/** One metered quota window. */
export interface UsageWindow {
  /** Stable per-provider window id; the React key and the test anchor. */
  readonly id: string
  /** Which window this is, resolved to visible copy by the client. */
  readonly label: UsageWindowLabel
  /** Provider-supplied name, used only when `label` is `custom`. */
  readonly labelText?: string
  /** Quota left, 0-100, floored. */
  readonly remainingPercent: number
  /** When the window rolls over, epoch seconds. */
  readonly resetsAt?: number
}

/**
 * Spending headroom beyond the plan allowance.
 *
 * `kind` exists because the unit is not comparable across providers: Codex
 * reports a credit count, Grok a prepaid balance in USD cents. Formatting one
 * as the other would misstate the amount by two orders of magnitude.
 */
export type UsageCredits =
  | {
    /** A bare credit count. */
    readonly kind: 'count'
    /** Remaining credits; always non-negative. */
    readonly remaining: number
    /** Plan carries no cap. `remaining` is then not meaningful. */
    readonly unlimited?: boolean
  }
  | {
    /** An amount of money in the provider's billing currency. */
    readonly kind: 'money'
    /** ISO 4217 code the provider bills in. */
    readonly currency: string
    /** Remaining amount in the currency's minor unit (cents for USD); always non-negative. */
    readonly remaining: number
    /** No spend cap applies. `remaining` is then not meaningful. */
    readonly unlimited?: boolean
  }

/**
 * Which product a share of the usage pool belongs to. The client owns the
 * wording; `custom` defers to {@link UsageBreakdownEntry.labelText} for a
 * product this build does not know by name.
 */
export type UsageProductLabel = 'grokBuild' | 'chat' | 'imagine' | 'custom'

/**
 * One product's share of a pooled allowance, in percent of the whole pool.
 * The shares sum to the pool's used percentage, not to 100.
 */
export interface UsageBreakdownEntry {
  readonly id: string
  readonly label: UsageProductLabel
  readonly labelText?: string
  /** Share of the pool this product consumed, 0-100, floored. */
  readonly usedPercent: number
}

/** Provider-authored access-gate copy, passed through verbatim. */
export interface UsageGate {
  /** The provider's own explanation. Never replaced with wording of ours. */
  readonly message?: string
  readonly url?: string
  readonly label?: string
}

/** One provider's complete usage answer. */
export interface ProviderUsage {
  readonly entitlement: UsageEntitlement
  readonly windows: readonly UsageWindow[]
  readonly credits?: UsageCredits
  /** Per-product shares of the pooled allowance in `windows`, where the provider reports them; the pool is its only window. */
  readonly breakdown?: readonly UsageBreakdownEntry[]
  /** Plan name as the provider spells it ("Pro", "SuperGrok Heavy", "Free"). */
  readonly tier?: string
  /** Present when `entitlement` is `not-entitled` and the provider explained why. */
  readonly gate?: UsageGate
  /** Present when `entitlement` is `redirected`. */
  readonly redirectUrl?: string
  /** When this projection was produced, epoch milliseconds. */
  readonly fetchedAt: number
}

/**
 * Convert a used-percentage into the floored remaining percentage.
 * @param usedPercent - percentage already consumed, any finite number.
 * @returns remaining percent clamped to 0-100 and floored.
 */
export function remainingFromUsed(usedPercent: number): number {
  if (!Number.isFinite(usedPercent)) return 0
  const used = Math.min(100, Math.max(0, usedPercent))
  return Math.max(0, 100 - Math.floor(used))
}

/**
 * Convert an RFC 3339 timestamp into epoch seconds.
 * @param value - timestamp string, or anything else.
 * @returns epoch seconds, or undefined when the value is not a usable instant.
 */
export function epochSecondsFromRfc3339(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return undefined
  const seconds = Math.floor(parsed / 1000)
  return seconds > 0 ? seconds : undefined
}

/**
 * Whether a projection carries anything worth rendering as a bar or balance.
 * Drives the card's choice between the meters and an explanatory state.
 * @param usage - the projection to inspect.
 * @returns true when at least one window or a credit balance is present.
 */
export function hasMeteredUsage(usage: ProviderUsage): boolean {
  return usage.windows.length > 0 || usage.credits !== undefined
}

/**
 * Build the projection for a provider that answered but metered nothing.
 * @param fetchedAt - epoch milliseconds of the answering read.
 * @param tier - plan name when the provider reported one.
 * @returns a `no-subscription` projection.
 */
export function noSubscriptionUsage(fetchedAt: number, tier?: string): ProviderUsage {
  return { entitlement: 'no-subscription', windows: [], fetchedAt, ...(tier === undefined ? {} : { tier }) }
}
