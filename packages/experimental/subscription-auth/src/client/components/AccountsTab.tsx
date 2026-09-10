/** Accounts tab: the provider cards and their remote-access tip. */

import { Fragment } from 'react'
import { PROVIDERS } from '../constants.ts'
import { accountGridStyle, dotStyle, skeletonStyle, statusStyle } from '../styles.ts'
import type {
  CodingOAuthStatus,
  GrokBuildSettingsInjected,
  LoginMethod,
  ProviderSlug,
  UsageSlotView,
} from '../types.ts'
import { NoticeBanner } from './NoticeBanner.tsx'
import { ProviderCard } from './ProviderCard.tsx'

export interface AccountsTabProps {
  t: GrokBuildSettingsInjected['t']
  /** Build one account's optional switches; the card renders them in place. */
  status: CodingOAuthStatus | undefined
  remote: boolean
  remoteTipDismissed: boolean
  onDismissRemoteTip: () => void
  busyProvider: ProviderSlug | undefined
  popupBlocked: Partial<Record<ProviderSlug, boolean>>
  expandedProviders: Partial<Record<ProviderSlug, boolean>>
  usageBySlug: Partial<Record<ProviderSlug, UsageSlotView>>
  onRefreshUsage: (slug: ProviderSlug) => void
  onSignIn: (slug: ProviderSlug, method: LoginMethod) => void
  onSignOut: (slug: ProviderSlug) => void
  onCancelLogin: (slug: ProviderSlug) => void
  onToggleExpanded: (slug: ProviderSlug) => void
}

export function AccountsTab({
  t,
  status,
  remote,
  remoteTipDismissed,
  onDismissRemoteTip,
  busyProvider,
  popupBlocked,
  expandedProviders,
  usageBySlug,
  onRefreshUsage,
  onSignIn,
  onSignOut,
  onCancelLogin,
  onToggleExpanded,
}: AccountsTabProps) {
  if (status === undefined) {
    return (
      <div style={skeletonStyle} role="status" aria-busy="true">
        <div style={statusStyle}>
          <span aria-hidden="true" style={dotStyle('loading')} />
          {t('loadingAccount')}
        </div>
      </div>
    )
  }

  return (
    <>
      {remote && !remoteTipDismissed ? (
        <NoticeBanner
          message={t('remoteAccountsTip')}
          dismissLabel={t('remoteTipDismiss')}
          onDismiss={onDismissRemoteTip}
        />
      ) : null}
      <div style={accountGridStyle}>
        {PROVIDERS.map((definition) => {
          const providerStatus = status.providers[definition.slug]
          const expanded = providerStatus.status === 'signing-in' || expandedProviders[definition.slug] === true
          return (
            <Fragment key={definition.slug}>
              <ProviderCard
                t={t}
                definition={definition}
                providerStatus={providerStatus}
                busy={busyProvider === definition.slug}
                remote={remote}
                popupBlocked={popupBlocked[definition.slug] === true}
                expanded={expanded}
                showUsage={providerStatus.status === 'signed-in'}
                usage={usageBySlug[definition.slug]?.usage}
                usageError={usageBySlug[definition.slug]?.error}
                usageLoading={usageBySlug[definition.slug]?.loading === true}
                onRefreshUsage={() => {
                  onRefreshUsage(definition.slug)
                }}
                onSignIn={(method) => {
                  onSignIn(definition.slug, method)
                }}
                onSignOut={() => {
                  onSignOut(definition.slug)
                }}
                onCancelLogin={() => {
                  onCancelLogin(definition.slug)
                }}
                onToggleExpanded={() => {
                  onToggleExpanded(definition.slug)
                }}
              />
            </Fragment>
          )
        })}
      </div>
    </>
  )
}
