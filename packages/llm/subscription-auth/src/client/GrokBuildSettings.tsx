/** Coding-subscription providers, rendered as a group of foldout cards on the Providers settings page. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { SectionHeader } from '@aeven/client-ui-primitives'
import { jsonRequest } from './api.ts'
import { ProviderFoldout } from './components/ProviderFoldout.tsx'
import {
  LOGIN_CANCEL_PATH,
  LOGIN_PATH,
  LOGOUT_PATH,
  MODELS_PATH,
  POLL_INTERVAL_MS,
  PROVIDERS,
  STATUS_PATH,
  subscriptionUsagePath,
} from './constants.ts'
import { signInMethod } from './display.ts'
import { ensureMicroStyles } from './microStyles.ts'
import { parseUsage } from './parsers.ts'
import { bodyStyle, buttonStyle, cardListStyle, errorStyle, pageStyle, titleStyle } from './styles.ts'
import type {
  CodingOAuthStatus,
  GrokBuildSettingsProps,
  LoginChallenge,
  LoginMethod,
  ProviderSlug,
  UsageSlotView,
} from './types.ts'

export type { GrokBuildSettingsInjected, GrokBuildSettingsProps } from './types.ts'

/** Subscription providers as Providers cards: sign-in, usage, and model selection. */
export function GrokBuildSettings({ t }: GrokBuildSettingsProps) {
  if (t === undefined) throw new Error('Coding OAuth settings requires its translation function')

  const [status, setStatus] = useState<CodingOAuthStatus | undefined>(undefined)
  const [requestError, setRequestError] = useState<string | undefined>(undefined)
  const [busyProvider, setBusyProvider] = useState<ProviderSlug | undefined>(undefined)
  const [savingModels, setSavingModels] = useState<ProviderSlug | undefined>(undefined)
  // A browser flow whose tab was blocked falls back to showing its link.
  const [popupBlocked, setPopupBlocked] = useState<Partial<Record<ProviderSlug, boolean>>>({})
  // Provider tabs this page opened for a browser sign-in, closed once that sign-in lands.
  const providerTabs = useRef(new Map<ProviderSlug, Window>())
  // Keyed by provider slug: every signed-in provider reports its own usage.
  const [usageBySlug, setUsageBySlug] = useState<Partial<Record<ProviderSlug, UsageSlotView>>>({})
  const remote = status?.accessMode === 'ssh-tunnel' || status?.accessMode === 'trusted-https-proxy'

  const refresh = useCallback(async () => {
    try {
      const next = await jsonRequest<CodingOAuthStatus>(STATUS_PATH)
      setStatus(next)
      setRequestError(undefined)
      return next
    } catch (error: unknown) {
      setRequestError(error instanceof Error ? error.message : t('requestFailed'))
      return undefined
    }
  }, [t])

  const refreshUsage = useCallback(
    async (slug: ProviderSlug, force = false) => {
      setUsageBySlug(current => ({ ...current, [slug]: { ...current[slug], loading: true } }))
      try {
        const path = force ? `${subscriptionUsagePath(slug)}?refresh=1` : subscriptionUsagePath(slug)
        const parsed = parseUsage(await jsonRequest<unknown>(path))
        setUsageBySlug(current => ({ ...current, [slug]: { usage: parsed, loading: false } }))
      } catch (error: unknown) {
        setUsageBySlug(current => ({
          ...current,
          [slug]: { loading: false, error: error instanceof Error ? error.message : t('usageUnavailable') },
        }))
      }
    },
    [t],
  )

  useEffect(() => {
    ensureMicroStyles()
    void refresh()
  }, [refresh])

  useEffect(() => {
    const signingIn =
      status !== undefined && Object.values(status.providers).some(provider => provider.status === 'signing-in')
    if (!signingIn) return
    const timer = window.setInterval(() => {
      void refresh()
    }, POLL_INTERVAL_MS)
    return () => {
      window.clearInterval(timer)
    }
  }, [refresh, status])

  // The provider's own page stays open after it hands the code to the local
  // callback. The tab was opened by this page, so this page closes it once the
  // session is signed in. A provider page that severs its opener (COOP)
  // leaves nothing to close.
  useEffect(() => {
    if (status === undefined) return
    for (const [slug, tab] of providerTabs.current) {
      const providerStatus = status.providers[slug].status
      if (providerStatus === 'signing-in') continue
      if (providerStatus === 'signed-in') tab.close()
      providerTabs.current.delete(slug)
    }
  }, [status])

  // Usage follows sign-in alone: a plan that cannot use a provider is exactly
  // what the panel needs to report.
  const signedInSlugs = PROVIDERS.filter(definition => status?.providers[definition.slug].status === 'signed-in')
    .map(definition => definition.slug)
    .join(',')
  useEffect(() => {
    const slugs = signedInSlugs.length === 0 ? [] : (signedInSlugs.split(',') as ProviderSlug[])
    for (const slug of slugs) void refreshUsage(slug)
    setUsageBySlug((current) => {
      const kept: Partial<Record<ProviderSlug, UsageSlotView>> = {}
      for (const slug of slugs) if (current[slug] !== undefined) kept[slug] = current[slug]
      return kept
    })
  }, [refreshUsage, signedInSlugs])

  /**
   * Start one provider sign-in.
   *
   * A browser flow completes through the local callback, so the provider page
   * opens straight away. It opens inside the click, before the request,
   * because a window opened after an `await` is no longer a user gesture and a
   * popup blocker would stop it. A device flow opens nothing: the card shows
   * its code and the link to the provider page.
   */
  const signIn = async (provider: ProviderSlug, method: LoginMethod): Promise<void> => {
    const tab = method === 'device' ? null : window.open('about:blank', '_blank')
    if (tab !== null) tab.opener = null
    setBusyProvider(provider)
    setRequestError(undefined)
    setPopupBlocked(current => ({ ...current, [provider]: method !== 'device' && tab === null }))
    try {
      const challenge = await jsonRequest<LoginChallenge>(LOGIN_PATH, 'POST', { provider, method })
      if (tab !== null) {
        tab.location.replace(challenge.url)
        providerTabs.current.set(provider, tab)
      }
      await refresh()
    } catch (error: unknown) {
      tab?.close()
      setRequestError(error instanceof Error ? error.message : t('requestFailed'))
      await refresh()
    } finally {
      setBusyProvider(undefined)
    }
  }

  const statusAction = async (provider: ProviderSlug, path: string): Promise<void> => {
    setBusyProvider(provider)
    try {
      setStatus(await jsonRequest<CodingOAuthStatus>(path, 'POST', { provider }))
    } catch (error: unknown) {
      setRequestError(error instanceof Error ? error.message : t('requestFailed'))
    } finally {
      setBusyProvider(undefined)
    }
  }

  /** Apply a model selection, showing it at once and settling on the Host's answer. */
  const selectModels = async (provider: ProviderSlug, selected: readonly string[]): Promise<void> => {
    const on = new Set(selected)
    setStatus((current) => {
      if (current === undefined) return current
      const entry = current.providers[provider]
      if (entry.status !== 'signed-in') return current
      const models = entry.models.map(model => ({ ...model, selected: on.has(model.id) }))
      return { ...current, providers: { ...current.providers, [provider]: { ...entry, models } } }
    })
    setSavingModels(provider)
    try {
      setStatus(await jsonRequest<CodingOAuthStatus>(MODELS_PATH, 'POST', { provider, selected }))
    } catch (error: unknown) {
      setRequestError(error instanceof Error ? error.message : t('requestFailed'))
      await refresh()
    } finally {
      setSavingModels(undefined)
    }
  }

  if (status?.uiOwner === 'hub') {
    const signedInCount = Object.values(status.providers).filter(provider => provider.status === 'signed-in').length
    return (
      <section data-avn-coding-oauth="compact" style={pageStyle} aria-labelledby="coding-oauth-settings-title">
        <h2 id="coding-oauth-settings-title" style={titleStyle}>
          {t('coinstallTitle')}
        </h2>
        <p style={bodyStyle}>{t('coinstallSummary', { count: signedInCount })}</p>
        <button
          type="button"
          style={buttonStyle}
          onClick={() => window.dispatchEvent(new CustomEvent('usage-stats:open-dashboard'))}
        >
          {t('coinstallOpenHub')}
        </button>
      </section>
    )
  }

  return (
    <section
      data-avn-coding-oauth=""
      style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 24 }}
      aria-label={t('title')}
    >
      <SectionHeader title={t('title')} description={t('intro')} />
      {requestError === undefined ? null : (
        <div role="alert" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <p style={errorStyle}>{requestError}</p>
          {status === undefined ? (
            <button type="button" style={buttonStyle} onClick={() => void refresh()}>
              {t('retry')}
            </button>
          ) : null}
        </div>
      )}
      {status === undefined ? (
        requestError === undefined ? <p style={bodyStyle} role="status">{t('loadingAccount')}</p> : null
      ) : (
        <ul style={cardListStyle}>
          {PROVIDERS.map((definition) => {
            const slug = definition.slug
            return (
              <ProviderFoldout
                key={slug}
                t={t}
                definition={definition}
                providerStatus={status.providers[slug]}
                busy={busyProvider === slug}
                savingModels={savingModels === slug}
                popupBlocked={popupBlocked[slug] === true}
                usage={usageBySlug[slug]}
                onRefreshUsage={() => { void refreshUsage(slug, true) }}
                onSignIn={() => { void signIn(slug, signInMethod(definition, remote)) }}
                onSignOut={() => { void statusAction(slug, LOGOUT_PATH) }}
                onCancelLogin={() => { void statusAction(slug, LOGIN_CANCEL_PATH) }}
                onSelectModels={(selected) => { void selectModels(slug, selected) }}
              />
            )
          })}
        </ul>
      )}
    </section>
  )
}
