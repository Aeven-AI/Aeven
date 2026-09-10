/** Single provider account card for the Accounts tab. */

import { useEffect, useRef, useState } from 'react'
import { methodLabel, orderedLoginMethods } from '../display.ts'
import {
  bodyStyle,
  buttonStyle,
  cardOpenStyle,
  cardStyle,
  chevronStyle,
  codeStyle,
  disclosureBodyStyle,
  disclosureHeaderStyle,
  dotStyle,
  footerStyle,
  nestedStyle,
  primaryButtonStyle,
  rowStyle,
  stepActiveStyle,
  stepNumberActiveStyle,
  stepNumberStyle,
  stepRowStyle,
  titleStyle,
  visuallyHiddenStyle,
} from '../styles.ts'
import type {
  GrokBuildSettingsInjected,
  GrokStatus,
  LoginMethod,
  ProviderCardDefinition,
  ProviderStatus,
  UsageView,
} from '../types.ts'
import { Badge } from './Badge.tsx'
import { CopyButton } from './CopyButton.tsx'
import { UsageSection } from './UsageSection.tsx'

export interface ProviderCardProps {
  t: GrokBuildSettingsInjected['t']
  definition: ProviderCardDefinition
  providerStatus: ProviderStatus
  busy: boolean
  remote: boolean
  /** A browser flow's tab was blocked, so its link is shown instead. */
  popupBlocked: boolean
  /** A signed-in card discloses its usage below the header. */
  expanded: boolean
  usage: UsageView | undefined
  usageError: string | undefined
  usageLoading: boolean
  onRefreshUsage: () => void
  onSignIn: (method: LoginMethod) => void
  onSignOut: () => void
  onCancelLogin: () => void
  onToggleExpanded: () => void
}

/** The 14px chevron the Plugins card header draws, inlined because this client imports no UI package at runtime. */
function ChevronDownIcon({ open }: { open: boolean }) {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden="true" style={chevronStyle(open)}>
      <path
        d="M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z"
        fill="currentColor"
      />
    </svg>
  )
}

function SignInSteps({
  t,
  userCode,
  url,
}: {
  t: GrokBuildSettingsInjected['t']
  userCode: string | undefined
  url: string | undefined
}) {
  const hasCode = userCode !== undefined && userCode.length > 0
  const hasUrl = url !== undefined && url.length > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={hasUrl ? stepActiveStyle : stepRowStyle}>
        <span style={hasUrl ? stepNumberActiveStyle : stepNumberStyle} aria-hidden="true">
          1
        </span>
        <span>{t('signInStepOpen')}</span>
      </div>
      {hasUrl ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingLeft: 32 }}>
          <a href={url} target="_blank" rel="noreferrer" style={primaryButtonStyle}>
            {t('openAuthUrl')}
          </a>
          <CopyButton text={url} idleLabel={t('copy')} copiedLabel={t('copied')} failedLabel={t('copyFailed')} />
        </div>
      ) : null}
      {hasCode ? (
        <>
          <div style={stepActiveStyle}>
            <span style={stepNumberActiveStyle} aria-hidden="true">
              2
            </span>
            <span>{t('signInStepCode')}</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingLeft: 32 }}>
            <span style={codeStyle}>{userCode}</span>
            <CopyButton
              text={userCode}
              idleLabel={t('copyUserCode')}
              copiedLabel={t('copied')}
              failedLabel={t('copyFailed')}
              primary
            />
          </div>
        </>
      ) : null}
    </div>
  )
}

export function ProviderCard({
  t,
  definition,
  providerStatus,
  busy,
  remote,
  popupBlocked,
  expanded,
  usage,
  usageError,
  usageLoading,
  onRefreshUsage,
  onSignIn,
  onSignOut,
  onCancelLogin,
  onToggleExpanded,
}: ProviderCardProps) {
  const [logoutConfirm, setLogoutConfirm] = useState(false)
  const logoutTrigger = useRef<HTMLButtonElement>(null)
  const logoutConfirmAction = useRef<HTMLButtonElement>(null)
  const restoreLogoutFocus = useRef(false)

  const ordered = orderedLoginMethods(definition, remote)
  const primaryMethod: LoginMethod = ordered[0] ?? definition.recommended
  const altMethods = ordered.filter(method => method !== primaryMethod)

  const statusLabel =
    providerStatus.status === 'signed-in'
      ? t('signedIn')
      : providerStatus.status === 'signing-in'
        ? t('signingIn')
        : providerStatus.status === 'error'
          ? t('requestFailed')
          : t('signedOut')
  const activeMethod = providerStatus.status === 'signing-in' ? providerStatus.method : primaryMethod
  useEffect(() => {
    if (providerStatus.status !== 'signed-in') setLogoutConfirm(false)
  }, [providerStatus.status])
  useEffect(() => {
    if (logoutConfirm) {
      logoutConfirmAction.current?.focus()
      return
    }
    if (!restoreLogoutFocus.current) return
    restoreLogoutFocus.current = false
    if (providerStatus.status === 'signed-in') {
      logoutTrigger.current?.focus()
      return
    }
    document.getElementById(`coding-oauth-login-${definition.slug}`)?.focus()
  }, [definition.slug, logoutConfirm, providerStatus.status])
  const grokProviderStatus = definition.slug === 'grok' ? (providerStatus as GrokStatus) : undefined
  const title = t(definition.titleKey)
  const headingStyle = { ...titleStyle, fontSize: 15, lineHeight: 1.4 }
  const usageOpen = providerStatus.status === 'signed-in' && expanded

  return (
    <div style={usageOpen ? cardOpenStyle : cardStyle}>
      {providerStatus.status === 'signed-in' ? (
        <h3 style={headingStyle}>
          <button
            id={`coding-oauth-usage-toggle-${definition.slug}`}
            type="button"
            style={disclosureHeaderStyle}
            aria-expanded={expanded}
            aria-controls={expanded ? `coding-oauth-usage-${definition.slug}` : undefined}
            aria-label={`${t(expanded ? 'collapseUsage' : 'expandUsage')}: ${title}`}
            onClick={onToggleExpanded}
          >
            <span style={{ flex: 1, minWidth: 0 }}>{title}</span>
            {/* Signed in reads as a bare dot: the Sign out control already states it in words. */}
            <span title={statusLabel} style={dotStyle('signed-in')} />
            <ChevronDownIcon open={expanded} />
          </button>
        </h3>
      ) : (
        <div style={rowStyle}>
          <h3 style={headingStyle}>{title}</h3>
          {providerStatus.status === 'error' ? (
            <Badge label={statusLabel} providerStatus={providerStatus.status} />
          ) : null}
        </div>
      )}
      {providerStatus.status === 'error' ? (
        <p style={{ ...bodyStyle, color: 'var(--dsw-alias-state-error-primary)' }}>{providerStatus.message}</p>
      ) : null}
      {providerStatus.status === 'signing-in' && (activeMethod === 'device' || popupBlocked) ? (
        <SignInSteps
          t={t}
          userCode={providerStatus.userCode}
          url={providerStatus.url}
        />
      ) : null}
      {usageOpen ? (
        <div id={`coding-oauth-usage-${definition.slug}`} style={disclosureBodyStyle}>
          {grokProviderStatus?.status === 'signed-in' && grokProviderStatus.catalogError !== undefined ? (
            <p style={{ ...bodyStyle, color: 'var(--dsw-alias-state-error-primary)' }}>{t('catalogError')}</p>
          ) : null}
          <UsageSection
            usage={usage}
            error={usageError}
            loading={usageLoading}
            t={t}
            style={{ display: 'flex', flexDirection: 'column' }}
            onRefresh={onRefreshUsage}
          />
        </div>
      ) : null}
      <div style={footerStyle}>
        {providerStatus.status === 'signed-in' ? (
          <>
            {logoutConfirm ? (
              <fieldset style={{ ...nestedStyle, margin: 0, minWidth: 0, width: '100%', boxSizing: 'border-box' }}>
                <legend style={visuallyHiddenStyle}>{t('logoutConfirmTitle')}</legend>
                <p style={bodyStyle}>{t('logoutConfirmHint')}</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <button
                    ref={logoutConfirmAction}
                    type="button"
                    style={primaryButtonStyle}
                    disabled={busy}
                    onClick={() => {
                      restoreLogoutFocus.current = true
                      onSignOut()
                    }}
                  >
                    {busy ? t('working') : t('logoutConfirmAction')}
                  </button>
                  <button
                    type="button"
                    style={buttonStyle}
                    disabled={busy}
                    onClick={() => {
                      restoreLogoutFocus.current = true
                      setLogoutConfirm(false)
                    }}
                  >
                    {t('cancel')}
                  </button>
                </div>
              </fieldset>
            ) : (
              <button
                ref={logoutTrigger}
                type="button"
                style={buttonStyle}
                disabled={busy}
                onClick={() => setLogoutConfirm(true)}
              >
                {t('logout')}
              </button>
            )}
          </>
        ) : providerStatus.status === 'signing-in' ? (
          <>
            <button type="button" style={buttonStyle} disabled={busy} onClick={onCancelLogin}>
              {t('cancelLogin')}
            </button>
            {altMethods.map(method => (
              <button
                key={method}
                type="button"
                style={buttonStyle}
                disabled={busy}
                onClick={() => {
                  onSignIn(method)
                }}
              >
                {methodLabel(method, t)}
              </button>
            ))}
          </>
        ) : (
          <>
            <button
              id={`coding-oauth-login-${definition.slug}`}
              type="button"
              style={primaryButtonStyle}
              disabled={busy}
              onClick={() => {
                onSignIn(primaryMethod)
              }}
            >
              {busy ? t('working') : methodLabel(primaryMethod, t)}
            </button>
            {altMethods.map(method => (
              <button
                key={method}
                type="button"
                style={buttonStyle}
                disabled={busy}
                onClick={() => {
                  onSignIn(method)
                }}
              >
                {methodLabel(method, t)}
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
