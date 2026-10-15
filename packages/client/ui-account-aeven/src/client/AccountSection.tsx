/** The Account settings page: who is signed in, the plans, their credits, and this period's usage. */
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  Button, IconCheckOutline14, IconChevronDownOutline14, IconRightUpOutline16, LoadingBlock, SectionHeader, Spinner,
} from '@aeven/client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import { MfaForm } from '@aeven/client-ui-primitives'
import type { AevenReader } from '@aeven/client-ui-auth-aeven'
import { Avatar } from './Avatar.tsx'
import type { AccountReader } from './AccountMenu.tsx'
import {
  externalWindow, MICROS_PER_USD,
  type BillingPortal, type CloudPlan, type CloudPlans, type CloudSubscription, type CloudUsage, type CloudWallet,
  type SubscriptionCheckout, type TopUpCheckout, type TopUpOptions, type WalletTransaction,
} from './cloud.ts'
import type { AccountAevenKey, NS } from './locales.ts'
import css from './AccountSection.module.css'
import '../vendor/aeven-account.css'

/** Registration-side face of the Account section. */
export interface AccountSectionInjected {
  /** The signed-in reader, or undefined when nobody is. */
  reader: () => AccountReader | undefined
  /** Authenticator enrollment and account protection operations. */
  mfa: AevenReader['mfa']
  /** End the Aeven session and return the reader to the sign-in screen. */
  signOut: () => void
  /**
   * Call one of Aeven's `/api/cloud` account routes as the reader.
   * @param path - the route below `/api/cloud`.
   * @param init - method and body.
   * @returns the decoded response body.
   */
  cloud: <T>(path: string, init?: RequestInit) => Promise<T>
  /**
   * The last accepted answer for a route this page already read.
   * @param path - the route below `/api/cloud`.
   * @returns that answer, or undefined when the route has not settled yet.
   */
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- a caller asserts the route's response type through T
  cached: <T>(path: string) => T | undefined
}

/** Full component props assembled by the slot renderer. */
export type AccountSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<typeof NS>
  & InjectFace<AccountSectionInjected>

type Translate = AccountSectionProps['t']
type Load<T> = { readonly status: 'loading' } | { readonly status: 'error' } | { readonly status: 'ready'; readonly value: T }

/**
 * Feature lines per plan id. The plans, prices, and the recommended tier come from
 * `/plans`; the copy describing them is this client's, so it stays translated. A plan
 * the client does not know shows its server description instead.
 */
const FEATURES: Readonly<Record<string, readonly AccountAevenKey[]>> = {
  free: ['plan.feature.models', 'plan.feature.preview'],
  pro: ['plan.feature.models', 'plan.feature.allowance', 'plan.feature.credits'],
  heavy: ['plan.feature.everythingPro', 'plan.feature.allowance', 'plan.feature.multiple'],
  superheavy: ['plan.feature.everythingHeavy', 'plan.feature.allowance', 'plan.feature.multiple'],
}

/** The plan every account without a subscription is on. */
const FREE_PLAN = 'free'

/** Allowance use at which the page suggests upgrading. */
const NUDGE_PERCENT = 80

/** The allowance bar reads the percentage it fills from a row-local property. */
type MeterStyle = CSSProperties & { readonly '--avn-usage-percent': string }

/** Statement lines that are payments rather than per-request charges. */
const PAYMENT_LABEL: Partial<Record<WalletTransaction['type'], AccountAevenKey>> = {
  topup: 'activity.topup',
  refund: 'activity.refund',
  adjustment: 'activity.adjustment',
}

function money(micros: number, currency: string, whole = false): string {
  const amount = micros / MICROS_PER_USD
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    ...whole && Number.isInteger(amount) ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {},
  }).format(amount)
}

function count(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function planName(plan: CloudPlan, t: Translate): string {
  return plan.id === FREE_PLAN ? t('plan.free') : plan.name
}

function priceOf(plan: CloudPlan): number {
  return plan.price?.monthlyUsdMicros ?? 0
}

/**
 * Load one account route and keep its latest outcome. The page's own cache
 * seeds the first state, so a revisit paints that answer and re-reads behind it
 * instead of showing the spinner again.
 * @param cloud - the account face's route reader.
 * @param cached - the account face's last-answer reader.
 * @param path - the route below `/api/cloud`.
 * @returns the outcome, a reload that shows the spinner, and a quiet refresh that does not.
 */
function useLoad<T>(
  cloud: AccountSectionInjected['cloud'],
  cached: AccountSectionInjected['cached'],
  path: string,
): { state: Load<T>; reload: () => void; refresh: () => Promise<T | undefined> } {
  const [state, setState] = useState<Load<T>>(() => {
    const value = cached<T>(path)
    return value === undefined ? { status: 'loading' } : { status: 'ready', value }
  })
  const live = useRef(true)
  const refresh = useCallback(async () => {
    try {
      const value = await cloud<T>(path)
      if (live.current) setState({ status: 'ready', value })
      return value
    } catch {
      // The failure is shown as the row's error state with a retry.
      if (live.current) setState(current => current.status === 'ready' ? current : { status: 'error' })
      return undefined
    }
  }, [cloud, cached, path])
  const reload = useCallback(() => {
    setState({ status: 'loading' })
    void refresh()
  }, [refresh])
  useEffect(() => {
    live.current = true
    void refresh()
    return () => { live.current = false }
  }, [refresh])
  return { state, reload, refresh }
}

/**
 * Render the Account section.
 * @param props - composed slot props and the account face.
 * @returns the section element tree.
 */
export function AccountSection(props: AccountSectionProps) {
  const { t, cloud, cached } = props
  const usage = useLoad<CloudUsage>(cloud, cached, '/usage')
  const subscription = useLoad<CloudSubscription>(cloud, cached, '/subscription')
  const options = useLoad<TopUpOptions>(cloud, cached, '/topup/options')
  const wallet = useLoad<CloudWallet>(cloud, cached, '/wallet')
  const plans = useLoad<CloudPlans>(cloud, cached, '/plans')
  const refreshPlan = useCallback(async () => {
    void usage.refresh()
    return subscription.refresh()
  }, [usage.refresh, subscription.refresh])
  // Billing changes happen in other windows — Stripe checkout, the billing
  // portal — so returning to the app is when the plan, balance, or payment
  // state may have moved. Each return re-reads them quietly.
  useEffect(() => {
    const reread = () => {
      void subscription.refresh()
      void usage.refresh()
      void wallet.refresh()
    }
    const onVisible = () => { if (document.visibilityState === 'visible') reread() }
    window.addEventListener('focus', reread)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', reread)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [subscription.refresh, usage.refresh, wallet.refresh])
  const refreshBalance = useCallback(async () => {
    void wallet.refresh()
    return (await usage.refresh())?.balance.purchasedUsdMicros
  }, [usage.refresh, wallet.refresh])

  // The page appears in one step. The four routes settle independently, and
  // letting each group swap its loading row for its own content as that route
  // landed moved every group below it — the plan grid alone is hundreds of
  // pixels, and the usage group only exists once `/usage` has answered. The
  // latch lets a group be retried from its own error row without the rest of
  // the page collapsing back to the spinner.
  const settled = [subscription, usage, options, wallet, plans].every(load => load.state.status !== 'loading')
  const [painted, setPainted] = useState(false)
  useEffect(() => {
    if (settled) setPainted(true)
  }, [settled])

  return (
    <div className={css.section}>
      <SectionHeader title={t('section.nav')} description={t('section.intro')} />
      <Identity {...props} />
      <Security mfa={props.mfa} t={t} />

      {!painted && <LoadingBlock label={t('section.loading')} />}

      {painted && <>
        <Group title={t('plan.heading')}>
          <Loaded t={t} load={subscription.state} retry={subscription.reload}>
            {value => (
              <Plans
                t={t}
                cloud={cloud}
                subscription={value}
                plans={plans.state.status === 'ready' ? plans.state.value : undefined}
                usage={usage.state.status === 'ready' ? usage.state.value : undefined}
                refresh={refreshPlan}
              />
            )}
          </Loaded>
        </Group>

        <Group title={t('credits.heading')}>
          <Loaded t={t} load={usage.state} retry={usage.reload}>
            {value => (
              <Credits
                t={t}
                cloud={cloud}
                usage={value}
                options={options.state.status === 'ready' ? options.state.value : undefined}
                refresh={refreshBalance}
              />
            )}
          </Loaded>
        </Group>

        {usage.state.status === 'ready' && (
          <Group
            title={t('usage.heading')}
            aside={t('usage.period', {
              start: day(usage.state.value.billingPeriod.startsAt),
              end: day(usage.state.value.billingPeriod.endsAt),
            })}
          >
            <Usage t={t} usage={usage.state.value} wallet={wallet.state.status === 'ready' ? wallet.state.value : undefined} />
          </Group>
        )}
      </>}
    </div>
  )
}

function Group({ title, aside, children }: { readonly title: string; readonly aside?: string; readonly children: ReactNode }) {
  return (
    <section className={css.group}>
      <h3 className={css.groupTitle}>
        <span>{title}</span>
        {aside !== undefined && <span className={css.groupAside}>{aside}</span>}
      </h3>
      {children}
    </section>
  )
}

function Loaded<T>({ t, load, retry, children }: {
  readonly t: Translate
  readonly load: Load<T>
  readonly retry: () => void
  readonly children: (value: T) => ReactNode
}) {
  if (load.status === 'loading') return <LoadingBlock label={t('section.loading')} />
  if (load.status === 'error') {
    return (
      <div className={css.row}>
        <span className={css.rowText}><span className={css.error}>{t('section.failed')}</span></span>
        <button type="button" className={css.pill} onClick={retry}>{t('section.retry')}</button>
      </div>
    )
  }
  return <>{children(load.value)}</>
}

function Identity({ t, reader, signOut }: AccountSectionProps) {
  const person = reader()
  if (person === undefined) return null
  return (
    <div className={`${css.row} ${css.identity}`}>
      <span className={css.avatar}>
        <Avatar
          {...person.displayName === undefined ? {} : { name: person.displayName }}
          {...person.email === undefined ? {} : { email: person.email }}
          {...person.imageUrl === undefined ? {} : { imageUrl: person.imageUrl }}
          alt={t('avatar.alt')}
        />
      </span>
      <span className={css.rowText}>
        <span className={css.name}>{person.displayName ?? t('profile.unnamed')}</span>
        {person.email !== undefined && <span className={css.desc}>{person.email}</span>}
      </span>
      <span className={css.actions}>
        <button type="button" className={css.pill} onClick={signOut}>{t('logout')}</button>
      </span>
    </div>
  )
}

/** A plan change waiting for the reader's confirmation or for Stripe. */
type PlanFlow =
  | { readonly phase: 'idle' }
  | { readonly phase: 'confirm'; readonly plan: CloudPlan; readonly kind: 'upgrade' | 'downgrade' | 'cancel' }
  | { readonly phase: 'working' }
  | { readonly phase: 'checkout'; readonly plan: CloudPlan }
  | { readonly phase: 'done'; readonly plan: CloudPlan }
  | { readonly phase: 'soon'; readonly plan: CloudPlan }
  | { readonly phase: 'failed' }

function Plans({ t, cloud, subscription, plans, usage, refresh }: {
  readonly t: Translate
  readonly cloud: AccountSectionInjected['cloud']
  readonly subscription: CloudSubscription
  readonly plans: CloudPlans | undefined
  readonly usage: CloudUsage | undefined
  readonly refresh: () => Promise<CloudSubscription | undefined>
}) {
  const [flow, setFlow] = useState<PlanFlow>({ phase: 'idle' })
  const offered = plans?.plans ?? []
  const enabled = plans?.subscriptionsEnabled === true
  const used = usage?.allowance.usedPercent
  const currentIndex = offered.findIndex(plan => plan.id === subscription.plan)
  const current = offered[currentIndex]
  const recommended = offered.find(plan => plan.recommended && priceOf(plan) > (current === undefined ? 0 : priceOf(current)))
  const warn = used !== undefined && used >= NUDGE_PERCENT
  const pastDue = subscription.status === 'past_due'
  const periodEnd = day(subscription.billingPeriod.endsAt)
  const proPrice = offered.find(plan => plan.id === 'pro')?.price?.monthlyUsdMicros

  // Checkout finishes in another window; returning here is when the plan may have
  // changed, so the subscription is read again on every return until it has.
  useEffect(() => {
    if (flow.phase !== 'checkout') return
    const target = flow.plan
    const check = () => {
      void refresh().then((next) => {
        if (next?.plan === target.id) setFlow({ phase: 'done', plan: target })
      })
    }
    return observeReturn(check)
  }, [flow, refresh])

  const act = (path: string, body?: unknown) => {
    setFlow({ phase: 'working' })
    cloud(path, { method: 'POST', body: JSON.stringify(body ?? {}) })
      .then(() => refresh())
      .then(() => { setFlow({ phase: 'idle' }) }, () => { setFlow({ phase: 'failed' }) })
  }

  const subscribe = (plan: CloudPlan) => {
    const target = externalWindow()
    setFlow({ phase: 'working' })
    cloud<SubscriptionCheckout>('/subscription/checkout', { method: 'POST', body: JSON.stringify({ plan: plan.id }) }).then(
      (started) => {
        target.navigate(started.checkoutUrl)
        setFlow({ phase: 'checkout', plan })
      },
      () => {
        target.cancel()
        setFlow({ phase: 'failed' })
      },
    )
  }

  const openBilling = () => {
    const target = externalWindow()
    cloud<BillingPortal>('/billing/portal', { method: 'POST', body: '{}' }).then(
      (portal) => { target.navigate(portal.portalUrl) },
      () => {
        target.cancel()
        setFlow({ phase: 'failed' })
      },
    )
  }

  const choose = (plan: CloudPlan, index: number) => {
    if (!enabled) {
      setFlow({ phase: 'soon', plan })
      return
    }
    if (!subscription.managed) {
      subscribe(plan)
      return
    }
    if (plan.id === FREE_PLAN) setFlow({ phase: 'confirm', plan, kind: 'cancel' })
    else setFlow({ phase: 'confirm', plan, kind: index > currentIndex ? 'upgrade' : 'downgrade' })
  }

  const busy = flow.phase === 'working'
  const currentName = current === undefined ? subscription.planName : planName(current, t)

  let statusLine: string
  if (subscription.pendingPlan !== null) {
    statusLine = t('plan.changesTo', { plan: subscription.pendingPlan.name, date: day(subscription.pendingPlan.startsAt) })
  } else {
    statusLine = t(subscription.renews ? 'plan.renews' : 'plan.ends', { date: periodEnd })
  }

  return (
    <>
      <div className={css.meterRow}>
        <span className={css.rowText}>
          <span className={css.title}>{t('plan.status', { plan: subscription.planName })}</span>
          {/* The read-out shares the line that names the period end, so the
              number sits against the date it belongs to. */}
          <span className={css.meterLine}>
            <span className={css.desc}>{statusLine}</span>
            {used !== undefined && (
              <span className={css.meterLabel}>{t('plan.used', { percent: String(used) })}</span>
            )}
          </span>
        </span>
        {used !== undefined && (
          <span
            className={css.meter}
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={used}
            aria-label={t('plan.used', { percent: String(used) })}
            style={{ '--avn-usage-percent': `${used}%` } as MeterStyle}
          >
            <span style={{ width: `${Math.max(used, 2)}%` }} />
          </span>
        )}
      </div>

      {subscription.managed && (
        <div className={css.row}>
          <span className={css.rowText}>
            <span className={css.title}>{t('plan.billing')}</span>
            <span className={css.desc}>{t('plan.billingNote')}</span>
          </span>
          <button type="button" className={css.pill} onClick={openBilling}>
            {t('plan.manageBilling')}
            <IconRightUpOutline16 size={14} />
          </button>
        </div>
      )}

      <div className={css.plansBlock}>
        {pastDue && (
          <div className={css.nudge} data-tone="error">
            <span className={css.title}>{t('plan.pastDueTitle')}</span>
            <span className={css.desc}>{t('plan.pastDueBody', { plan: currentName })}</span>
          </div>
        )}
        {!pastDue && warn && recommended !== undefined && (
          <div className={css.nudge}>
            <span className={css.title}>{t('plan.nudgeTitle', { percent: String(used) })}</span>
            <span className={css.desc}>{t('plan.nudgeBody')}</span>
          </div>
        )}

        <div className={css.plans}>
          {offered.map((plan, index) => {
            const isCurrent = index === currentIndex
            const isRecommended = plan === recommended
            const higher = currentIndex < 0 || index > currentIndex
            const features = FEATURES[plan.id]
            const multiple = proPrice !== undefined && proPrice > 0 ? Math.round(priceOf(plan) / proPrice) : undefined
            // Every plan answers with the tile's own quiet pill: the tone of
            // the tile says which plan is being recommended, so no action
            // needs a fill of its own.
            const pill = `${css.pill} ${css.planAction}`
            let action: ReactNode
            if (isCurrent && subscription.managed && subscription.cancelAtPeriodEnd) {
              action = <button type="button" className={pill} disabled={busy} onClick={() => { act('/subscription/resume') }}>{t('plan.resume')}</button>
            } else if (isCurrent && subscription.pendingPlan !== null) {
              action = <button type="button" className={pill} disabled={busy} onClick={() => { act('/subscription/change', { plan: plan.id }) }}>{t('plan.keep', { plan: planName(plan, t) })}</button>
            } else if (isCurrent) {
              action = <button type="button" className={pill} disabled>{t('plan.current')}</button>
            } else if (plan.id === FREE_PLAN && !subscription.managed) {
              action = null
            } else {
              action = (
                <button
                  type="button"
                  className={pill}
                  disabled={busy || (plan.id === FREE_PLAN && subscription.cancelAtPeriodEnd)}
                  onClick={() => { choose(plan, index) }}
                >
                  {isRecommended ? t('plan.upgradeTo', { plan: planName(plan, t) }) : t(higher ? 'plan.upgrade' : 'plan.downgrade')}
                </button>
              )
            }
            return (
              <div
                key={plan.id}
                className={css.plan}
                data-current={isCurrent ? 'true' : undefined}
                data-recommended={isRecommended ? 'true' : undefined}
              >
                <div className={css.planHead}>
                  <span className={css.planName}>{planName(plan, t)}</span>
                  {isRecommended && <span className={css.badge}>{t('plan.recommended')}</span>}
                </div>
                <div className={css.price}>
                  <span className={css.priceAmount}>{money(priceOf(plan), plan.price?.currency ?? 'USD', true)}</span>
                  <span className={css.pricePer}>{t('plan.perMonth')}</span>
                </div>
                <ul className={css.features}>
                  {features === undefined
                    ? plan.description !== undefined && <li>{plan.description}</li>
                    : features.map(feature => (
                      <li key={feature}>
                        <IconCheckOutline14 className={css.check} />
                        {t(feature, {
                          amount: money(priceOf(plan), plan.price?.currency ?? 'USD', true),
                          n: String(multiple ?? ''),
                        })}
                      </li>
                    ))}
                </ul>
                {action}
              </div>
            )
          })}
        </div>

        <PlanNotice
          t={t}
          flow={flow}
          currentName={currentName}
          periodEnd={periodEnd}
          dismiss={() => { setFlow({ phase: 'idle' }) }}
          confirm={(confirmed) => {
            if (confirmed.kind === 'cancel') act('/subscription/cancel')
            else act('/subscription/change', { plan: confirmed.plan.id })
          }}
        />
      </div>
    </>
  )
}

function PlanNotice({ t, flow, currentName, periodEnd, dismiss, confirm }: {
  readonly t: Translate
  readonly flow: PlanFlow
  readonly currentName: string
  readonly periodEnd: string
  readonly dismiss: () => void
  readonly confirm: (flow: Extract<PlanFlow, { phase: 'confirm' }>) => void
}) {
  switch (flow.phase) {
    case 'idle':
      return null
    case 'working':
      return <div className={css.notice} role="status"><span className={css.pending}><Spinner /> {t('plan.opening')}</span></div>
    case 'checkout':
      return <div className={css.notice} role="status"><span>{t('plan.waiting')}</span></div>
    case 'done':
      return (
        <div className={css.notice} role="status">
          <span className={css.success}><IconCheckOutline14 /> {t('plan.done', { plan: planName(flow.plan, t) })}</span>
          <Button variant="ghost" onClick={dismiss}>{t('plan.dismiss')}</Button>
        </div>
      )
    case 'soon':
      return (
        <div className={css.notice} role="status">
          <span>{t('plan.soon', { plan: planName(flow.plan, t) })}</span>
          <Button variant="ghost" onClick={dismiss}>{t('plan.dismiss')}</Button>
        </div>
      )
    case 'failed':
      return (
        <div className={css.notice} role="alert">
          <span className={css.error}>{t('plan.failed')}</span>
          <Button variant="ghost" onClick={dismiss}>{t('plan.dismiss')}</Button>
        </div>
      )
    case 'confirm': {
      const name = planName(flow.plan, t)
      const message = flow.kind === 'upgrade'
        ? t('plan.confirmUpgrade', { plan: name })
        : flow.kind === 'downgrade'
          ? t('plan.confirmDowngrade', { plan: name, date: periodEnd, current: currentName })
          : t('plan.confirmCancel', { current: currentName, date: periodEnd })
      const label = flow.kind === 'upgrade' ? 'plan.upgradeNow' : flow.kind === 'downgrade' ? 'plan.scheduleDowngrade' : 'plan.cancelSubscription'
      return (
        <div className={`${css.notice} ${css.confirm}`} role="alertdialog" aria-label={message}>
          <span>{message}</span>
          <span className={css.confirmActions}>
            <Button variant="ghost" onClick={dismiss}>{t('plan.back')}</Button>
            <Button variant="primary" onClick={() => { confirm(flow) }}>{t(label)}</Button>
          </span>
        </div>
      )
    }
  }
}

type Checkout =
  | { readonly phase: 'idle' }
  | { readonly phase: 'opening' }
  | { readonly phase: 'waiting'; readonly baseline: number }
  | { readonly phase: 'added' }
  | { readonly phase: 'refused' }

function Credits({ t, cloud, usage, options, refresh }: {
  readonly t: Translate
  readonly cloud: AccountSectionInjected['cloud']
  readonly usage: CloudUsage
  readonly options: TopUpOptions | undefined
  readonly refresh: () => Promise<number | undefined>
}) {
  const balance = usage.balance
  const offer = options?.enabled === true ? options : undefined
  const [preset, setPreset] = useState<string | undefined>(undefined)
  const [custom, setCustom] = useState('')
  const [checkout, setCheckout] = useState<Checkout>({ phase: 'idle' })
  const customInput = useRef<HTMLInputElement | null>(null)
  const amountsId = useId()

  const selected = offer === undefined ? undefined : preset ?? offer.presets[1]?.id ?? offer.presets[0]?.id
  const customMicros = Math.round(Number(custom) * MICROS_PER_USD)
  const customValid = offer !== undefined && custom.trim() !== '' && Number.isFinite(customMicros)
    && customMicros >= offer.minUsdMicros && customMicros <= offer.maxUsdMicros
  const amount = selected === 'other'
    ? (customValid ? customMicros : undefined)
    : offer?.presets.find(item => item.id === selected)?.amountUsdMicros

  useEffect(() => { if (selected === 'other') customInput.current?.focus() }, [selected])

  // The payment completes in another window; returning here is when the
  // credit may have landed, so the balance is read again on every return.
  useEffect(() => {
    if (checkout.phase !== 'waiting') return
    const check = () => {
      void refresh().then((next) => {
        if (next !== undefined && next > checkout.baseline) setCheckout({ phase: 'added' })
      })
    }
    return observeReturn(check)
  }, [checkout, refresh])

  const topUp = () => {
    if (amount === undefined || offer === undefined) return
    const target = externalWindow()
    setCheckout({ phase: 'opening' })
    const body = selected === 'other' ? { amountUsdMicros: amount } : { preset: selected }
    cloud<TopUpCheckout>('/topup/checkout', { method: 'POST', body: JSON.stringify(body) }).then(
      (started) => {
        target.navigate(started.checkoutUrl)
        setCheckout({ phase: 'waiting', baseline: balance.purchasedUsdMicros })
      },
      () => {
        target.cancel()
        setCheckout({ phase: 'refused' })
      },
    )
  }

  let addNote: ReactNode
  switch (checkout.phase) {
    case 'idle':
      addNote = offer === undefined ? undefined : t('credits.addNote', {
        min: money(offer.minUsdMicros, offer.currency, true),
        max: money(offer.maxUsdMicros, offer.currency, true),
      })
      break
    case 'opening': addNote = <span className={css.pending}><Spinner /> {t('credits.opening')}</span>; break
    case 'waiting': addNote = t('credits.waiting'); break
    case 'added': addNote = <span className={css.success}><IconCheckOutline14 /> {t('credits.added')}</span>; break
    case 'refused': addNote = <span className={css.error}>{t('credits.refused')}</span>; break
  }

  return (
    <>
      <div className={css.row}>
        <span className={css.rowText}>
          <span className={css.title}>{t('credits.balance')}</span>
          <span className={css.desc}>{t('credits.balanceNote')}</span>
        </span>
        <span className={css.balance}>{money(balance.purchasedUsdMicros, balance.currency)}</span>
      </div>
      {options !== undefined && offer === undefined && (
        <div className={css.row}>
          <span className={css.rowText}><span className={css.desc}>{t('credits.unavailable')}</span></span>
        </div>
      )}
      {offer !== undefined && (
        <div className={`${css.row} ${css.wrapRow}`}>
          <span className={css.rowText}>
            <span className={css.title}>{t('credits.add')}</span>
            {addNote !== undefined && <span className={css.desc} role="status">{addNote}</span>}
          </span>
          <span className={css.actions}>
            <span className={css.segmented} role="radiogroup" aria-label={t('credits.amounts')} id={amountsId}>
              {offer.presets.map(item => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={selected === item.id}
                  className={css.segment}
                  onClick={() => { setPreset(item.id) }}
                >
                  {money(item.amountUsdMicros, offer.currency, true)}
                </button>
              ))}
              {selected === 'other'
                ? (
                  <label className={css.customSegment} data-invalid={custom.trim() !== '' && !customValid ? 'true' : undefined}>
                    <span aria-hidden="true">$</span>
                    <input
                      ref={customInput}
                      type="number"
                      inputMode="decimal"
                      min={offer.minUsdMicros / MICROS_PER_USD}
                      max={offer.maxUsdMicros / MICROS_PER_USD}
                      step={1}
                      value={custom}
                      aria-label={t('credits.otherAria')}
                      aria-invalid={custom.trim() !== '' && !customValid}
                      style={{ width: `${Math.max(custom.length, 2)}ch` }}
                      onChange={(event) => { setCustom(event.target.value) }}
                      onKeyDown={(event) => { if (event.key === 'Enter') topUp() }}
                    />
                  </label>
                )
                : (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={false}
                    className={css.segment}
                    onClick={() => { setPreset('other') }}
                  >
                    {t('credits.other')}
                  </button>
                )}
            </span>
            <Button
              variant="primary"
              className={css.addButton}
              disabled={amount === undefined || checkout.phase === 'opening'}
              onClick={topUp}
            >
              {amount === undefined ? t('credits.submitEmpty') : t('credits.submit', { amount: money(amount, offer.currency, true) })}
            </Button>
          </span>
        </div>
      )}
    </>
  )
}

function Usage({ t, usage, wallet }: { readonly t: Translate; readonly usage: CloudUsage; readonly wallet: CloudWallet | undefined }) {
  const [open, setOpen] = useState(false)
  const listId = useId()
  const figures = usage.usage
  const payments = wallet?.transactions.filter(line => PAYMENT_LABEL[line.type] !== undefined) ?? []
  return (
    <>
      <div className={css.row}>
        <span className={css.rowText}><span className={css.title}>{t('usage.requests')}</span></span>
        <span className={css.figure}>{count(figures.requests)}</span>
      </div>
      <div className={css.row}>
        <span className={css.rowText}>
          <span className={css.title}>{t('usage.tokens')}</span>
          <span className={css.desc}>
            {t('usage.breakdown', {
              input: count(figures.inputTokens),
              output: count(figures.outputTokens),
              cached: count(figures.cacheHitInputTokens),
            })}
          </span>
        </span>
        <span className={css.figure}>{count(figures.tokens)}</span>
      </div>
      {wallet !== undefined && (
        <div className={css.row}>
          <span className={css.rowText}><span className={css.title}>{t('usage.payments')}</span></span>
          <button type="button" className={css.selector} aria-expanded={open} aria-controls={listId} onClick={() => { setOpen(!open) }}>
            {t(open ? 'usage.hide' : 'usage.show')}
            <IconChevronDownOutline14 className={open ? `${css.chevron} ${css.chevronOpen}` : css.chevron} />
          </button>
        </div>
      )}
      {open && (
        <div id={listId} className={css.payments}>
          {payments.length === 0
            ? <p className={css.desc}>{t('activity.empty')}</p>
            : payments.map((line, index) => {
              const label = PAYMENT_LABEL[line.type]
              const delta = line.topUpDeltaUsdMicros !== 0 ? line.topUpDeltaUsdMicros : line.amountUsdMicros
              return (
                <div key={`${line.createdAt}-${index}`} className={css.payment}>
                  <span className={css.desc}>{day(line.createdAt)}</span>
                  <span>{label === undefined ? '' : t(label)}</span>
                  <span className={css.figureSmall}>{`${delta > 0 ? '+' : ''}${money(delta, line.currency)}`}</span>
                </div>
              )
            })}
        </div>
      )}
    </>
  )
}

/** Observe returns from an external checkout window. */
function observeReturn(check: () => void): () => void {
  const onVisible = () => { if (document.visibilityState === 'visible') check() }
  window.addEventListener('focus', check)
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    window.removeEventListener('focus', check)
    document.removeEventListener('visibilitychange', onVisible)
  }
}

/** Account protection switch; enabling and disabling both require a verified code. */
function Security({ mfa, t }: { readonly mfa: AevenReader['mfa']; readonly t: Translate }) {
  const [enabled, setEnabled] = useState<boolean>()
  const [mode, setMode] = useState<'setup' | 'disable'>()
  const [failed, setFailed] = useState(false)
  const refresh = useCallback(() => {
    setFailed(false)
    void mfa('status').then((value) => { setEnabled(value.enabled === true) }).catch(() => { setFailed(true) })
  }, [mfa])
  useEffect(refresh, [refresh])
  const request = useCallback((action: 'setup' | 'enable' | 'disable' | 'login', code?: string) =>
    mfa(action, code).then((answer) => {
      if (action === 'enable') setEnabled(true)
      if (action === 'disable') setEnabled(false)
      return answer
    }), [mfa])
  const status = failed ? 'security.unavailable' : enabled === undefined ? 'security.loading' : enabled ? 'security.on' : 'security.off'
  // The switch states the feature; the enrollment it opens belongs to the same
  // cell, so it draws no surface of its own below the row.
  return (
    <Group title={t('security.heading')}>
      <div className={css.row}>
        <span className={css.rowText}>
          <span className={css.title}>{t('security.title')}</span>
          <span className={css.desc}>{t('security.info')}</span>
        </span>
        <span className={css.actions}>
          <span className={css.status} role="status">{t(status)}</span>
          <button
            type="button" role="switch" aria-label={t('security.title')} aria-checked={enabled === true}
            className={css.switch}
            disabled={enabled === undefined || failed || mode !== undefined}
            onClick={() => { setMode(enabled ? 'disable' : 'setup') }}
          ><span className={css.thumb} /></button>
        </span>
      </div>
      {failed && (
        <div role="alert" className={css.row}>
          <span className={css.rowText}><span className={css.desc}>{t('security.failed')}</span></span>
          <button type="button" className={css.pill} onClick={refresh}>{t('section.retry')}</button>
        </div>
      )}
      {mode !== undefined && (
        <div className={css.securityForm}>
          <MfaForm key={mode} layout="cells" mode={mode} t={t} request={request}
            onDone={() => { setMode(undefined) }} onCancel={() => { setMode(undefined) }} />
        </div>
      )}
    </Group>
  )
}
