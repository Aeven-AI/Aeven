/** Plugin-owned coding subscription account section inside the dsh Settings shell. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { jsonRequest } from './api.ts'
import { AccountsTab } from './components/AccountsTab.tsx'
import {
  LOGIN_CANCEL_PATH,
  LOGIN_CODE_PATH,
  LOGIN_PATH,
  LOGOUT_PATH,
  POLL_INTERVAL_MS,
  PROVIDERS,
  STATUS_PATH,
  subscriptionUsagePath,
} from './constants.ts'
import { ensureMicroStyles } from './microStyles.ts'
import {
  parseUsage,
} from './parsers.ts'
import { bodyStyle, buttonStyle, errorStyle, introStyle, pageStyle, panelStyle, titleStyle } from './styles.ts'
import type {
  CodingOAuthStatus,
  GrokBuildSettingsProps,
  LoginChallenge,
  LoginMethod,
  ProviderSlug,
  UsageSlotView,
} from './types.ts'

export type { GrokBuildSettingsInjected, GrokBuildSettingsProps } from './types.ts'

const REMOTE_TIP_STORAGE_KEY = 'dsh-coding-oauth-remote-tip-dismissed'

function readRemoteTipDismissed(): boolean {
  try {
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- some runtimes omit sessionStorage
    return globalThis.sessionStorage?.getItem(REMOTE_TIP_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/** Multi-provider coding subscription status and OAuth actions. */
export function GrokBuildSettings({ t }: GrokBuildSettingsProps) {
  if (t === undefined) throw new Error('Coding OAuth settings requires its translation function')

  const [status, setStatus] = useState<CodingOAuthStatus | undefined>(undefined)
  const [requestError, setRequestError] = useState<string | undefined>(undefined)
  const [busyProvider, setBusyProvider] = useState<ProviderSlug | undefined>(undefined)
  // A browser flow whose tab was blocked falls back to showing its link.
  const [popupBlocked, setPopupBlocked] = useState<Partial<Record<ProviderSlug, boolean>>>({})
  const mountedRef = useRef(true)
  // Provider tabs this page opened for a browser sign-in, closed once that sign-in lands.
  const providerTabs = useRef(new Map<ProviderSlug, Window>())
  // Keyed by provider slug: every signed-in provider reports its own usage.
  const [usageBySlug, setUsageBySlug] = useState<Partial<Record<ProviderSlug, UsageSlotView>>>({})
  const [expandedProviders, setExpandedProviders] = useState<Partial<Record<ProviderSlug, boolean>>>({})
  const [remoteTipDismissed, setRemoteTipDismissed] = useState(readRemoteTipDismissed)
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

  // Accounts: status immediately on mount.
  useEffect(() => {
    ensureMicroStyles()
    let active = true
    void refresh().then((next) => {
      if (!active || next?.uiOwner === 'hub') return
    })
    return () => {
      active = false
    }
  }, [refresh])

  // One page, so every panel's data loads once on mount rather than on the
  // tab activation that no longer exists. Each switch now sits in the account
  // card it belongs to, and none of them can be reached without the section
  // being open anyway.
  useEffect(() => {
  }, [])



  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

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
  // callback, and some providers render a copy-this-code fallback there. The tab
  // was opened by this page, so this page closes it once the session is signed
  // in. A provider page that severs its opener (COOP) leaves nothing to close.
  useEffect(() => {
    if (status === undefined) return
    for (const [slug, tab] of providerTabs.current) {
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- a tracked tab can outlive its provider in the status snapshot
      const providerStatus = status.providers[slug]?.status
      if (providerStatus === 'signing-in') continue
      if (providerStatus === 'signed-in') tab.close()
      providerTabs.current.delete(slug)
    }
  }, [status])

  // Usage follows sign-in alone: it is not a capability toggle, and a plan that
  // cannot use a provider is exactly what the panel needs to report.
  const signedInSlugs = PROVIDERS.filter(definition => status?.providers[definition.slug]?.status === 'signed-in')
    .map(definition => definition.slug)
    .join(',')
  useEffect(() => {
    const slugs = signedInSlugs.length === 0 ? [] : (signedInSlugs.split(',') as ProviderSlug[])
    for (const slug of slugs) void refreshUsage(slug)
    setUsageBySlug((current) => {
      const kept: Partial<Record<ProviderSlug, UsageSlotView>> = {}
      /* v8 ignore next -- refreshUsage seeds every slug synchronously into the same state queue, so the entry is always present */
      for (const slug of slugs) if (current[slug] !== undefined) kept[slug] = current[slug]
      return kept
    })
  }, [refreshUsage, signedInSlugs])


  /**
   * Start one provider sign-in.
   *
   * A browser flow is click-and-sign-in: the provider redirects to the local
   * callback and the session completes without anything on this page, so the
   * provider page opens straight away. It opens inside the click, before the
   * request, because a window opened after an `await` is no longer a user
   * gesture and a popup blocker would stop it. A device flow opens nothing: it
   * shows its code and the user opens the provider page from the instructions.
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


  /**
   * Finish a pending browser sign-in with the redirect URL or code the user
   * pasted. The Host exchanges it in the background, so the status poll
   * reports the signed-in state once the exchange lands.
   */
  const submitRedirect = async (provider: ProviderSlug, code: string): Promise<void> => {
    setBusyProvider(provider)
    setRequestError(undefined)
    try {
      await jsonRequest<{ ok: true }>(LOGIN_CODE_PATH, 'POST', { provider, code })
      await refresh()
    } catch (error: unknown) {
      setRequestError(error instanceof Error ? error.message : t('requestFailed'))
    } finally {
      setBusyProvider(undefined)
    }
  }

  const cancelLogin = async (provider: ProviderSlug): Promise<void> => {
    setBusyProvider(provider)
    try {
      setStatus(await jsonRequest<CodingOAuthStatus>(LOGIN_CANCEL_PATH, 'POST', { provider }))
    } catch (error: unknown) {
      setRequestError(error instanceof Error ? error.message : t('requestFailed'))
    } finally {
      setBusyProvider(undefined)
    }
  }

  const signOut = async (provider: ProviderSlug): Promise<void> => {
    setBusyProvider(provider)
    try {
      setStatus(await jsonRequest<CodingOAuthStatus>(LOGOUT_PATH, 'POST', { provider }))
    } catch (error: unknown) {
      setRequestError(error instanceof Error ? error.message : t('requestFailed'))
    } finally {
      setBusyProvider(undefined)
    }
  }








  const signedInCount =
    status === undefined
      ? 0
      : Object.values(status.providers).filter(provider => provider.status === 'signed-in').length








  const dismissRemoteTip = (): void => {
    setRemoteTipDismissed(true)
    try {
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- some runtimes omit sessionStorage
      globalThis.sessionStorage?.setItem(REMOTE_TIP_STORAGE_KEY, '1')
    } catch {
      // ignore storage failures
    }
  }

  if (status?.uiOwner === 'hub') {
    return (
      <section data-dsh-coding-oauth="compact" style={pageStyle} aria-labelledby="coding-oauth-settings-title">
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
    <section data-dsh-coding-oauth="" style={pageStyle} aria-labelledby="coding-oauth-settings-title">
      <h2 id="coding-oauth-settings-title" style={titleStyle}>
        {t('title')}
      </h2>
      <p style={introStyle}>{t('intro')}</p>
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
      <div style={panelStyle}>
        {status === undefined && requestError !== undefined ? null : (
          <AccountsTab
            t={t}
            status={status}
            remote={remote}
            remoteTipDismissed={remoteTipDismissed}
            onDismissRemoteTip={dismissRemoteTip}
            busyProvider={busyProvider}
            popupBlocked={popupBlocked}
            expandedProviders={expandedProviders}
            usageBySlug={usageBySlug}
            onRefreshUsage={(slug) => {
              void refreshUsage(slug, true)
            }}
            onSignIn={(slug, method) => {
              void signIn(slug, method)
            }}
            onSignOut={(slug) => {
              void signOut(slug)
            }}
            onCancelLogin={(slug) => {
              void cancelLogin(slug)
            }}
            onToggleExpanded={(slug) => {
              setExpandedProviders(current => ({
                ...current,
                [slug]: !(current[slug] === true),
              }))
            }}
            onSubmitRedirect={(slug, value) => {
              void submitRedirect(slug, value)
            }}
          />
        )}
      </div>
    </section>
  )
}
