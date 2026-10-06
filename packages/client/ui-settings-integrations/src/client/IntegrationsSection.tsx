/** Personal skill import and connector account management. */

import { useEffect, useRef, useState } from 'react'
import type { AccountIntegrationsView, ConnectorAuthorization, ConnectorCreateRequest, ConnectorId, ConnectorProvider, SkillUploadFile } from '@aeven/api-remotes/client'
import { SectionHeader, MarkdownText, Modal, IconCloseOutline16, IconChevronLeftOutline14, IconChevronRightOutline14 } from '@aeven/client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import css from './IntegrationsSection.module.css'
import { connectorIcons } from './connector-icons.ts'

/** Browser callbacks bound to the authenticated account Remote. */
export interface IntegrationsSectionInjected {
  hooks: { changes: HostObservable<number>; selectedConnector: HostObservable<ConnectorProvider | undefined> }
  selectConnector: (provider: ConnectorProvider | undefined) => void
  page: 'skills' | 'connectors'
  list: () => Promise<AccountIntegrationsView>
  importSkill: (files: SkillUploadFile[]) => Promise<void>
  setSkillEnabled: (name: string, enabled: boolean) => Promise<void>
  removeSkill: (name: string) => Promise<void>
  connect: (request: ConnectorCreateRequest) => Promise<ConnectorId>
  authorize: (provider: ConnectorProvider) => Promise<ConnectorAuthorization>
  setConnectorEnabled: (id: ConnectorId, enabled: boolean) => Promise<void>
  disconnect: (id: ConnectorId) => Promise<void>
}

/** Settings slot props with locale and account operations. */
export type IntegrationsSectionProps = PropsRuntime<'settings.section'> & PropsLocale<'settings.integrations'> & InjectFace<IntegrationsSectionInjected>

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
 * Render the caller's skills or connectors and their management actions.
 * @param props - localized account operations and selected page.
 * @returns the Settings page.
 */
export function IntegrationsSection(props: IntegrationsSectionProps) {
  const { page, t, list } = props
  const changes = props.useChanges(value => value)
  const requestVersion = useRef(0)
  const [snapshot, setSnapshot] = useState<AccountIntegrationsView>()
  const [selectedSkill, setSelectedSkill] = useState<string>()
  const selectedConnector = props.useSelectedConnector(value => value)
  const setSelectedConnector = props.selectConnector
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
  const fileInput = useRef<HTMLInputElement>(null)
  const sectionTop = useRef<HTMLDivElement>(null)
  const consentCard = useRef<HTMLDivElement>(null)
  useEffect(() => () => { setSelectedConnector(undefined) }, [setSelectedConnector])
  useEffect(() => { if (selectedConnector === undefined) { setSelectedSkill(undefined); setForm(undefined); setToken('') } }, [selectedConnector])
  useEffect(() => { if (page === 'skills') sectionTop.current?.scrollIntoView({ block: 'start' }) }, [page, selectedSkill])
  useEffect(() => { sectionTop.current?.scrollIntoView({ block: 'start' }) }, [selectedConnector])
  // A blocked popup falls back to the in-page consent link, which sits below the provider grid.
  useEffect(() => { if (consent !== undefined) consentCard.current?.scrollIntoView({ block: 'nearest' }) }, [consent])
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
  }, [list, changes])
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
  const selected = (page === 'connectors' ? providerDetail?.skills : snapshot?.skills)?.find(skill => skill.id === selectedSkill)
  const connectorIcon = (provider: ConnectorProvider) => connectorIcons[provider] === undefined
    ? <span className={css.connectorMonogram} aria-hidden="true">MCP</span>
    : <img className={css.connectorIcon} src={connectorIcons[provider]} alt="" />
  const connectorSwitch = (connection: AccountIntegrationsView['connectors'][number]) => <button type="button" role="switch" aria-label={`${t('enabled')}: ${connection.name}`} aria-checked={connection.enabled} title={t(connection.enabled ? 'enabled' : 'disabled')} className={`${css.switch} ${connection.enabled ? css.switchOn : ''}`} disabled={busy || !connection.connected} onClick={() => { void run(() => props.setConnectorEnabled(connection.id, !connection.enabled)) }}><span className={css.thumb} /></button>
  const skillSwitch = (skill: AccountIntegrationsView['skills'][number]) => <button type="button" role="switch" aria-label={skill.name} aria-checked={skill.enabled} title={t(skill.enabled ? 'enabled' : 'disabled')} className={`${css.switch} ${skill.enabled ? css.switchOn : ''}`} disabled={busy} onClick={() => { void run(() => props.setSkillEnabled(skill.name, !skill.enabled)) }}><span className={css.thumb} /></button>
  const catalogVisible = page !== 'connectors' || selectedConnector === undefined
  const catalogActions = catalogVisible && ((page === 'skills' && selected === undefined) || busy)
  return <div ref={sectionTop} className={`${css.section} ${page === 'connectors' ? css.connectors : ''}`}>
    {catalogVisible && <SectionHeader title={t(page)} description={t(page === 'skills' ? 'skillsIntro' : 'connectorsIntro')} />}
    {catalogActions && <div className={css.actions}>
      {page === 'skills' && selected === undefined && <button type="button" disabled={busy} onClick={() => { fileInput.current?.click() }}>{t('import')}</button>}
      {busy && <span role="status">{t(signingIn ? 'openingSignIn' : 'working')}</span>}
    </div>}
    {failed && <p role="alert">{t('failed')}</p>}
    {snapshot === undefined && !failed && <p role="status">{t('loading')}</p>}
    {page === 'skills' ? <>
      {selected === undefined && <p className={css.hint}>{t('importHint')}</p>}
      <input ref={fileInput} type="file" accept=".md,.zip,.skill" className={css.upload} aria-label={t('import')} onChange={(event) => {
        const file = event.currentTarget.files?.[0]
        if (file !== undefined) void run(async () => { await props.importSkill([await upload(file)]) })
        event.currentTarget.value = ''
      }} />
      {snapshot?.skills.length === 0 && <p className={css.hint}>{t('skillsEmpty')}</p>}
      {selected === undefined ? <>
        <input className={css.search} type="search" aria-label={t('searchSkills')} placeholder={t('searchSkills')} value={query} onChange={(event) => { setQuery(event.currentTarget.value) }} />
        <div className={css.skillList}>{snapshot?.skills.filter(skill => `${skill.name} ${skill.description}`.toLowerCase().includes(query.toLowerCase())).map(skill => <article key={skill.id} className={css.skillRow}>
          <button type="button" className={css.skillOpen} onClick={() => { setSelectedSkill(skill.id) }} aria-label={`${t('inspect')}: ${skill.name}`}>
            <span className={css.skillGlyph} aria-hidden="true">≡</span>
            <span className={css.skillSummary}><strong>{skill.name}</strong><span className={css.skillDescription}>{skill.description}</span><span className={css.hint}>{skill.workspace ?? skill.source}{skill.available === false ? ` · ${t('disabled')}` : ''}</span></span>
            <IconChevronRightOutline14 />
          </button>
          {skillSwitch(skill)}
        </article>)}</div>
      </> : <article className={css.skillDetail}>
        <button type="button" className={css.back} onClick={() => { setSelectedSkill(undefined) }}><IconChevronLeftOutline14 />{t('backToSkills')}</button>
        <div className={css.row}><h2>{selected.name}</h2>{skillSwitch(selected)}</div>
        <p className={css.detailDescription}>{selected.description}</p>
        <div className={css.detailMeta}><span>{t(selected.available === false ? 'disabled' : selected.enabled ? 'enabled' : 'disabled')}</span><span>{t('source')}: {selected.workspace ?? selected.source}</span><span>{t(selected.managed ? 'personalSkill' : 'readOnlySkill')}</span></div>
        <div className={css.instructions}><MarkdownText key={selected.id} text={selected.content} animation={false} labels={{ code: { copyLabel: t('copy'), copiedLabel: t('copied') }, footnotes: t('footnotes') }} /></div>
        {selected.files.length > 0 && <div><h3>{t('files')}</h3><ul>{selected.files.map(path => <li key={path}>{path}</li>)}</ul></div>}
        {selected.managed && <button type="button" disabled={busy} onClick={() => { void run(() => props.removeSkill(selected.name)) }}>{t('remove')}</button>}
      </article>}

    </> : <>
      {providerDetail === undefined ? <div className={css.connectorList}>{snapshot?.providers.map((provider) => {
        const connections = snapshot.connectors.filter(connection => connection.provider === provider.provider)
        const connected = connections.some(connection => connection.connected)
        const enabled = connections.some(connection => connection.connected && connection.enabled)
        return <article key={provider.provider} className={css.connectorRow}>
          <button type="button" className={css.connectorOpen} onClick={() => { setSelectedConnector(provider.provider); setSelectedSkill(undefined); setForm(undefined); setToken('') }}>
            {connectorIcon(provider.provider)}
            <span className={css.skillSummary}><strong>{t(provider.provider)}</strong><span className={css.connectorDescription}>{t(`${provider.provider}Description`)}</span></span>
            <span className={css.connectionState}>{connected ? `${t('connected')} · ${t(enabled ? 'enabled' : 'disabled')}` : t(connections.length > 0 ? 'unavailable' : 'notConnected')}</span>
            <IconChevronRightOutline14 />
          </button>
        </article>
      })}</div> : <article className={css.connectorDetail}>
        <div className={css.connectorHeading}>{connectorIcon(providerDetail.provider)}<h2>{t(providerDetail.provider)}</h2></div>
        <p className={css.detailDescription}>{t(`${providerDetail.provider}Description`)}</p>
        <div className={css.connectionList}>
          {snapshot?.connectors.filter(connection => connection.provider === providerDetail.provider).map(connection => <div key={connection.id} className={css.card}>
            <div className={css.row}><div><strong>{connection.name === connection.provider ? t(connection.provider) : connection.name}</strong><p className={css.hint}>{t(connection.connected ? 'connected' : 'unavailable')}</p></div>{connectorSwitch(connection)}</div>
            {connection.connected && <p className={css.hint}>{t(connection.enabled ? 'enabled' : 'disabled')}</p>}
            {connection.provider === 'mcp' && <p className={css.address}>{connection.endpoint}</p>}
            <div className={css.actions}>
              {!connection.connected && providerDetail.configured && connection.provider !== 'mcp' && <button type="button" disabled={busy} onClick={() => { startSignIn(connection.provider) }}>{t('signIn')}</button>}
              {!connection.connected && (connection.provider === 'github' || connection.provider === 'mcp') && <button type="button" disabled={busy} onClick={() => { openForm(connection.provider as 'mcp' | 'github') }}>{t('tokenConnect')}</button>}
              <button type="button" disabled={busy} onClick={() => { void run(async () => { await props.disconnect(connection.id); if (pendingProvider === connection.provider) { setConsent(undefined); setPendingProvider(undefined) } }) }}>{t('disconnect')}</button>
            </div>
          </div>)}
          {!snapshot?.connectors.some(connection => connection.provider === providerDetail.provider) && <>
            <p className={css.hint}>{t('notConnected')}</p>
            <div className={css.actions}>
              {providerDetail.provider !== 'mcp' && <button type="button" className={css.primaryAction} disabled={busy || !providerDetail.configured} onClick={() => { startSignIn(providerDetail.provider) }}>{t('connect')}</button>}
              {(providerDetail.provider === 'mcp' || providerDetail.provider === 'github') && <button type="button" disabled={busy} onClick={() => { openForm(providerDetail.provider as 'mcp' | 'github') }}>{t(providerDetail.provider === 'github' ? 'tokenConnect' : 'connect')}</button>}
            </div>
            {!providerDetail.configured && <p className={css.hint}>{t(['gmail', 'google-drive', 'google-calendar'].includes(providerDetail.provider) ? 'googleSetupRequired' : 'setupRequired')}</p>}
          </>}
          {providerDetail.provider === 'mcp' && snapshot?.connectors.some(connection => connection.provider === 'mcp') && <button type="button" disabled={busy} onClick={() => { openForm('mcp') }}>{t('addConnection')}</button>}
        </div>
        <h3>{t('skills')}</h3>
        <p className={css.hint}>{t('connectorSkillsHint')}</p>
        {providerDetail.skills.length === 0 && <p className={css.hint}>{t('noConnectorSkills')}</p>}
        <div className={css.skillList}>{providerDetail.skills.map(skill => <article key={skill.id} className={css.skillRow}>
          <button type="button" className={css.skillOpen} onClick={() => { setSelectedSkill(skill.id) }} aria-haspopup="dialog">
            <span className={css.skillSummary}><strong>{skill.name}</strong><span className={css.connectorDescription}>{skill.description}</span><span className={css.hint}>{t(skill.available ? 'enabled' : 'disabled')}</span></span><IconChevronRightOutline14 />
          </button>
        </article>)}</div>
        {selected !== undefined && <Modal open headless onClose={() => { setSelectedSkill(undefined) }} title={selected.name} className={`${css.section} ${css.connectors} ${css.skillModal}`}>
          <header className={css.skillModalHeader}><h2>{selected.name}</h2><button type="button" className={css.skillModalClose} aria-label={t('close')} onClick={() => { setSelectedSkill(undefined) }}><IconCloseOutline16 size={14} /></button></header>
          <div className={`${css.skillModalContent} no-scrollbar`}><p className={css.detailDescription}>{selected.description}</p><MarkdownText key={selected.id} text={selected.content} animation={false} controls={{ table: false }} labels={{ code: { copyLabel: t('copy'), copiedLabel: t('copied') }, footnotes: t('footnotes') }} /></div>
        </Modal>}
      </article>}
      {consent !== undefined && <div ref={consentCard} className={css.card}><a href={consent} target="_blank" rel="noreferrer" onClick={(event) => {
        const desktop = (window as Window & { avnDesktop?: { browser?: { openExternal: (url: string) => Promise<void> } } }).avnDesktop?.browser
        if (desktop !== undefined) { event.preventDefault(); void run(() => desktop.openExternal(consent)) }
      }}>{t('consent')}</a><p className={css.hint}>{t('consentHint')}</p></div>}
      {form !== undefined && <form className={css.card} onSubmit={(event) => {
        event.preventDefault()
        void run(async () => {
          await props.connect({ provider: form, name, endpoint: url, ...token === '' ? {} : { token } })
          setToken(''); setForm(undefined)
        })
      }}>
        <label className={css.field}>{t('name')}<input autoFocus required value={name} disabled={busy} onChange={(event) => { setName(event.currentTarget.value) }} /></label>
        <label className={css.field}>{t('endpoint')}<input required type="url" value={url} disabled={busy} onChange={(event) => { setUrl(event.currentTarget.value) }} /></label>
        <label className={css.field}>{t('token')}<input type="password" autoComplete="off" value={token} disabled={busy} onChange={(event) => { setToken(event.currentTarget.value) }} /></label>
        <p className={css.hint}>{t('tokenHint')}</p>
        <div className={css.actions}><button type="submit" disabled={busy}>{t('connect')}</button><button type="button" disabled={busy} onClick={() => { setToken(''); setForm(undefined) }}>{t('cancel')}</button></div>
      </form>}
    </>}
  </div>
}

/** Settings header action for returning from a connector detail view. */
export type ConnectorBackProps = PropsRuntime<'settings.action'> & PropsLocale<'settings.integrations'> & InjectFace<Pick<IntegrationsSectionInjected, 'hooks' | 'selectConnector'>>

/**
 * Render the connector detail's header navigation.
 * @param props - connector selection and localized button label.
 * @returns a back button while a connector is selected.
 */
export function ConnectorBack(props: ConnectorBackProps) {
  const selected = props.useSelectedConnector(value => value)
  return selected === undefined ? null : <button type="button" data-settings-back className={css.connectorBack} aria-label={props.t('backToConnectors')} title={props.t('backToConnectors')} onClick={() => { props.selectConnector(undefined) }}><IconChevronLeftOutline14 /></button>
}
