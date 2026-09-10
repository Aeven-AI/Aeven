/** Single provider account card for the Accounts tab. */

import { useEffect, useRef, useState } from 'react'
import { methodLabel, orderedLoginMethods } from '../display.ts'
import {
  bodyStyle,
  buttonStyle,
  cardStyle,
  codeStyle,
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
  expanded: boolean
  showUsage: boolean
  usage: UsageView | undefined
  usageError: string | undefined
  usageLoading: boolean
  onRefreshUsage: () => void
  onSignIn: (method: LoginMethod) => void
  onSignOut: () => void
  onCancelLogin: () => void
  onToggleExpanded: () => void
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
  showUsage,
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



  return (
    <div style={cardStyle}>
      <div style={rowStyle}>
        <div>
          <h3 style={{ ...titleStyle, fontSize: 15, lineHeight: 1.4 }}>{t(definition.titleKey)}</h3>
        </div>
        {/* Signed in reads as a bare dot: the Sign out control already states it in words. */}
        {providerStatus.status === 'signed-in' ? (
          <span role="img" aria-label={statusLabel} title={statusLabel} style={dotStyle('signed-in')} />
        ) : providerStatus.status === 'error' ? (
          <Badge label={statusLabel} providerStatus={providerStatus.status} />
        ) : null}
      </div>
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
      {providerStatus.status === 'signed-in' && expanded ? (
        <div id={`coding-oauth-models-${definition.slug}`} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {grokProviderStatus?.status === 'signed-in' && grokProviderStatus.catalogError !== undefined ? (
            <p style={{ ...bodyStyle, color: 'var(--dsw-alias-state-error-primary)' }}>{t('catalogError')}</p>
          ) : null}
          {showUsage ? (
            <UsageSection
              usage={usage}
              error={usageError}
              loading={usageLoading}
              t={t}
              style={nestedStyle}
              onRefresh={onRefreshUsage}
            />
          ) : null}
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
            <button
              id={`coding-oauth-models-toggle-${definition.slug}`}
              type="button"
              style={buttonStyle}
              aria-expanded={expanded}
              aria-controls={expanded ? `coding-oauth-models-${definition.slug}` : undefined}
              onClick={onToggleExpanded}
            >
              {expanded ? t('collapseModels') : t('expandModels')}
            </button>
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
