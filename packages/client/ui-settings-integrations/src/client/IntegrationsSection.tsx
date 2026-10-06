/** Personal skill import and connector account management. */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AccountIntegrationsView, ConnectorAuthorization, ConnectorCreateRequest, ConnectorId, ConnectorProvider, EmailConnectionRequest, EmailConnectionResult, EmailConnectionUpdate, SkillUploadFile, WhatsAppPairingView } from '@aeven/api-remotes/client'
import { SectionHeader, MarkdownText, Modal, IconCloseOutline16, IconChevronLeftOutline14 } from '@aeven/client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import css from './IntegrationsSection.module.css'
import { connectorIcons } from './connector-icons.ts'
import { EmailAccounts } from './EmailAccounts.tsx'
import { WhatsAppAccounts } from './WhatsAppAccounts.tsx'

/** Browser callbacks bound to the authenticated account Remote. */
export interface IntegrationsSectionInjected {
  hooks: { changes: HostObservable<number> }
  page: 'skills' | 'connectors'
  list: () => Promise<AccountIntegrationsView>
  importSkill: (files: SkillUploadFile[]) => Promise<void>
  setSkillEnabled: (name: string, enabled: boolean) => Promise<void>
  removeSkill: (name: string) => Promise<void>
  connect: (request: ConnectorCreateRequest) => Promise<ConnectorId>
  connectEmail: (request: EmailConnectionRequest) => Promise<EmailConnectionResult>
  updateEmail: (id: ConnectorId, request: EmailConnectionUpdate) => Promise<EmailConnectionResult>
  authorize: (provider: ConnectorProvider) => Promise<ConnectorAuthorization>
  setConnectorEnabled: (id: ConnectorId, enabled: boolean) => Promise<void>
  disconnect: (id: ConnectorId) => Promise<void>
  startWhatsAppPairing: () => Promise<WhatsAppPairingView>
  whatsAppPairing: (id: ConnectorId) => Promise<WhatsAppPairingView>
  cancelWhatsAppPairing: (id: ConnectorId) => Promise<void>
}

/** Settings slot props with locale and account operations. */
export type IntegrationsSectionProps = PropsRuntime<'settings.section'> & PropsLocale<'settings.integrations'> & InjectFace<IntegrationsSectionInjected>

type Connection = AccountIntegrationsView['connectors'][number]
type Provider = AccountIntegrationsView['providers'][number]

/** Marks drawn in a single dark color, which the black badge shows inverted. */
const MONOCHROME_ICONS: ReadonlySet<string> = new Set(['github', 'email'])

/** Read one uploaded file as browser-safe base64. */
function upload(file: File): Promise<SkillUploadFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => { reject(new Error('skill file could not be read')) }
    reader.onload = () => {
      const value = String(reader.result)
      resolve({ path: file.name, base64: value.slice(value.indexOf(',') + 1) })
    }
    reader.readAsDataURL(file)
  })
}

/**
 * The scrolling ancestor a section scrolls inside. The settings panel owns that
 * container, so the section only ever reaches it through its own root.
 * @param node - the section's root element.
 * @returns the nearest scrolling ancestor, or undefined when there is none.
 */
function scrollContainer(node: HTMLElement | null): HTMLElement | undefined {
  for (let current = node?.parentElement ?? null; current !== null; current = current.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(current).overflowY) && current.scrollHeight > current.clientHeight) return current
  }
  return undefined
}

/**
 * Render the caller's skills or connectors and their management actions.
 * @param props - localized account operations and selected page.
 * @returns the Settings page.
 */
export function IntegrationsSection(props: IntegrationsSectionProps) {
  const { page, t, list } = props
  const changes = props.useChanges(value => value)
  const requestVersion = useRef(0)
  const [snapshot, setSnapshot] = useState<AccountIntegrationsView>()
  // The address owns which skill or connector page is open, so a page can be linked and Back returns to the list.
  const selectedSkillId = page === 'skills' ? props.detail : undefined
  const selectedConnector = page === 'connectors' ? props.detail : undefined
  /** Connector skill whose instructions are open in a popup on the connector page. */
  const [connectorSkillId, setConnectorSkillId] = useState<string>()
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [failed, setFailed] = useState(false)
  const [form, setForm] = useState<'mcp' | 'github'>()
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [consent, setConsent] = useState<string>()
  const [pendingProvider, setPendingProvider] = useState<ConnectorProvider>()
  /** Set when turning Email or WhatsApp on opened its page, so adding an account starts right away. */
  const [addRequested, setAddRequested] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const sectionTop = useRef<HTMLDivElement>(null)
  const consentCard = useRef<HTMLDivElement>(null)
  /** Where the list sat when a detail took its place, so Back returns the reader to it. */
  const listOffset = useRef<number>()
  useEffect(() => { if (selectedConnector === undefined) { setConnectorSkillId(undefined); setForm(undefined); setToken(''); setAddRequested(false) } }, [selectedConnector])
  // A detail reads from its top; closing it puts the list back where the reader left it.
  useEffect(() => {
    if (selectedSkillId !== undefined || selectedConnector !== undefined) { sectionTop.current?.scrollIntoView({ block: 'start' }); return }
    const container = scrollContainer(sectionTop.current)
    if (container !== undefined && listOffset.current !== undefined) container.scrollTop = listOffset.current
  }, [selectedSkillId, selectedConnector])
  // A blocked popup falls back to the in-page consent link, which sits below the provider grid.
  useEffect(() => { if (consent !== undefined) consentCard.current?.scrollIntoView({ block: 'nearest' }) }, [consent])
  const [refreshes, setRefreshes] = useState(0)
  const refreshList = useCallback(() => { setRefreshes(count => count + 1) }, [])
  useEffect(() => {
    let active = true
    const refresh = (): void => {
      const version = ++requestVersion.current
      setFailed(false)
      void list().then((value) => {
        if (active && version === requestVersion.current) setSnapshot(value)
      }, () => {
        if (active && version === requestVersion.current) setFailed(true)
      })
    }
    refresh()
    window.addEventListener('focus', refresh)
    return () => { active = false; window.removeEventListener('focus', refresh) }
  }, [list, changes, refreshes])
  useEffect(() => {
    if (pendingProvider !== undefined && snapshot?.connectors.some(connector => connector.provider === pendingProvider && connector.connected)) {
      setConsent(undefined)
      setPendingProvider(undefined)
    }
  }, [snapshot, pendingProvider])
  const run = async (operation: () => Promise<unknown>): Promise<void> => {
    ++requestVersion.current
    setBusy(true)
    setFailed(false)
    try {
      await operation()
      const version = ++requestVersion.current
      const value = await list()
      if (version === requestVersion.current) setSnapshot(value)
    } catch {
      // Wire failures are shown with locale-owned copy; submitted credentials are never echoed.
      setFailed(true)
    } finally { setBusy(false) }
  }
  const openForm = (provider: 'mcp' | 'github'): void => {
    setForm(provider)
    setName(provider === 'github' ? t('github') : '')
    setUrl(provider === 'github' ? 'https://api.githubcopilot.com/mcp/' : '')
    setToken('')
  }
  /**
   * Open a skill's or connector's page, remembering the list's scroll offset first.
   * @param detail - the skill name or provider id whose page opens.
   */
  const openDetail = (detail: string): void => {
    listOffset.current = scrollContainer(sectionTop.current)?.scrollTop
    props.showDetail(detail)
  }
  /**
   * Open provider consent through the desktop bridge or a browser tab created during the click.
   * @param provider - provider whose registered application starts the consent flow.
   */
  const startSignIn = (provider: ConnectorProvider): void => {
    const desktop = (window as Window & { avnDesktop?: { browser?: { openExternal: (url: string) => Promise<void> } } }).avnDesktop?.browser
    const popup = desktop === undefined ? window.open('about:blank', '_blank') : null
    if (popup !== null) popup.opener = null
    setSigningIn(true)
    setConsent(undefined)
    setPendingProvider(provider)
    void run(async () => {
      try {
        const { url } = await props.authorize(provider)
        if (desktop !== undefined) await desktop.openExternal(url)
        else if (popup !== null) popup.location.href = url
        setConsent(url)
      } catch (error) {
        popup?.close()
        throw error
      }
    }).finally(() => { setSigningIn(false) })
  }

  const providerDetail = snapshot?.providers.find(provider => provider.provider === selectedConnector)
  const selectedSkill = snapshot?.skills.find(skill => skill.id === selectedSkillId)
  const connectorSkill = providerDetail?.skills.find(skill => skill.id === connectorSkillId)
  const matchingSkills = snapshot?.skills.filter(skill => `${skill.name} ${skill.description}`.toLowerCase().includes(query.trim().toLowerCase())) ?? []
  const connectorIcon = (provider: ConnectorProvider, large = false) => <span className={`${css.connectorBadge} ${large ? css.connectorBadgeLarge : ''}`} aria-hidden="true">
    {connectorIcons[provider] === undefined
      ? <span className={css.connectorMonogram}>MCP</span>
      : <img className={`${css.connectorIcon} ${MONOCHROME_ICONS.has(provider) ? css.connectorIconInverted : ''}`} src={connectorIcons[provider]} alt="" />}
  </span>
  const toggle = (label: string, on: boolean, disabled: boolean, onChange: () => void) => <button type="button" role="switch" aria-label={label} aria-checked={on} title={t(on ? 'on' : 'off')} className={`${css.switch} ${on ? css.switchOn : ''}`} disabled={busy || disabled} onClick={(event) => { event.stopPropagation(); onChange() }}><span className={css.thumb} /></button>
  const skillSwitch = (skill: AccountIntegrationsView['skills'][number]) => toggle(skill.name, skill.enabled, false, () => {
    void run(() => props.setSkillEnabled(skill.name, !skill.enabled))
  })
  /** One switch per provider: on means a signed-in connection is available in conversations; off means disconnected. */
  const stateOf = (provider: Provider) => {
    const connections: readonly Connection[] = snapshot?.connectors.filter(connection => connection.provider === provider.provider) ?? []
    const live = connections.filter(connection => connection.connected)
    // A provider without sign-in configured can still connect through a token form.
    const connectable = live.length > 0 || provider.configured || provider.provider === 'mcp' || provider.provider === 'github'
    // Email is available exactly when the deployment mounts the mail capability; WhatsApp when this host has its daemon.
    if (provider.provider === 'email' || provider.provider === 'whatsapp') return { connections, live, on: live.some(connection => connection.enabled), expired: connections.length > 0 && live.length === 0, connectable: provider.configured }
    const on = live.some(connection => connection.enabled)
    return { connections, live, on, expired: connections.length > 0 && live.length === 0, connectable }
  }
  const disconnectAll = (connections: readonly Connection[]): void => {
    void run(async () => {
      for (const connection of connections) await props.disconnect(connection.id)
      if (connections.some(connection => connection.provider === pendingProvider)) {
        setConsent(undefined)
        setPendingProvider(undefined)
      }
    })
  }
  const switchProvider = (provider: Provider): void => {
    const { connections, live, on, connectable } = stateOf(provider)
    // Email accounts and WhatsApp numbers each hold their own sign-in, so the provider switch pauses them instead of removing them.
    if (provider.provider === 'email' || provider.provider === 'whatsapp') {
      if (on) { void run(async () => { for (const connection of live) if (connection.enabled) await props.setConnectorEnabled(connection.id, false) }); return }
      if (live.length > 0) { void run(async () => { for (const connection of live) await props.setConnectorEnabled(connection.id, true) }); return }
      openDetail(provider.provider)
      if (connectable) setAddRequested(true)
      return
    }
    // Off disconnects: a user sees no use in a paused state between connected and not connected.
    if (on) { disconnectAll(connections); return }
    // A connection disabled before the switch meant disconnect turns back on without a new sign-in.
    if (live.length > 0) {
      void run(async () => { for (const connection of live) await props.setConnectorEnabled(connection.id, true) })
      return
    }
    if (provider.provider !== 'mcp' && provider.configured) { startSignIn(provider.provider); return }
    // Without sign-in or a token form there is nothing to turn on; the page says what setup is missing.
    openDetail(provider.provider)
    if (provider.provider === 'github' || provider.provider === 'mcp') openForm(provider.provider)
  }
  /** In the list, a switch that cannot connect opens the page explaining the missing setup; on that page it is disabled. */
  const providerSwitch = (provider: Provider, onPage = false) => {
    const { on, connectable } = stateOf(provider)
    return toggle(t(provider.provider), on, onPage && !connectable, () => { switchProvider(provider) })
  }
  const providerHint = (provider: Provider): string | undefined => {
    const { expired, connectable } = stateOf(provider)
    if (expired) return t(provider.provider === 'email' ? 'emailReconnect' : provider.provider === 'whatsapp' ? 'whatsappRelink' : 'reconnectHint')
    if (connectable) return undefined
    if (provider.provider === 'email') return t('emailSetupRequired')
    if (provider.provider === 'whatsapp') return t('whatsappUnavailable')
    return t(['gmail', 'google-drive', 'google-calendar'].includes(provider.provider) ? 'googleSetupRequired' : 'setupRequired')
  }
  const connectForm = (provider: 'mcp' | 'github') => <form className={css.card} onSubmit={(event) => {
    event.preventDefault()
    void run(async () => {
      await props.connect({ provider, name, endpoint: url, ...token === '' ? {} : { token } })
      setToken(''); setForm(undefined)
    })
  }}>
    <label className={css.field}>{t('name')}<input autoFocus required value={name} disabled={busy} onChange={(event) => { setName(event.currentTarget.value) }} /></label>
    <label className={css.field}>{t('endpoint')}<input required type="url" value={url} disabled={busy} onChange={(event) => { setUrl(event.currentTarget.value) }} /></label>
    <label className={css.field}>{t('token')}<input type="password" autoComplete="off" value={token} disabled={busy} onChange={(event) => { setToken(event.currentTarget.value) }} /></label>
    <p className={css.hint}>{t('tokenHint')}</p>
    <div className={css.actions}><button type="submit" className={css.primaryAction} disabled={busy}>{t('connect')}</button><button type="button" className={css.secondaryAction} disabled={busy} onClick={() => { setToken(''); setForm(undefined) }}>{t('cancel')}</button></div>
  </form>
  const catalogVisible = (page === 'skills' ? selectedSkillId : selectedConnector) === undefined
  const skillMeta = (skill: AccountIntegrationsView['skills'][number]) => [
    skill.workspace ?? skill.source,
    ...skill.available === false ? [t('needsConnector')] : [],
  ].join(' · ')
  return <div ref={sectionTop} className={`${css.section} ${css.compact}`}>
    {catalogVisible && <SectionHeader title={t(page)} description={t(page === 'skills' ? 'skillsIntro' : 'connectorsIntro')} />}
    {busy && <p role="status" className={css.hint}>{t(signingIn ? 'openingSignIn' : 'working')}</p>}
    {failed && <p role="alert">{t('failed')}</p>}
    {snapshot === undefined && !failed && <p role="status">{t('loading')}</p>}
    {page === 'skills' ? <>
      <input ref={fileInput} type="file" accept=".md,.zip,.skill" className={css.upload} aria-label={t('import')} onChange={(event) => {
        const file = event.currentTarget.files?.[0]
        if (file !== undefined) void run(async () => { await props.importSkill([await upload(file)]) })
        event.currentTarget.value = ''
      }} />
      {selectedSkillId === undefined ? <>
        <div className={css.toolbar}>
          <input
            className={css.search}
            type="search"
            aria-label={t('searchSkills')}
            placeholder={t('searchSkills')}
            value={query}
            onChange={(event) => { setQuery(event.currentTarget.value) }}
          />
          <button type="button" className={css.primaryAction} disabled={busy} title={t('importHint')} onClick={() => { fileInput.current?.click() }}>{t('import')}</button>
        </div>
        {snapshot?.skills.length === 0 && <p className={css.hint}>{t('skillsEmpty')}</p>}
        {snapshot !== undefined && snapshot.skills.length > 0 && matchingSkills.length === 0 && <p className={css.hint}>{t('noMatches')}</p>}
        <div className={css.connectorList}>{matchingSkills.map(skill => <article key={skill.id} className={css.connectorRow}>
          <button type="button" className={css.connectorOpen} onClick={() => { openDetail(skill.id) }}>
            <span className={css.skillSummary}>
              <strong>{skill.name}</strong>
              <span className={css.connectorDescription}>{skill.description}</span>
              <span className={css.meta}>{skillMeta(skill)}</span>
            </span>
          </button>
          {skillSwitch(skill)}
        </article>)}</div>
      </> : selectedSkill === undefined
        ? snapshot !== undefined && <p className={css.hint}>{t('skillMissing')}</p>
        : <article className={`${css.connectorDetail} ${css.skillContent}`}>
          <div className={css.connectorHeading}><h2>{selectedSkill.name}</h2>{skillSwitch(selectedSkill)}</div>
          <p className={css.detailDescription}>{selectedSkill.description}</p>
          <p className={css.meta}>{[skillMeta(selectedSkill), t(selectedSkill.managed ? 'personalSkill' : 'readOnlySkill')].join(' · ')}</p>
          <div className={css.instructions}>
            <MarkdownText
              key={selectedSkill.id}
              text={selectedSkill.content}
              animation={false}
              labels={{ code: { copyLabel: t('copy'), copiedLabel: t('copied') }, footnotes: t('footnotes') }}
            />
          </div>
          {selectedSkill.files.length > 0 && <div>
            <h3>{t('files')}</h3>
            <ul className={css.fileList}>{selectedSkill.files.map(path => <li key={path}>{path}</li>)}</ul>
          </div>}
          {selectedSkill.managed && <button type="button" className={css.textAction} disabled={busy} onClick={() => {
            void run(async () => { await props.removeSkill(selectedSkill.name); props.showDetail(undefined) })
          }}>{t('removeSkill')}</button>}
        </article>}
    </> : <>
      {providerDetail === undefined ? <div className={css.connectorList}>{snapshot?.providers.map(provider => <article
        key={provider.provider}
        className={css.connectorRow}
      >
        <button type="button" className={css.connectorOpen} onClick={() => { openDetail(provider.provider) }}>
          {connectorIcon(provider.provider)}
          <span className={css.skillSummary}><strong>{t(provider.provider)}</strong><span className={css.connectorDescription}>{t(`${provider.provider}Description`)}</span>{stateOf(provider).expired && <span className={css.attention}>{providerHint(provider)}</span>}</span>
        </button>
        {providerSwitch(provider)}
      </article>)}</div> : <article className={css.connectorDetail}>
        <div className={css.connectorHeading}>
          {connectorIcon(providerDetail.provider, true)}
          <h2>{t(providerDetail.provider)}</h2>
          {providerDetail.provider !== 'mcp' && providerDetail.provider !== 'email' && providerDetail.provider !== 'whatsapp' && providerSwitch(providerDetail, true)}
        </div>
        <p className={css.detailDescription}>{t(`${providerDetail.provider}Description`)}</p>
        {providerDetail.provider === 'email' ? providerDetail.configured
          ? <EmailAccounts
            t={t}
            busy={busy}
            connections={stateOf(providerDetail).connections}
            run={run}
            toggle={toggle}
            connectEmail={props.connectEmail}
            updateEmail={props.updateEmail}
            setConnectorEnabled={props.setConnectorEnabled}
            disconnect={props.disconnect}
            startWithForm={addRequested}
          />
          : <p className={css.hint}>{t('emailSetupRequired')}</p>
        : providerDetail.provider === 'whatsapp' ? providerDetail.configured
          ? <WhatsAppAccounts
            t={t}
            busy={busy}
            connections={stateOf(providerDetail).connections}
            run={run}
            toggle={toggle}
            startWhatsAppPairing={props.startWhatsAppPairing}
            whatsAppPairing={props.whatsAppPairing}
            cancelWhatsAppPairing={props.cancelWhatsAppPairing}
            setConnectorEnabled={props.setConnectorEnabled}
            disconnect={props.disconnect}
            refresh={refreshList}
            startWithPairing={addRequested}
          />
          : <p className={css.hint}>{t('whatsappUnavailable')}</p>
        : providerDetail.provider === 'mcp' ? <>
          <div className={css.serverList}>{stateOf(providerDetail).connections.map(connection => <div
            key={connection.id}
            className={css.serverRow}
          >
            <span className={css.skillSummary}>
              <strong>{connection.name}</strong>
              <span className={css.address}>{connection.endpoint}</span>
              {!connection.connected && <span className={css.attention}>{t('serverUnavailable')}</span>}
            </span>
            <button type="button" className={css.textAction} disabled={busy} onClick={() => { disconnectAll([connection]) }}>{t('remove')}</button>
          </div>)}</div>
          {form === undefined && <button type="button" className={css.secondaryAction} disabled={busy} onClick={() => { openForm('mcp') }}>{t('addServer')}</button>}
        </> : <>
          {providerHint(providerDetail) !== undefined && <p className={css.hint}>{providerHint(providerDetail)}</p>}
          <div className={css.actions}>
            {providerDetail.provider === 'github' && stateOf(providerDetail).live.length === 0 && form === undefined && <button type="button" className={css.textAction} disabled={busy} onClick={() => { openForm('github') }}>{t('useToken')}</button>}
          </div>
        </>}
        {form !== undefined && connectForm(form)}
        {providerDetail.skills.length > 0 && <>
          <h3>{t('skills')}</h3>
          <p className={css.hint}>{t('connectorSkillsHint')}</p>
          <div className={css.connectorList}>{providerDetail.skills.map(skill => <article key={skill.id} className={css.connectorRow}>
            <button type="button" className={css.connectorOpen} onClick={() => { setConnectorSkillId(skill.id) }} aria-haspopup="dialog">
              <span className={css.skillSummary}>
                <strong>{skill.name}</strong>
                <span className={css.connectorDescription}>{skill.description}</span>
              </span>
            </button>
          </article>)}</div>
        </>}
        {connectorSkill !== undefined && <Modal open headless onClose={() => { setConnectorSkillId(undefined) }} title={connectorSkill.name} className={`${css.section} ${css.compact} ${css.skillModal}`}>
          <header className={css.skillModalHeader}><h2>{connectorSkill.name}</h2><button type="button" className={css.skillModalClose} aria-label={t('close')} onClick={() => { setConnectorSkillId(undefined) }}><IconCloseOutline16 size={14} /></button></header>
          <div className={`${css.skillModalContent} ${css.skillContent} no-scrollbar`}><p className={css.detailDescription}>{connectorSkill.description}</p><MarkdownText key={connectorSkill.id} text={connectorSkill.content} animation={false} controls={{ table: false }} labels={{ code: { copyLabel: t('copy'), copiedLabel: t('copied') }, footnotes: t('footnotes') }} /></div>
        </Modal>}
      </article>}
      {consent !== undefined && <div ref={consentCard} className={css.card}><a href={consent} target="_blank" rel="noreferrer" onClick={(event) => {
        const desktop = (window as Window & { avnDesktop?: { browser?: { openExternal: (url: string) => Promise<void> } } }).avnDesktop?.browser
        if (desktop !== undefined) { event.preventDefault(); void run(() => desktop.openExternal(consent)) }
      }}>{t('consent')}</a><p className={css.hint}>{t('consentHint')}</p></div>}
    </>}
  </div>
}

/** Settings header action for returning from a skill or connector page to its list. */
export type DetailBackProps = PropsRuntime<'settings.action'> & PropsLocale<'settings.integrations'>

/**
 * Render the skill and connector pages' header navigation.
 * @param props - the active section's address and localized button label.
 * @returns a back button while a skill or connector page is open.
 */
export function DetailBack(props: DetailBackProps) {
  if ((props.section !== 'skills' && props.section !== 'connectors') || props.detail === undefined) return null
  const label = props.t(props.section === 'skills' ? 'backToSkills' : 'backToConnectors')
  return <button type="button" data-settings-back className={css.detailBack} aria-label={label} title={label} onClick={() => { props.showDetail(undefined) }}>
    <IconChevronLeftOutline14 />
  </button>
}
