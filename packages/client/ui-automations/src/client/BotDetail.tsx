/** One bot's page at /bots/<id>, in the bot card's layout: a pinned card with its actions, its details, and its advanced settings. */
import { useEffect, useState } from 'react'
import {
  Button, IconCopyOutline16, Modal, PlaceList, Tooltip, writeClipboard,
} from '@aeven/client-ui-primitives'
import { CLOUD_PLACE, OVERLAP_TEXT, type Formatters, type Translate } from './format.ts'
import type { AutomationList, WebhookCredential } from './model.ts'
import { BotMenu, Facts, PauseControl, RunControl, RunRows, StatusPill, useNarrowCards } from './shared.tsx'
import type { Automations } from './useAutomations.ts'
import css from './AutomationsPanel.module.css'

/**
 * Render one bot's page, or a not-found state when the list no longer carries it.
 * @param props - the bot id, the list, the shared state, and navigation.
 * @returns the bot page.
 */
export function BotDetail({ t, fmt, id, data, state, call, openRun, showOverview, editBot }: {
  t: Translate
  fmt: Formatters
  id: string
  data: AutomationList
  state: Automations
  call: (operation: string, payload: unknown) => Promise<unknown>
  openRun: (sessionId: string) => void
  showOverview: () => void
  /** Put the caret in this page's composer. */
  editBot: (id: string) => void
}) {
  const task = data.definitions.find(candidate => candidate.id === id)
  const [placing, setPlacing] = useState(false)
  const [copied, setCopied] = useState(false)
  /** The bot's inbound credential, read while its page is open and dropped when the key changes. */
  const [credential, setCredential] = useState<WebhookCredential | null>(null)
  const { connected, unavailable } = state
  const cards = useNarrowCards(data)
  useEffect(() => {
    if (!connected || credential !== null || task?.webhook !== true) return
    let alive = true
    void call('webhook-secret', { id })
      .then((value) => { if (alive) setCredential(value as WebhookCredential) })
      // A refused read leaves the section offering its own actions; the next visit reads again.
      .catch((): void => undefined)
    return () => { alive = false }
  }, [connected, credential, task?.webhook, call, id])
  // A different bot's page starts without the previous bot's key.
  useEffect(() => { setCredential(null) }, [id])
  if (task === undefined) {
    return (
      <div className={css.empty}>
        <h3 className={css.emptyTitle}>{t('notFound')}</h3>
        <p className={css.emptyText}>{t('notFoundDetail')}</p>
        <Button variant="primary" size="sm" onClick={showOverview}>{t('backToBots')}</Button>
      </div>
    )
  }
  const current = data.runs.find(run => run.definition.id === task.id && (run.status === 'queued' || run.status === 'running'))
  const runs = data.runs.filter(run => run.definition.id === task.id)
  const hasWebhook = task.triggers.some(trigger => trigger.kind === 'webhook')
  const hasGithub = task.triggers.some(trigger => trigger.kind === 'event' && trigger.source === 'github')
  /** Absolute address an outside service posts to; a non-HTTP shell shows the path it can reach. */
  const address = (path: string): string => window.location.protocol.startsWith('http') ? `${window.location.origin}${path}` : path
  /** Copy one trigger value and confirm it in place for a moment. */
  const copy = (text: string): void => {
    void writeClipboard(text).then(() => {
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 2000)
    })
  }
  const copyRow = (label: string, value: string | null, copyText: string | null, tip: string) => (
    <div className={css.triggerRow}>
      <span className={css.triggerLabel}>{label}</span>
      <span className={css.triggerValue}>{value ?? '…'}</span>
      <Tooltip label={tip} side="top" anchor="icon">
        <span className={css.tip}>
          <Button
            variant="ghost" size="sm" icon={<IconCopyOutline16 />} aria-label={tip}
            disabled={unavailable || copyText === null} onClick={() => { if (copyText !== null) copy(copyText) }}
          />
        </span>
      </Tooltip>
    </div>
  )
  const maskedKey = credential === null ? null : `${credential.keyId}${'•'.repeat(24)}`
  return (
    <div className={css.list} ref={cards}>
      <article className={`${css.card} ${css.pinned}`}>
        <span className={css.heading}>
          <span className={css.title}>{task.name}</span>
          {task.triggers.map((trigger, index) => <span className={css.schedule} key={index}>{fmt.describeTrigger(trigger)}</span>)}
        </span>
        <div className={css.cardActions}>
          <RunControl t={t} task={task} current={current} state={state} />
          <PauseControl t={t} task={task} state={state} />
          <BotMenu t={t} task={task} state={state} edit={editBot} deleted={showOverview} />
          <StatusPill t={t} task={task} current={current} state={state} />
        </div>
      </article>
      <article className={css.card}>
        <Facts t={t} fmt={fmt} task={task} />
        <div className={css.details}>
          <p className={css.prompt}>{task.prompt}</p>
        </div>
        {runs.length > 0 && (
          <>
            <h3 className={css.detailTitle}>{t('recentRuns')}</h3>
            <RunRows
              t={t} fmt={fmt} runs={runs} named={false} removable={false} unavailable={unavailable}
              openRun={openRun} setPending={state.setPending}
            />
          </>
        )}
      </article>
      <article className={css.card}>
        <span className={css.title}>{t('advanced')}</span>
        <h3 className={css.detailTitle}>{t('overlapTitle')}</h3>
        <p className={css.triggerText}>{t(OVERLAP_TEXT[task.overlap])}</p>
        {task.grants.length > 0 && (
          <>
            <h3 className={css.detailTitle}>{t('grantsTitle')}</h3>
            {task.grants.map(grant => (
              <div className={css.triggerRow} key={`${grant.toolName}\n${grant.scope}`}>
                <span className={css.triggerLabel}>{grant.toolName}</span>
                <span className={css.triggerValue}>
                  {grant.expiresAt === undefined ? t('grantNoEnd') : Date.parse(grant.expiresAt) <= Date.now() ? t('grantExpired') : t('grantExpires', { date: fmt.date(grant.expiresAt) })}
                </span>
                <Button variant="ghost" size="sm" disabled={unavailable} onClick={() => { state.send('grant-revoke', { id: task.id, toolName: grant.toolName, scope: grant.scope }) }}>
                  {t('grantRevoke')}
                </Button>
              </div>
            ))}
          </>
        )}
        {hasGithub && (
          <>
            <h3 className={css.detailTitle}>{t('githubTriggerTitle')}</h3>
            <p className={css.triggerText}>{t('githubDetail')}</p>
            {copyRow(t('githubAddress'), credential === null ? null : address(`${credential.path}/github`), credential === null ? null : address(`${credential.path}/github`), t('webhookCopyAddress'))}
            {copyRow(t('githubSecret'), maskedKey, credential?.secret ?? null, t('webhookCopyKey'))}
          </>
        )}
        {data.capabilities.webhook && (
          <>
            <h3 className={css.detailTitle}>{t('webhookTitle')}</h3>
            <p className={css.triggerText}>{hasWebhook ? t('webhookActive') : t('webhookIdle')}</p>
            {hasWebhook ? (
              <>
                {copyRow(t('webhookAddress'), credential === null ? null : address(credential.path), credential === null ? null : address(credential.path), t('webhookCopyAddress'))}
                {copyRow(t('webhookKey'), maskedKey, credential?.secret ?? null, t('webhookCopyKey'))}
                <div className={css.triggerActions}>
                  <Button variant="ghost" size="sm" disabled={unavailable} onClick={() => { state.setPending({ kind: 'webhook-rotate', id: task.id, done: () => { setCredential(null) } }) }}>
                    {t('webhookRotate')}
                  </Button>
                  <Button variant="ghost" size="sm" disabled={unavailable} onClick={() => { state.setPending({ kind: 'webhook-remove', id: task.id, done: () => { setCredential(null) } }) }}>
                    {t('webhookRemove')}
                  </Button>
                  {copied && <span className={css.copied} role="status">{t('webhookCopied')}</span>}
                </div>
              </>
            ) : (
              <Button variant="primary" size="sm" disabled={unavailable} onClick={() => { state.send('webhook-enable', { id: task.id }, () => { setCredential(null) }) }}>
                {t('webhookCreate')}
              </Button>
            )}
          </>
        )}
        {task.placement.runsOn !== 'any' && (
          <>
            <h3 className={css.detailTitle}>{t('runsOn')}</h3>
            <p className={css.triggerText}>{fmt.placementDetail(task)}</p>
            {data.hosts !== undefined && (data.hosts.cloud || data.hosts.desktops.length > 0) && (
              <div className={css.triggerActions}>
                <Button variant="primary" size="sm" disabled={unavailable} onClick={() => { setPlacing(true) }}>{t('placeChoose')}</Button>
              </div>
            )}
          </>
        )}
      </article>
      {placing && data.hosts !== undefined && (
        <Modal open onClose={() => { setPlacing(false) }} closeLabel={t('placeClose')} title={t('placeTitle')} description={t('placeDescription')}>
          <PlaceList
            currentLabel={t('placeCurrent')}
            items={fmt.placeItems(task, data.hosts)}
            onChoose={(item) => {
              setPlacing(false)
              if (item.current === true) return
              state.send('update', { id: task.id, patch: item.id === CLOUD_PLACE ? { runOn: 'cloud' } : { runOn: 'device', desktop: item.id } })
            }}
          />
        </Modal>
      )}
    </div>
  )
}
