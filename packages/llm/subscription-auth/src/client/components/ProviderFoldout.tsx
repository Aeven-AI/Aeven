/**
 * One subscription provider as a Providers card: a header naming the provider
 * and its sign-in state that discloses the account in place. The open card
 * holds the sign-in steps or the usage and models, with the sign-in and
 * sign-out actions in its footer. Disclosure is card-local state, like the
 * Plugins cards it mirrors.
 */

import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { IconChevronDownOutline14, StateDot } from '@aeven/client-ui-primitives'
import {
  bodyStyle,
  cardBodyStyle,
  cardFooterStyle,
  cardHeaderStyle,
  cardNameStyle,
  cardDescriptionStyle,
  chevronStyle,
  codeStyle,
  dangerButtonStyle,
  errorStyle,
  foldoutStyle,
  linkStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  statusLabelStyle,
} from '../styles.ts'
import type {
  GrokBuildSettingsInjected,
  ProviderCardDefinition,
  ProviderStatus,
  UsageSlotView,
} from '../types.ts'
import { CopyButton } from './CopyButton.tsx'
import { ModelsList } from './ModelsList.tsx'
import { UsageSection } from './UsageSection.tsx'

export interface ProviderFoldoutProps {
  t: GrokBuildSettingsInjected['t']
  definition: ProviderCardDefinition
  providerStatus: ProviderStatus
  /** A sign-in, sign-out, or cancel request is in flight. */
  busy: boolean
  /** A model selection write is in flight. */
  savingModels: boolean
  /** The browser blocked the provider tab, so the sign-in link is shown instead. */
  popupBlocked: boolean
  usage: UsageSlotView | undefined
  onRefreshUsage: () => void
  onSignIn: () => void
  onSignOut: () => void
  onCancelLogin: () => void
  onSelectModels: (selected: readonly string[]) => void
  /** Electron opens provider links through the external-browser bridge. */
  onOpenAuthUrl?: (event: MouseEvent<HTMLAnchorElement>, url: string) => void
}

function statusLabel(providerStatus: ProviderStatus, t: GrokBuildSettingsInjected['t']): string {
  switch (providerStatus.status) {
    case 'signed-in':
      return t('signedIn')
    case 'signing-in':
      return t('signingIn')
    case 'error':
      return t('requestFailed')
    case 'signed-out':
      return t('signedOut')
  }
}

/** Where a pending sign-in waits on the user: the provider page to open and, for a device flow, the code to enter there. */
function SignInSteps({ t, url, userCode, onOpenAuthUrl }: { t: GrokBuildSettingsInjected['t']; url?: string | undefined; userCode?: string | undefined; onOpenAuthUrl?: ProviderFoldoutProps['onOpenAuthUrl'] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {userCode === undefined || userCode.length === 0 ? null : (
        <>
          <p style={bodyStyle}>{t('userCode')}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <span style={codeStyle}>{userCode}</span>
            <CopyButton text={userCode} idleLabel={t('copyUserCode')} copiedLabel={t('copied')} failedLabel={t('copyFailed')} />
          </div>
        </>
      )}
      {url === undefined || url.length === 0 ? null : (
        <a href={url} target="_blank" rel="noreferrer" style={linkStyle} onClick={event => onOpenAuthUrl?.(event, url)}>
          {t('openAuthUrl')}
        </a>
      )}
    </div>
  )
}

/**
 * Render one provider card.
 * @param props - the provider's state, its usage, and the card actions.
 * @returns the card.
 */
export function ProviderFoldout(props: ProviderFoldoutProps) {
  const { t, definition, providerStatus, busy } = props
  const [open, setOpen] = useState(false)
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const confirmAction = useRef<HTMLButtonElement>(null)
  const title = t(definition.titleKey)
  const status = providerStatus.status

  // A sign-in in progress needs the user, so its card opens on its own.
  useEffect(() => {
    if (status === 'signing-in') setOpen(true)
    if (status !== 'signed-in') setConfirmSignOut(false)
  }, [status])
  useEffect(() => {
    if (confirmSignOut) confirmAction.current?.focus()
  }, [confirmSignOut])

  const showSteps = status === 'signing-in' && (providerStatus.method === 'device' || props.popupBlocked)

  return (
    <li style={foldoutStyle(open)}>
      <button
        type="button"
        style={cardHeaderStyle}
        aria-expanded={open}
        aria-label={`${t(open ? 'collapse' : 'expand')}: ${title}`}
        onClick={() => { setOpen(!open) }}
      >
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={cardNameStyle}>{title}</span>
          <span style={cardDescriptionStyle}>{t(definition.descriptionKey)}</span>
        </span>
        {/* Signed in is the resting state, so its dot stands alone and the
            label stays available to assistive technology and on hover. */}
        {status === 'signed-in'
          ? (
            <span style={statusLabelStyle} role="img" aria-label={statusLabel(providerStatus, t)} title={statusLabel(providerStatus, t)}>
              <StateDot state="done" />
            </span>
          )
          : status === 'signed-out'
            // Signed out shows nothing: the card's sign-in action says it.
            ? null
            : (
              <span style={statusLabelStyle}>
                {status === 'signing-in' ? <StateDot state="ongoing" /> : null}
                {status === 'error' ? <StateDot state="error" /> : null}
                {statusLabel(providerStatus, t)}
              </span>
            )}
        <span style={chevronStyle(open)}><IconChevronDownOutline14 /></span>
      </button>
      {open ? (
        <div style={cardBodyStyle}>
          {status === 'error' ? <p style={errorStyle} role="alert">{providerStatus.message}</p> : null}
          {status === 'signed-out' ? <p style={bodyStyle}>{t('signInHint')}</p> : null}
          {status === 'signing-in' ? (
            showSteps
              ? <SignInSteps t={t} url={providerStatus.url} userCode={providerStatus.userCode} onOpenAuthUrl={props.onOpenAuthUrl} />
              : <p style={bodyStyle}>{t('signingInHint')}</p>
          ) : null}
          {status === 'signed-in' ? (
            <>
              <UsageSection
                usage={props.usage?.usage}
                error={props.usage?.error}
                loading={props.usage?.loading === true}
                t={t}
                style={{ display: 'flex', flexDirection: 'column' }}
                onRefresh={props.onRefreshUsage}
              />
              <ModelsList t={t} models={providerStatus.models} busy={props.savingModels} onChange={props.onSelectModels} />
            </>
          ) : null}
          <div style={cardFooterStyle}>
            {status === 'signed-in' && confirmSignOut ? (
              <>
                <p style={{ ...bodyStyle, flex: 1, minWidth: 0 }}>{t('logoutConfirmHint')}</p>
                <button type="button" style={secondaryButtonStyle} disabled={busy} onClick={() => { setConfirmSignOut(false) }}>
                  {t('cancel')}
                </button>
                <button ref={confirmAction} type="button" style={dangerButtonStyle} disabled={busy} onClick={props.onSignOut}>
                  {busy ? t('working') : t('logoutConfirmAction')}
                </button>
              </>
            ) : null}
            {status === 'signed-in' && !confirmSignOut ? (
              <button type="button" style={secondaryButtonStyle} disabled={busy} onClick={() => { setConfirmSignOut(true) }}>
                {t('logout')}
              </button>
            ) : null}
            {status === 'signing-in' ? (
              <button type="button" style={secondaryButtonStyle} disabled={busy} onClick={props.onCancelLogin}>
                {t('cancelLogin')}
              </button>
            ) : null}
            {status === 'signed-out' || status === 'error' ? (
              <button type="button" style={primaryButtonStyle} disabled={busy} onClick={props.onSignIn}>
                {busy ? t('working') : t('signIn')}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  )
}
