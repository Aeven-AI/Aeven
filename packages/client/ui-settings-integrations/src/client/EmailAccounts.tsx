/** Email connector page: one row per mailbox and the add-account form with provider presets. */

import { useState, type ReactNode } from 'react'
import type { AccountIntegrationsView, ConnectorId, EmailConnectionRequest, EmailConnectionResult, EmailConnectionUpdate, EmailSecurity, EmailServerSettings } from '@aeven/api-remotes/client'
import { IconEditOutline16, IconTrashOutline16, Spinner } from '@aeven/client-ui-primitives'
import type { PropsLocale } from '@aeven/client-ui-slots'
import css from './IntegrationsSection.module.css'

type Connection = AccountIntegrationsView['connectors'][number]
type Protocol = 'imap' | 'pop3'
type Translate = PropsLocale<'settings.integrations'>['t']

/** Known server settings by address domain; other domains get `imap.`, `pop.`, and `smtp.` guesses. */
const PRESETS: Record<string, { imap?: string; pop3?: string; smtp: string; smtpPort: number; smtpSecurity: EmailSecurity }> = {
  'gmail.com': { imap: 'imap.gmail.com', pop3: 'pop.gmail.com', smtp: 'smtp.gmail.com', smtpPort: 465, smtpSecurity: 'tls' },
  'googlemail.com': { imap: 'imap.gmail.com', pop3: 'pop.gmail.com', smtp: 'smtp.gmail.com', smtpPort: 465, smtpSecurity: 'tls' },
  'outlook.com': { imap: 'outlook.office365.com', pop3: 'outlook.office365.com', smtp: 'smtp-mail.outlook.com', smtpPort: 587, smtpSecurity: 'starttls' },
  'hotmail.com': { imap: 'outlook.office365.com', pop3: 'outlook.office365.com', smtp: 'smtp-mail.outlook.com', smtpPort: 587, smtpSecurity: 'starttls' },
  'live.com': { imap: 'outlook.office365.com', pop3: 'outlook.office365.com', smtp: 'smtp-mail.outlook.com', smtpPort: 587, smtpSecurity: 'starttls' },
  'icloud.com': { imap: 'imap.mail.me.com', smtp: 'smtp.mail.me.com', smtpPort: 587, smtpSecurity: 'starttls' },
  'me.com': { imap: 'imap.mail.me.com', smtp: 'smtp.mail.me.com', smtpPort: 587, smtpSecurity: 'starttls' },
  'mac.com': { imap: 'imap.mail.me.com', smtp: 'smtp.mail.me.com', smtpPort: 587, smtpSecurity: 'starttls' },
  'yahoo.com': { imap: 'imap.mail.yahoo.com', pop3: 'pop.mail.yahoo.com', smtp: 'smtp.mail.yahoo.com', smtpPort: 465, smtpSecurity: 'tls' },
  'fastmail.com': { imap: 'imap.fastmail.com', pop3: 'pop.fastmail.com', smtp: 'smtp.fastmail.com', smtpPort: 465, smtpSecurity: 'tls' },
  'gmx.net': { imap: 'imap.gmx.net', pop3: 'pop.gmx.net', smtp: 'mail.gmx.net', smtpPort: 587, smtpSecurity: 'starttls' },
  'gmx.de': { imap: 'imap.gmx.net', pop3: 'pop.gmx.net', smtp: 'mail.gmx.net', smtpPort: 587, smtpSecurity: 'starttls' },
  'web.de': { imap: 'imap.web.de', pop3: 'pop3.web.de', smtp: 'smtp.web.de', smtpPort: 587, smtpSecurity: 'starttls' },
}

/** Server fields edited as text so a partly typed port stays visible. */
interface ServerDraft { host: string; port: string; security: EmailSecurity; username: string }

/** Suggested servers for an address and receive protocol. */
function suggest(address: string, protocol: Protocol): { receive: ServerDraft; send: ServerDraft } {
  const domain = address.slice(address.lastIndexOf('@') + 1).trim().toLowerCase()
  const preset = PRESETS[domain]
  const username = address.trim()
  return {
    receive: {
      host: (protocol === 'imap' ? preset?.imap : preset?.pop3) ?? (domain === '' ? '' : `${protocol === 'imap' ? 'imap' : 'pop'}.${domain}`),
      port: protocol === 'imap' ? '993' : '995', security: 'tls', username,
    },
    send: {
      host: preset?.smtp ?? (domain === '' ? '' : `smtp.${domain}`),
      port: String(preset?.smtpPort ?? 587), security: preset?.smtpSecurity ?? 'starttls', username,
    },
  }
}

function server(draft: ServerDraft): EmailServerSettings {
  return { host: draft.host.trim(), port: Number(draft.port), security: draft.security, username: draft.username.trim() }
}

/** Props from the connector page. */
export interface EmailAccountsProps {
  t: Translate
  busy: boolean
  connections: readonly Connection[]
  /** The page's operation runner: shows progress, refreshes the list, and reports thrown failures. */
  run: (operation: () => Promise<unknown>) => Promise<void>
  /** The page's switch control. */
  toggle: (label: string, on: boolean, disabled: boolean, onChange: () => void) => ReactNode
  connectEmail: (request: EmailConnectionRequest) => Promise<EmailConnectionResult>
  updateEmail: (id: ConnectorId, request: EmailConnectionUpdate) => Promise<EmailConnectionResult>
  setConnectorEnabled: (id: ConnectorId, enabled: boolean) => Promise<void>
  disconnect: (id: ConnectorId) => Promise<void>
  /** Open the add-account form on first render, when the page was reached by turning the connector on. */
  startWithForm: boolean
}

/**
 * Render the email accounts and the add-account form.
 * @param props - page state and account operations.
 * @returns the email connector page body.
 */
export function EmailAccounts(props: EmailAccountsProps) {
  const { t, busy } = props
  const [open, setOpen] = useState(props.startWithForm)
  /** The account being edited; absent while adding. */
  const [editing, setEditing] = useState<ConnectorId>()
  const [testing, setTesting] = useState(false)
  const [address, setAddress] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [aliases, setAliases] = useState('')
  const [protocol, setProtocol] = useState<Protocol>('imap')
  const [sendEnabled, setSendEnabled] = useState(true)
  const [separateSendPassword, setSeparateSendPassword] = useState(false)
  const [sendPassword, setSendPassword] = useState('')
  /** Edited server fields; absent means the suggestion for the current address applies. */
  const [receiveEdit, setReceiveEdit] = useState<ServerDraft>()
  const [sendEdit, setSendEdit] = useState<ServerDraft>()
  const [failure, setFailure] = useState<string>()
  const suggestion = suggest(address, protocol)
  const receive = receiveEdit ?? suggestion.receive
  const send = sendEdit ?? suggestion.send

  const reset = (): void => {
    setOpen(false); setEditing(undefined); setAddress(''); setPassword(''); setName(''); setAliases(''); setProtocol('imap'); setSendEnabled(true)
    setSeparateSendPassword(false); setSendPassword(''); setReceiveEdit(undefined); setSendEdit(undefined); setFailure(undefined)
  }
  const describe = (result: Extract<EmailConnectionResult, { kind: 'failed' }>): string => {
    const reason = {
      authentication: t('emailFailAuthentication'), connection: t('emailFailConnection'), tls: t('emailFailTls'), invalid: t('emailFailInvalid'),
      duplicate: t('emailFailDuplicate'), limit: t('emailFailLimit'), unavailable: t('emailFailUnavailable'), other: t('emailFailOther'),
    }[result.reason]
    if (result.step === undefined) return reason
    return `${t(result.step.startsWith('receive') ? 'emailIncoming' : 'emailOutgoing')}: ${reason}`
  }
  /** Open the form filled with a saved account; blank passwords keep the stored ones. */
  const edit = (connection: Connection): void => {
    const email = connection.email
    if (email === undefined) return
    const draft = (value: EmailServerSettings): ServerDraft => ({ host: value.host, port: String(value.port), security: value.security, username: value.username })
    setEditing(connection.id); setOpen(true); setFailure(undefined)
    setAddress(email.address); setPassword(''); setSendPassword(''); setSeparateSendPassword(false)
    setName(connection.name === email.address ? '' : connection.name); setAliases(email.aliases.join(', '))
    setProtocol(email.receive.protocol); setReceiveEdit(draft(email.receive))
    setSendEnabled(email.send !== undefined); setSendEdit(email.send === undefined ? undefined : draft(email.send))
  }
  const submit = (): void => {
    setFailure(undefined)
    setTesting(true)
    const fields = {
      address: address.trim(),
      aliases: aliases.split(',').map(alias => alias.trim()).filter(alias => alias !== ''),
      receive: { protocol, ...server(receive) },
      ...sendEnabled ? { send: server(send) } : {},
      ...name.trim() !== '' ? { name: name.trim() } : {},
      ...sendEnabled && separateSendPassword && sendPassword !== '' ? { sendPassword } : {},
    }
    void props.run(async () => {
      const result = editing === undefined
        ? await props.connectEmail({ ...fields, receivePassword: password })
        : await props.updateEmail(editing, { ...fields, ...password !== '' ? { receivePassword: password } : {} })
      if (result.kind === 'failed') { setFailure(describe(result)); return }
      reset()
    }).finally(() => { setTesting(false) })
  }
  const serverFields = (label: string, draft: ServerDraft, update: (draft: ServerDraft) => void, securityChoices: readonly EmailSecurity[]) => <fieldset className={css.serverFields}>
    <legend>{label}</legend>
    <label className={css.field}>{t('emailHost')}<input required value={draft.host} disabled={busy} onChange={(event) => { update({ ...draft, host: event.currentTarget.value }) }} /></label>
    <div className={css.fieldRow}>
      <label className={css.field}>{t('emailPort')}<input required inputMode="numeric" pattern="[0-9]{1,5}" value={draft.port} disabled={busy} onChange={(event) => { update({ ...draft, port: event.currentTarget.value }) }} /></label>
      <label className={css.field}>{t('emailSecurity')}<select value={draft.security} disabled={busy || securityChoices.length === 1} onChange={(event) => { update({ ...draft, security: event.currentTarget.value as EmailSecurity }) }}>
        {securityChoices.map(choice => <option key={choice} value={choice}>{t(choice === 'tls' ? 'emailTls' : 'emailStarttls')}</option>)}
      </select></label>
    </div>
    <label className={css.field}>{t('emailUsername')}<input required autoComplete="off" value={draft.username} disabled={busy} onChange={(event) => { update({ ...draft, username: event.currentTarget.value }) }} /></label>
  </fieldset>

  return <>
    <div className={css.serverList}>{props.connections.map(connection => <div key={connection.id} className={css.serverRow}>
      <span className={css.skillSummary}>
        <strong>{connection.name}</strong>
        {connection.email !== undefined && <span className={css.address}>
          {[connection.name === connection.email.address ? undefined : connection.email.address, `${connection.email.receive.protocol.toUpperCase()} ${connection.email.receive.host}`,
            connection.email.send === undefined ? t('emailReceiveOnly') : `SMTP ${connection.email.send.host}`].filter(Boolean).join(' · ')}
        </span>}
        {!connection.connected && <span className={css.attention}>{t('emailReconnect')}</span>}
      </span>
      <button type="button" className={css.iconAction} aria-label={t('emailEdit')} title={t('emailEdit')} disabled={busy} onClick={() => { edit(connection) }}><IconEditOutline16 /></button>
      <button type="button" className={css.iconAction} aria-label={t('remove')} title={t('remove')} disabled={busy} onClick={() => {
        if (editing === connection.id) reset()
        void props.run(() => props.disconnect(connection.id))
      }}><IconTrashOutline16 /></button>
      {props.toggle(connection.name, connection.enabled && connection.connected, !connection.connected, () => {
        void props.run(() => props.setConnectorEnabled(connection.id, !connection.enabled))
      })}
    </div>)}</div>
    {!open && <button type="button" className={css.secondaryAction} disabled={busy} onClick={() => { setOpen(true) }}>{t('emailAdd')}</button>}
    {open && <form className={css.card} onSubmit={(event) => { event.preventDefault(); submit() }}>
      <label className={css.field}>{t('emailAddress')}<input autoFocus required type="email" autoComplete="off" value={address} disabled={busy} onChange={(event) => { setAddress(event.currentTarget.value) }} /></label>
      <label className={css.field}>{t('emailPassword')}<input required={editing === undefined} type="password" autoComplete="off" placeholder={editing === undefined ? undefined : t('emailKeepPassword')} value={password} disabled={busy} onChange={(event) => { setPassword(event.currentTarget.value) }} /></label>
      <p className={css.hint}>{t('emailPasswordHint')}</p>
      <label className={css.field}>{t('emailProtocol')}<select value={protocol} disabled={busy} onChange={(event) => {
        const next = event.currentTarget.value as Protocol
        setProtocol(next)
        setReceiveEdit(undefined)
      }}>
        <option value="imap">{t('emailImap')}</option>
        <option value="pop3">{t('emailPop3')}</option>
      </select></label>
      <label className={css.check}><input type="checkbox" checked={sendEnabled} disabled={busy} onChange={(event) => { setSendEnabled(event.currentTarget.checked) }} />{t('emailSendEnabled')}</label>
      <div className={css.advancedBody}>
          {serverFields(t('emailIncoming'), receive, setReceiveEdit, protocol === 'pop3' ? ['tls'] : ['tls', 'starttls'])}
          {sendEnabled && serverFields(t('emailOutgoing'), send, setSendEdit, ['tls', 'starttls'])}
          {sendEnabled && <label className={css.check}><input type="checkbox" checked={separateSendPassword} disabled={busy} onChange={(event) => { setSeparateSendPassword(event.currentTarget.checked) }} />{t('emailSeparateSendPassword')}</label>}
          {sendEnabled && separateSendPassword && <label className={css.field}>{t('emailSendPassword')}<input type="password" autoComplete="off" placeholder={editing === undefined ? undefined : t('emailKeepPassword')} value={sendPassword} disabled={busy} onChange={(event) => { setSendPassword(event.currentTarget.value) }} /></label>}
          <label className={css.field}>{t('emailAliases')}<input value={aliases} disabled={busy} onChange={(event) => { setAliases(event.currentTarget.value) }} /></label>
          <label className={css.field}>{t('name')}<input value={name} placeholder={address} disabled={busy} onChange={(event) => { setName(event.currentTarget.value) }} /></label>
      </div>
      {testing && <p role="status" className={css.testing}><Spinner />{t('emailTesting')}</p>}
      {failure !== undefined && <p role="alert" className={css.error}>{failure}</p>}
      <p className={css.hint}>{t('tokenHint')}</p>
      <div className={css.actions}>
        <button type="submit" className={css.primaryAction} disabled={busy}>{t(editing === undefined ? 'connect' : 'emailSave')}</button>
        <button type="button" className={css.secondaryAction} disabled={busy} onClick={reset}>{t('cancel')}</button>
      </div>
    </form>}
  </>
}
