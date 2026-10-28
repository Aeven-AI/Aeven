/** Personal skill import and connector account management. */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AccountIntegrationsView, ConnectorAuthorization, ConnectorCreateRequest, ConnectorId, ConnectorProvider, EmailConnectionRequest, EmailConnectionResult, EmailConnectionUpdate, SkillCatalogView, SkillUploadFile, WhatsAppPairingView } from '@aeven/api-remotes/client'
import { Button, LoadingBlock, SectionHeader, MarkdownText, Menu, Modal, Spinner, Switch, Tabs, IconWarningOutline16, IconChevronLeftOutline14, IconLucideSettings2 } from '@aeven/client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import css from './IntegrationsSection.module.css'
import { connectorIcons } from './connector-icons.ts'
import type { TelegramPairingOperations } from './connector-page.ts'
import { DiscordAccounts } from './DiscordAccounts.tsx'
import { EmailAccounts } from './EmailAccounts.tsx'
import { TelegramAccounts } from './TelegramAccounts.tsx'
import { WhatsAppAccounts } from './WhatsAppAccounts.tsx'

/**
 * Title order for a skills list, by the name the row shows: the upstream title when a
 * catalog entry carries one, the install name otherwise. Case and accents do not
 * reorder a list a reader scans alphabetically.
 */
function byTitle(left: { name: string; displayName?: string }, right: { name: string; displayName?: string }): number {
  return (left.displayName ?? left.name).localeCompare(right.displayName ?? right.name, undefined, { sensitivity: 'base' })
}

/** Address prefix that marks a catalog category page, so Back returns to the index. */
const CATEGORY_DETAIL_PREFIX = 'category:'

/**
 * Display name for a catalog category: every hyphen-separated word capitalized.
 * @param name - catalog category directory name, such as `reverse-engineering`.
 * @returns the label a reader sees, such as `Reverse Engineering`.
 */
function categoryLabel(name: string): string {
  return name.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

/** Browser callbacks bound to the authenticated account Remote. */
export interface IntegrationsSectionInjected extends TelegramPairingOperations {
  hooks: { changes: HostObservable<number> }
  page: 'skills' | 'connectors'
  list: () => Promise<AccountIntegrationsView>
  /**
   * The list this page read the last time it was mounted, so a revisit paints
   * it before the re-read lands.
   * @returns that list, or undefined when the page has not settled one yet.
   */
  cachedList: () => AccountIntegrationsView | undefined
  /**
   * The skill catalog this release ships, read from disk on the Host.
   * @returns the catalogued skills and their categories, or undefined when the deployment ships none.
   */
  catalog: () => Promise<SkillCatalogView | undefined>
  /**
   * Read one catalogued skill's instructions, for its page before install.
   * @param name - catalogued skill name.
   * @returns the instruction body, or undefined when the catalog does not carry that skill.
   */
  catalogSkillContent: (name: string) => Promise<string | undefined>
  /**
   * Install one catalogued skill into the account's library.
   * @param name - catalogued skill name.
   */
  installCatalogSkill: (name: string) => Promise<void>
  importSkill: (files: SkillUploadFile[]) => Promise<void>
  setSkillEnabled: (name: string, enabled: boolean) => Promise<void>
  /** Retry the tool install a skill's engine needs, after that install failed. */
  retryReverseEngineering: () => Promise<void>
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
      const result = reader.result
      if (typeof result !== 'string') { reject(new Error('skill file could not be read')); return }
      resolve({ path: file.name, base64: result.slice(result.indexOf(',') + 1) })
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
/** A skill's name as a person reads it: `reverse-engineering` shows as "Reverse engineering". */
function humanSkillName(name: string): string {
  const spaced = name.replace(/[-_]+/g, ' ').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export function IntegrationsSection(props: IntegrationsSectionProps) {
  const { page, t, list } = props
  const changes = props.useChanges(value => value)
  const requestVersion = useRef(0)
  const [snapshot, setSnapshot] = useState<AccountIntegrationsView | undefined>(() => props.cachedList())
  // The address owns which skill or connector page is open, so a page can be linked and Back returns to the list.
  const selectedSkillId = page === 'skills' ? props.detail : undefined
  const selectedConnector = page === 'connectors' ? props.detail : undefined
  /** Connector skill whose instructions are open in a popup on the connector page. */
  const [connectorSkillId, setConnectorSkillId] = useState<string>()
  const [query, setQuery] = useState('')
  /** Which half of the Skills page is showing; nothing installed yet means the catalog. */
  const [mode, setMode] = useState<'library' | 'catalog'>('library')
  const [chosenMode, setChosenMode] = useState(false)
  /** The shipped catalog: undefined while unread, null when this deployment ships none. */
  const [catalog, setCatalog] = useState<SkillCatalogView | null>()
  const [catalogQuery, setCatalogQuery] = useState('')
  /** How the catalog is laid out: the category index, or one list of every skill. Both read in title order. */
  const [view, setView] = useState<'all' | 'category'>('category')
  /** Category carried by the page address, or undefined while the index itself shows. */
  const selectedCategory = selectedSkillId?.startsWith(CATEGORY_DETAIL_PREFIX)
    ? selectedSkillId.slice(CATEGORY_DETAIL_PREFIX.length)
    : undefined
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [failed, setFailed] = useState(false)
  const [form, setForm] = useState<'mcp' | 'github'>()
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [consent, setConsent] = useState<string>()
  /** Reason the analysis runtime reported, shown once in a popup next to the switch that cannot move. */
  const [setupFailure, setSetupFailure] = useState<string>()
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
    if (pendingProvider === undefined) return
    const connectors = snapshot?.connectors ?? []
    const providers = snapshot?.providers ?? []
    const signedIn = connectors.some(connector => connector.provider === pendingProvider && connector.connected)
    const failed = providers.some(provider => provider.provider === pendingProvider && provider.authorizationFailure !== undefined)
    if (!signedIn && !failed) return
    setConsent(undefined)
    setPendingProvider(undefined)
  }, [snapshot, pendingProvider])
  // An account with nothing installed yet opens on the catalog, which is where a skill comes from.
  useEffect(() => {
    if (!chosenMode && snapshot !== undefined && snapshot.skills.length === 0) setMode('catalog')
  }, [chosenMode, snapshot])
  // The open skill page belongs to the library when it is installed, and otherwise to the catalog,
  // whose own list also loads here: an address can open a catalogued skill that the library does not hold.
  const selectedSkill = snapshot?.skills.find(skill => skill.id === selectedSkillId)
  const catalogSkill = selectedSkill !== undefined || selectedCategory !== undefined
    ? undefined
    : catalog?.skills.find(skill => skill.name === selectedSkillId)
  const readingCatalog = mode === 'catalog' || (selectedSkillId !== undefined && selectedSkill === undefined)
  const [preview, setPreview] = useState<{ name: string; text: string }>()
  useEffect(() => {
    if (page !== 'skills' || catalog !== undefined || !readingCatalog) return
    let active = true
    const read = props.catalog()
    void read.then((value) => { if (active) setCatalog(value ?? null) }, () => { if (active) setCatalog(null) })
    return () => { active = false }
  }, [page, readingCatalog, catalog, props])
  // A catalogued skill's page renders instructions the listing does not carry, so they are read on demand.
  useEffect(() => {
    if (catalogSkill === undefined || preview?.name === catalogSkill.name) return
    let active = true
    const name = catalogSkill.name
    void props.catalogSkillContent(name).then((text) => { if (active) setPreview({ name, text: text ?? '' }) }, () => { if (active) setPreview({ name, text: '' }) })
    return () => { active = false }
  }, [catalogSkill, preview, props])
  // A catalogued skill's page belongs to the catalog list, so Back returns there.
  useEffect(() => { if (catalogSkill !== undefined && mode !== 'catalog') setMode('catalog') }, [catalogSkill, mode])
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
  const connectorSkill = providerDetail?.skills.find(skill => skill.id === connectorSkillId)
  const matchingSkills = (snapshot?.skills ?? [])
    .filter(skill => `${skill.name} ${skill.description}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort(byTitle)
  /** Whether the catalog search field admits one skill. */
  const catalogMatches = (skill: SkillCatalogView['skills'][number]): boolean => {
    const needle = catalogQuery.trim().toLowerCase()
    return needle === '' || `${skill.name} ${skill.displayName} ${skill.description} ${skill.keywords.join(' ')}`.toLowerCase().includes(needle)
  }
  /** Catalog rows of one category, in title order and narrowed by the search field. */
  const catalogRows = (category: string): SkillCatalogView['skills'] =>
    (catalog?.skills ?? [])
      .filter(skill => skill.category === category && catalogMatches(skill))
      .sort(byTitle)
  const installedNames = new Set(snapshot?.skills.map(skill => skill.name) ?? [])
  /** Every catalogued skill the search field admits, in title order — the default display. */
  const allRows = (catalog?.skills ?? [])
    .filter(catalogMatches)
    .sort(byTitle)
  /** Every category the catalog ships, with how many skills it holds, in name order. */
  const catalogCategories = [...(catalog?.skills ?? [])
    .reduce((counts, skill) => counts.set(skill.category, (counts.get(skill.category) ?? 0) + 1), new Map<string, number>())]
    .map(([name, skills]) => ({ name, skills }))
    .sort((left, right) => left.name.localeCompare(right.name))
  const catalogRow = (skill: SkillCatalogView['skills'][number]) => <article key={skill.name} className={css.connectorRow}>
    <button type="button" className={css.connectorOpen} onClick={() => { openDetail(skill.name) }}>
      <span className={css.skillSummary}>
        <strong>{humanSkillName(skill.name)}</strong>
        <span className={css.connectorDescription}>{skill.description}</span>
        <span className={css.meta}>
          {skill.displayName === skill.name ? t('catalogDownloads') : `${skill.displayName} · ${t('catalogDownloads')}`} {skill.downloads.toLocaleString()}
        </span>
      </span>
    </button>
    <span className={css.switchCell}>{setupSpinner(skill.name)}{setupWarning(skill.name)}{catalogSwitch(skill)}</span>
  </article>
  /** Display menu anchored to the toolbar button, matching the composer's own option popups:
   * the list leaves this scrolling pane, and its right edge rests on the trigger's. */
  const displayMenu = <Menu
    open={optionsOpen}
    portal
    align="end"
    onClose={() => { setOptionsOpen(false) }}
    selectedId={view}
    onSelect={(id) => { setView(id === 'category' ? 'category' : 'all'); setOptionsOpen(false) }}
    items={[{ id: 'category', label: t('optionCategory') }, { id: 'all', label: t('optionAll') }]}
    anchor={<button
      type="button" className={css.iconAction} aria-label={t('displayOptions')} title={t('displayOptions')}
      aria-haspopup="menu" aria-expanded={optionsOpen} onClick={() => { setOptionsOpen(open => !open) }}
    ><IconLucideSettings2 className={css.optionIcon} /></button>}
  />

  const install = (name: string): void => { void run(async () => { await props.installCatalogSkill(name); refreshList() }) }
  const uninstall = (name: string): void => { void run(async () => { await props.removeSkill(name); refreshList() }) }
  /** One switch per catalogued skill: on installs it into the library, off removes it from it. */
  const catalogSwitch = (skill: SkillCatalogView['skills'][number]) => {
    const installed = installedNames.has(skill.name)
    return toggle(skill.name, installed, false, () => { (installed ? uninstall : install)(skill.name) })
  }
  const modeSwitch = <Tabs
    items={[{ id: 'library', label: t('modeLibrary') }, { id: 'catalog', label: t('modeCatalog') }]}
    activeId={mode}
    onSelect={(id) => { setChosenMode(true); setMode(id === 'catalog' ? 'catalog' : 'library') }}
  />
  const connectorIcon = (provider: ConnectorProvider, large = false) => <span className={`${css.connectorBadge} ${large ? css.connectorBadgeLarge : ''}`} aria-hidden="true">
    {connectorIcons[provider] === undefined
      ? <span className={css.connectorMonogram}>{t('mcpMonogram')}</span>
      : <img className={`${css.connectorIcon} ${MONOCHROME_ICONS.has(provider) ? css.connectorIconInverted : ''}`} src={connectorIcons[provider]} alt="" />}
  </span>
  const toggle = (label: string, on: boolean, disabled: boolean, onChange: () => void) => <Switch label={label} checked={on} title={t(on ? 'on' : 'off')} disabled={busy || disabled} onChange={onChange} />
  /** Install progress the Host reports for a skill whose engine is prepared after it is enabled. */
  const setupOf = (name: string) => snapshot?.skills.find(skill => skill.name === name)?.setup
  /** The shared spinner while a skill's engine installs, left of its switch and with no label of its own. */
  const setupSpinner = (name: string) => setupOf(name)?.state === 'installing' ? <Spinner /> : undefined
  /** A failed attempt keeps its reason behind one warning glyph, so the row stays quiet but never hides it. */
  const setupWarning = (name: string) => setupOf(name)?.state === 'failed'
    ? <button type="button" className={css.setupWarning} aria-label={t('setupFailedTitle')} title={t('setupFailedTitle')} onClick={() => { setSetupFailure(setupOf(name)?.detail ?? '') }}>
      <IconWarningOutline16 size={14} />
    </button>
    : undefined
  const skillSwitch = (skill: AccountIntegrationsView['skills'][number]) => toggle(skill.name, skill.enabled, false, () => {
    void run(() => props.setSkillEnabled(skill.name, !skill.enabled))
  })
  /** One switch per provider: on means a signed-in connection is available in conversations; off means disconnected. */
  const stateOf = (provider: Provider) => {
    const connections: readonly Connection[] = snapshot?.connectors.filter(connection => connection.provider === provider.provider) ?? []
    const live = connections.filter(connection => connection.connected)
    // A provider without sign-in configured can still connect through a token form.
    const connectable = live.length > 0 || provider.configured || provider.provider === 'mcp' || provider.provider === 'github'
    // Email is available exactly when the deployment mounts the mail capability; WhatsApp and Telegram when this host
    // has their daemon; Discord when this deployment registered an Aeven Discord application.
    if (provider.provider === 'email' || provider.provider === 'whatsapp' || provider.provider === 'telegram' || provider.provider === 'discord') {
      return {
        connections,
        live,
        on: live.some(connection => connection.enabled),
        expired: connections.length > 0 && live.length === 0,
        connectable: provider.configured,
      }
    }
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
    // Email accounts, WhatsApp numbers, Telegram accounts, and Discord servers each hold their own sign-in,
    // so the provider switch pauses them instead of removing them.
    if (provider.provider === 'email' || provider.provider === 'whatsapp' || provider.provider === 'telegram' || provider.provider === 'discord') {
      if (on) {
        void run(async () => {
          for (const connection of live) if (connection.enabled) await props.setConnectorEnabled(connection.id, false)
        })
        return
      }
      if (live.length > 0) {
        void run(async () => {
          for (const connection of live) await props.setConnectorEnabled(connection.id, true)
        })
        return
      }
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
    if (provider.authorizationFailure !== undefined) return t(provider.authorizationFailure === 'admin-consent-required' ? 'adminConsentRequired' : 'consentFailed')
    if (expired) return t(provider.provider === 'email' ? 'emailReconnect' : provider.provider === 'whatsapp' ? 'whatsappRelink'
      : provider.provider === 'telegram' ? 'telegramRelink' : provider.provider === 'discord' ? 'discordRelink'
        : provider.provider === 'slack' ? 'slackRelink' : 'reconnectHint')
    if (connectable) return undefined
    if (provider.provider === 'email') return t('emailSetupRequired')
    if (provider.provider === 'whatsapp') return t('whatsappUnavailable')
    if (provider.provider === 'telegram') return t('telegramUnavailable')
    if (provider.provider === 'discord') return t('discordUnavailable')
    if (provider.provider === 'slack') return t('slackUnavailable')
    return t(['gmail', 'google-drive', 'google-calendar'].includes(provider.provider) ? 'googleSetupRequired'
      : ['outlook', 'outlook-calendar', 'onedrive', 'sharepoint', 'teams'].includes(provider.provider) ? 'microsoftSetupRequired' : 'setupRequired')
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
  /** Search and its action, on the title row so the field's centre rides the heading's optical centre. */
  const searchBar = page === 'skills' && selectedSkillId === undefined ? <div className={css.toolbar}>
    <input
      className={css.search}
      type="search"
      aria-label={t(mode === 'catalog' ? 'searchCatalog' : 'searchSkills')}
      placeholder={t(mode === 'catalog' ? 'searchCatalog' : 'searchSkills')}
      value={mode === 'catalog' ? catalogQuery : query}
      onChange={(event) => { const next = event.currentTarget.value; if (mode === 'catalog') setCatalogQuery(next); else setQuery(next) }}
    />
    {mode === 'catalog'
      ? displayMenu
      : <button type="button" className={css.primaryAction} disabled={busy} title={t('importHint')} onClick={() => { fileInput.current?.click() }}>{t('import')}</button>}
  </div> : undefined
  const catalogVisible = (page === 'skills' ? selectedSkillId : selectedConnector) === undefined
  // Nothing the list owns is drawn while the first read is in flight, so the
  // page shows the header and the spinner alone.
  const loading = snapshot === undefined && !failed
  return <div ref={sectionTop} className={`${css.section} ${css.compact}`}>
    {catalogVisible && <SectionHeader title={t(page)} description={t(page === 'skills' ? (mode === 'catalog' ? 'skillCatalogIntro' : 'skillsIntro') : 'connectorsIntro')} />}
    {/* The only progress worth a line is a sign-in the reader is waiting to see open; every other
        operation answers in place, so the page shows no saving state. */}
    {signingIn && <p role="status" className={css.hint}>{t('openingSignIn')}</p>}
    {failed && <p role="alert">{t('failed')}</p>}
    {loading && <LoadingBlock label={t('loading')} />}
    {!loading && (page === 'skills' ? <>
      <input ref={fileInput} type="file" accept=".md,.zip,.skill" className={css.upload} aria-label={t('import')} onChange={(event) => {
        const file = event.currentTarget.files?.[0]
        if (file !== undefined) void run(async () => { await props.importSkill([await upload(file)]) })
        event.currentTarget.value = ''
      }} />
      {selectedSkillId === undefined ? <>
        {modeSwitch}
        {searchBar}
        {mode === 'catalog' ? <>
          {catalog === null && <p className={css.hint}>{t('catalogUnavailable')}</p>}
          {catalog !== undefined && catalog !== null && (view === 'category' && catalogQuery.trim() === ''
            ? <div className={css.connectorList}>{catalogCategories.map(category => <article
              key={category.name} className={css.connectorRow}
            >
              <button type="button" className={css.connectorOpen} onClick={() => { openDetail(`${CATEGORY_DETAIL_PREFIX}${category.name}`) }}>
                <span className={css.skillSummary}><strong>{categoryLabel(category.name)}</strong></span>
              </button>
              <span className={css.meta}>{category.skills}</span>
            </article>)}</div>
            : <div className={css.connectorList}>{allRows.map(catalogRow)}</div>)}
        </> : <>
          {snapshot !== undefined && snapshot.skills.length > 0 && matchingSkills.length === 0 && <p className={css.hint}>{t('noMatches')}</p>}
          <div className={css.connectorList}>{matchingSkills.map(skill => <article key={skill.id} className={css.connectorRow}>
            <button type="button" className={css.connectorOpen} onClick={() => { openDetail(skill.id) }}>
              <span className={css.skillSummary}>
                <strong>{humanSkillName(skill.name)}</strong>
                <span className={css.connectorDescription}>{skill.description}</span>
              </span>
            </button>
            <span className={css.switchCell}>{setupSpinner(skill.name)}{setupWarning(skill.name)}{skillSwitch(skill)}</span>
          </article>)}</div>
        </>}
      </> : selectedCategory !== undefined
        ? <article className={css.connectorDetail}>
          <div className={css.connectorHeading}><h2>{categoryLabel(selectedCategory)}</h2></div>
          <p className={css.meta}>{catalogRows(selectedCategory).length} {t('skillsWord')}</p>
          <div className={css.connectorList}>{catalogRows(selectedCategory).map(catalogRow)}</div>
        </article>
        : selectedSkill !== undefined
          ? <article className={`${css.connectorDetail} ${css.skillContent}`}>
            <div className={css.connectorHeading}><h2>{humanSkillName(selectedSkill.name)}</h2>{skillSwitch(selectedSkill)}</div>
            <p className={css.detailDescription}>{selectedSkill.description}</p>
            <p className={css.meta}>{t('personalSkill')}</p>
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
            <div className={css.detailActions}><button type="button" className={css.primaryAction} disabled={busy} onClick={() => {
              void run(async () => { await props.removeSkill(selectedSkill.name); props.showDetail(undefined) })
            }}>{t('removeSkill')}</button></div>
          </article>
          : catalogSkill !== undefined
            ? <article className={`${css.connectorDetail} ${css.skillContent}`}>
              <div className={css.connectorHeading}><h2>{catalogSkill.name}</h2>{catalogSwitch(catalogSkill)}</div>
              <p className={css.detailDescription}>{catalogSkill.description}</p>
              <p className={css.meta}>{categoryLabel(catalogSkill.category)} · {t('catalogDownloads')} {catalogSkill.downloads.toLocaleString()}</p>
              <p className={css.meta}>{t('source')} {catalogSkill.path}</p>
              <div className={css.instructions}>
                {preview?.name === catalogSkill.name
                  ? <MarkdownText
                    key={catalogSkill.name}
                    text={preview.text}
                    animation={false}
                    controls={{ table: false }}
                    labels={{ code: { copyLabel: t('copy'), copiedLabel: t('copied') }, footnotes: t('footnotes') }}
                  />
                  : <LoadingBlock label={t('loading')} />}
              </div>
            </article>
            : snapshot !== undefined && <p className={css.hint}>{t('skillMissing')}</p>}
    </> : <>
      {providerDetail === undefined ? <div className={css.connectorList}>{snapshot?.providers.map(provider => <article
        key={provider.provider}
        className={css.connectorRow}
      >
        <button type="button" className={css.connectorOpen} onClick={() => { openDetail(provider.provider) }}>
          {connectorIcon(provider.provider)}
          <span className={css.skillSummary}><strong>{t(provider.provider)}</strong><span className={css.connectorDescription}>{t(`${provider.provider}Description`)}</span>{(stateOf(provider).expired || provider.authorizationFailure !== undefined) && <span className={css.attention}>{providerHint(provider)}</span>}</span>
        </button>
        {providerSwitch(provider)}
      </article>)}</div> : <article className={css.connectorDetail}>
        <div className={css.connectorHeading}>
          {connectorIcon(providerDetail.provider, true)}
          <h2>{t(providerDetail.provider)}</h2>
          {providerDetail.provider !== 'mcp' && providerDetail.provider !== 'email' && providerDetail.provider !== 'whatsapp' && providerDetail.provider !== 'telegram' && providerDetail.provider !== 'discord' && providerSwitch(providerDetail, true)}
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
            : providerDetail.provider === 'telegram' ? providerDetail.configured
              ? <TelegramAccounts
                t={t}
                busy={busy}
                connections={stateOf(providerDetail).connections}
                run={run}
                toggle={toggle}
                startTelegramPairing={props.startTelegramPairing}
                startTelegramQrPairing={props.startTelegramQrPairing}
                telegramPairing={props.telegramPairing}
                submitTelegramCode={props.submitTelegramCode}
                submitTelegramPassword={props.submitTelegramPassword}
                cancelTelegramPairing={props.cancelTelegramPairing}
                setConnectorEnabled={props.setConnectorEnabled}
                disconnect={props.disconnect}
                refresh={refreshList}
                startWithPairing={addRequested}
              />
              : <p className={css.hint}>{t('telegramUnavailable')}</p>
              : providerDetail.provider === 'discord' ? providerDetail.configured
                ? <DiscordAccounts
                  t={t}
                  busy={busy}
                  connections={stateOf(providerDetail).connections}
                  run={run}
                  toggle={toggle}
                  setConnectorEnabled={props.setConnectorEnabled}
                  disconnect={props.disconnect}
                  refresh={refreshList}
                  startInstall={() => { startSignIn('discord') }}
                  startWithInstall={addRequested}
                />
                : <p className={css.hint}>{t('discordUnavailable')}</p>
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
                  {providerDetail.authorizationFailure === 'admin-consent-required' && providerDetail.adminConsentUrl !== undefined && <a
                    className={css.textAction} href={providerDetail.adminConsentUrl} target="_blank" rel="noopener noreferrer"
                  >{t('adminConsentLink')}</a>}
                  {stateOf(providerDetail).live.map(connection => (
                    <p key={connection.id} className={css.address}>{connection.microsoft?.username ?? connection.name}</p>
                  ))}
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
                <strong>{humanSkillName(skill.name)}</strong>
                <span className={css.connectorDescription}>{skill.description}</span>
              </span>
            </button>
          </article>)}</div>
        </>}
        <Modal
          open={setupFailure !== undefined}
          onClose={() => { setSetupFailure(undefined) }}
          title={t('setupFailedTitle')}
          closeLabel={t('close')}
          className={css.setupFailureDialog ?? ''}
          footer={(
            <>
              <Button variant="outline" onClick={() => { setSetupFailure(undefined) }}>{t('close')}</Button>
              <Button variant="primary" disabled={busy} onClick={() => {
                setSetupFailure(undefined)
                void run(() => props.retryReverseEngineering())
              }}>{t('retry')}</Button>
            </>
          )}
        >
          <p className={css.setupFailureText}>{setupFailure}</p>
        </Modal>
        {connectorSkill !== undefined && <Modal
          open
          onClose={() => { setConnectorSkillId(undefined) }}
          title={humanSkillName(connectorSkill.name)}
          closeLabel={t('close')}
          className={`${css.section} ${css.compact} ${css.skillModal ?? ''}`}
          contentClassName={`${css.skillModalContent ?? ''} ${css.skillContent ?? ''} no-scrollbar`}
        >
          <p className={css.detailDescription}>{connectorSkill.description}</p>
          <MarkdownText key={connectorSkill.id} text={connectorSkill.content} animation={false} controls={{ table: false }} labels={{ code: { copyLabel: t('copy'), copiedLabel: t('copied') }, footnotes: t('footnotes') }} />
        </Modal>}
      </article>}
      {consent !== undefined && <div ref={consentCard} className={css.card}><a href={consent} target="_blank" rel="noreferrer" onClick={(event) => {
        const shell = window as Window & { avnDesktop?: { browser?: { openExternal: (url: string) => Promise<void> } } }
        const desktop = shell.avnDesktop?.browser
        if (desktop !== undefined) { event.preventDefault(); void run(() => desktop.openExternal(consent)) }
      }}>{t('consent')}</a><p className={css.hint}>{t('consentHint')}</p></div>}
    </>)}
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
