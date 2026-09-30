/** One subscription provider as a Model providers row: sign-in state, actions, and disclosed usage. */

import { useEffect, useRef, useState } from 'react'
import { ProviderRow, ProviderRowButton } from '@aeven/client-ui-primitives'
import { methodLabel, orderedLoginMethods } from '../display.ts'
import {
  bodyStyle,
  codeStyle,
  hintStyle,
  inputStyle,
  nestedStyle,
  primaryButtonStyle,
  stepActiveStyle,
  stepNumberActiveStyle,
  stepNumberStyle,
  stepRowStyle,
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
  /** Finish the pending sign-in with a pasted redirect URL or code; only called for `acceptsPastedRedirect` providers. */
  onSubmitRedirect: (value: string) => void
}

/**
 * Fallback for a browser sign-in whose provider redirect cannot reach the
 * Host's loopback callback, as when this page is opened over an SSH tunnel:
 * the provider's final page then fails to load, and its address carries the
 * authorization code.
 */
function PasteRedirectForm({
  t,
  slug,
  busy,
  onSubmit,
}: {
  t: GrokBuildSettingsInjected['t']
  slug: ProviderCardDefinition['slug']
  busy: boolean
  onSubmit: (value: string) => void
}) {
  const [value, setValue] = useState('')
  const inputId = `coding-oauth-redirect-${slug}`
  const hintId = `${inputId}-hint`
  const trimmed = value.trim()
  return (
    <form
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
      onSubmit={(event) => {
        event.preventDefault()
        if (trimmed.length > 0 && !busy) onSubmit(trimmed)
      }}
    >
      <label htmlFor={inputId} style={{ ...bodyStyle, color: 'var(--dsw-alias-label-secondary)' }}>
        {t('pasteRedirectLabel')}
      </label>
      <p id={hintId} style={hintStyle}>
        {t('pasteRedirectHint')}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <input
          id={inputId}
          type="text"
          autoComplete="off"
          spellCheck={false}
          aria-describedby={hintId}
          style={{ ...inputStyle, flex: '1 1 240px', minWidth: 0 }}
          value={value}
          disabled={busy}
          onChange={(event) => {
            setValue(event.target.value)
          }}
        />
        <button type="submit" style={primaryButtonStyle} disabled={busy || trimmed.length === 0}>
          {busy ? t('working') : t('submitRedirect')}
        </button>
      </div>
    </form>
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

/** The extra login methods a card offers beside its primary one, in every sign-in state. */
function AltMethodButtons({
  methods,
  t,
  busy,
  onSignIn,
}: {
  methods: readonly LoginMethod[]
  t: GrokBuildSettingsInjected['t']
  busy: boolean
  onSignIn: (method: LoginMethod) => void
}) {
  return (
    <>
      {methods.map(method => (
        <ProviderRowButton
          key={method}
          disabled={busy}
          onClick={() => {
            onSignIn(method)
          }}
        >
          {methodLabel(method, t)}
        </ProviderRowButton>
      ))}
    </>
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
  onSubmitRedirect,
}: ProviderCardProps) {
  const [logoutConfirm, setLogoutConfirm] = useState(false)
  const logoutTrigger = useRef<HTMLButtonElement>(null)
  const logoutConfirmAction = useRef<HTMLButtonElement>(null)
  const restoreLogoutFocus = useRef(false)

  const ordered = orderedLoginMethods(definition, remote)
  const primaryMethod: LoginMethod = ordered[0] ?? definition.recommended
  const altMethods = ordered.filter(method => method !== primaryMethod)

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
  const usageOpen = providerStatus.status === 'signed-in' && expanded

  const actions = providerStatus.status === 'signed-in'
    ? (
      <>
        <ProviderRowButton
          id={`coding-oauth-usage-toggle-${definition.slug}`}
          aria-expanded={expanded}
          aria-controls={expanded ? `coding-oauth-usage-${definition.slug}` : undefined}
          aria-label={`${t(expanded ? 'collapseUsage' : 'expandUsage')}: ${title}`}
          onClick={onToggleExpanded}
        >
          {t(expanded ? 'collapseUsage' : 'expandUsage')}
        </ProviderRowButton>
        <ProviderRowButton
          ref={logoutTrigger}
          tone="danger"
          disabled={busy || logoutConfirm}
          onClick={() => { setLogoutConfirm(true) }}
        >
          {t('logout')}
        </ProviderRowButton>
      </>
    )
    : providerStatus.status === 'signing-in'
      ? (
        <>
          <ProviderRowButton disabled={busy} onClick={onCancelLogin}>
            {t('cancelLogin')}
          </ProviderRowButton>
          <AltMethodButtons methods={altMethods} t={t} busy={busy} onSignIn={onSignIn} />
        </>
      )
      : (
        <>
          <ProviderRowButton
            id={`coding-oauth-login-${definition.slug}`}
            disabled={busy}
            onClick={() => {
              onSignIn(primaryMethod)
            }}
          >
            {busy ? t('working') : methodLabel(primaryMethod, t)}
          </ProviderRowButton>
          <AltMethodButtons methods={altMethods} t={t} busy={busy} onSignIn={onSignIn} />
        </>
      )

  return (
    <ProviderRow
      name={title}
      status={providerStatus.status === 'signed-in'
        ? { tone: 'ok', label: t('signedIn') }
        : providerStatus.status === 'error'
          ? { tone: 'missing', label: t('requestFailed') }
          : undefined}
      actions={actions}
    >
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
      {providerStatus.status === 'signing-in' && definition.acceptsPastedRedirect === true ? (
        <PasteRedirectForm t={t} slug={definition.slug} busy={busy} onSubmit={onSubmitRedirect} />
      ) : null}
      {providerStatus.status === 'signed-in' && logoutConfirm ? (
        <fieldset style={{ ...nestedStyle, margin: 0, minWidth: 0, width: '100%', boxSizing: 'border-box' }}>
          <legend style={visuallyHiddenStyle}>{t('logoutConfirmTitle')}</legend>
          <p style={bodyStyle}>{t('logoutConfirmHint')}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <ProviderRowButton
              ref={logoutConfirmAction}
              tone="danger"
              disabled={busy}
              onClick={() => {
                restoreLogoutFocus.current = true
                onSignOut()
              }}
            >
              {busy ? t('working') : t('logoutConfirmAction')}
            </ProviderRowButton>
            <ProviderRowButton
              disabled={busy}
              onClick={() => {
                restoreLogoutFocus.current = true
                setLogoutConfirm(false)
              }}
            >
              {t('cancel')}
            </ProviderRowButton>
          </div>
        </fieldset>
      ) : null}
      {usageOpen ? (
        <div id={`coding-oauth-usage-${definition.slug}`}>
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
    </ProviderRow>
  )
}
