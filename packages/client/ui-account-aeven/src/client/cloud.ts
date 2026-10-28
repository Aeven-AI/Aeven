/**
 * Response fields of the Aeven `/api/cloud` account routes the Account section
 * reads, and the one way this client leaves for an external page.
 *
 * Money travels as USD micros; the section formats it and never computes a
 * price, because the API decides what is charged.
 */

/** A billing period; both instants are ISO strings and `endsAt` is exclusive. */
export interface BillingPeriod {
  readonly id: string
  readonly startsAt: string
  readonly endsAt: string
}

/** `GET /api/cloud/usage`. */
export interface CloudUsage {
  readonly plan: string
  readonly planName: string
  readonly status: string
  readonly billingPeriod: BillingPeriod & { readonly renews: boolean }
  readonly usage: {
    readonly tokens: number
    readonly inputTokens: number
    readonly outputTokens: number
    readonly reasoningTokens: number
    readonly cacheHitInputTokens: number
    readonly requests: number
  }
  /** Proportion of the period's plan allowance consumed, 0–100. */
  readonly allowance: { readonly usedPercent: number; readonly remainingPercent: number }
  /** Purchased credit, the only balance the reader holds. */
  readonly balance: { readonly purchasedUsdMicros: number; readonly currency: string }
  /** The remedies this deployment can carry out. */
  readonly actions: readonly ('add_balance' | 'upgrade_subscription')[]
}

/** `GET /api/cloud/subscription`. */
export interface CloudSubscription {
  readonly plan: string
  readonly planName: string
  readonly description?: string
  readonly status: string
  readonly renews: boolean
  /** Monthly price, or null for a plan that is not sold. */
  readonly price: { readonly monthlyUsdMicros: number; readonly currency: string } | null
  readonly billingPeriod: BillingPeriod
  /** Whether a Stripe subscription holds the plan, so it is changed rather than bought. */
  readonly managed: boolean
  /** Whether the subscription ends at the period end. */
  readonly cancelAtPeriodEnd: boolean
  /** The plan a scheduled downgrade moves to, and when. */
  readonly pendingPlan: { readonly id: string; readonly name: string; readonly startsAt: string } | null
}

/** One plan of `GET /api/cloud/plans`, cheapest first. */
export interface CloudPlan {
  readonly id: string
  readonly name: string
  readonly description?: string
  /** Monthly price, or null for the free plan. */
  readonly price: { readonly monthlyUsdMicros: number; readonly currency: string } | null
  /** Whether a plan picker should lead with this plan. */
  readonly recommended: boolean
}

/** `GET /api/cloud/plans`. */
export interface CloudPlans {
  /** Whether choosing a plan can start a payment on this deployment. */
  readonly subscriptionsEnabled: boolean
  readonly plans: readonly CloudPlan[]
}

/** `POST /api/cloud/subscription/checkout`. */
export interface SubscriptionCheckout {
  readonly checkoutUrl: string
}

/** `POST /api/cloud/billing/portal`. */
export interface BillingPortal {
  readonly portalUrl: string
}

/** Statement line types the API writes. */
export type WalletTransactionType = 'monthly_allowance' | 'topup' | 'inference' | 'refund' | 'adjustment'

/** One statement line of `GET /api/cloud/wallet`. */
export interface WalletTransaction {
  readonly type: WalletTransactionType
  readonly amountUsdMicros: number
  readonly topUpDeltaUsdMicros: number
  readonly currency: string
  readonly createdAt: string
}

/** `GET /api/cloud/wallet`. */
export interface CloudWallet {
  readonly currency: string
  readonly balance: { readonly purchasedUsdMicros: number; readonly currency: string }
  readonly transactions: readonly WalletTransaction[]
}

/**
 * What one payment was made of. Every part is optional: a top-up from before the charge
 * was recorded knows only its credit, and a plan invoice has a plan part instead.
 */
export interface PaymentBreakdown {
  /** Credit added to the wallet. */
  readonly creditUsdMicros?: number
  /** The processing fee charged with a top-up. */
  readonly feeUsdMicros?: number
  /** The plan, before tax. */
  readonly planUsdMicros?: number
  /** VAT. */
  readonly taxUsdMicros?: number
}

/**
 * One line of `GET /api/cloud/payments`: money the reader paid.
 *
 * A `credit` line is purchased credit from the wallet; a `subscription` line is a plan
 * invoice Stripe collected. Both are money in, which is why one list holds them.
 * `amountUsdMicros` is what was charged, fee and VAT included; `breakdown` holds the
 * parts, and is absent from servers that predate it.
 */
export type CloudPayment =
  | {
    readonly kind: 'credit'
    readonly type: 'topup' | 'refund' | 'adjustment'
    readonly amountUsdMicros: number
    readonly currency: string
    readonly createdAt: string
    readonly breakdown?: PaymentBreakdown | null
  }
  | {
    readonly kind: 'subscription'
    readonly type: null
    readonly amountUsdMicros: number
    readonly currency: string
    readonly createdAt: string
    readonly breakdown?: PaymentBreakdown | null
  }

/** `GET /api/cloud/payments`. */
export interface CloudPayments {
  readonly currency: string
  /** Newest first. */
  readonly payments: readonly CloudPayment[]
}

/** One purchasable preset. */
export interface TopUpPreset {
  readonly id: string
  readonly label: string
  readonly amountUsdMicros: number
}

/** `GET /api/cloud/topup/options`; bounds are absent when nothing is for sale. */
export type TopUpOptions =
  | { readonly enabled: false; readonly currency: null; readonly presets: readonly [] }
  | {
    readonly enabled: true
    readonly currency: string
    readonly minUsdMicros: number
    readonly maxUsdMicros: number
    readonly presets: readonly TopUpPreset[]
  }

/** `POST /api/cloud/topup/checkout`. */
export interface TopUpCheckout {
  readonly checkoutUrl: string
  readonly amountUsdMicros: number
  readonly currency: string
}

/** Micros in one US dollar. */
export const MICROS_PER_USD = 1_000_000
