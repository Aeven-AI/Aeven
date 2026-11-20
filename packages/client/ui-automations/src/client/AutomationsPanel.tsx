/** The bot pages: overview at /bots, one bot at /bots/<id>, and runs at /bots/runs. */
import { useEffect, useRef } from 'react'
import { Button, IconTrashOutline16, Modal } from '@aeven/client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import type {} from '@aeven/client-ui-conversation/client'
import { formatters } from './format.ts'
import type { AutomationPanelInjected } from './model.ts'
import { Overview } from './Overview.tsx'
import { BotDetail } from './BotDetail.tsx'
import { IdeaGallery, RunRows, ViewBar } from './shared.tsx'
import { confirmationOf, useAutomations } from './useAutomations.ts'
import css from './AutomationsPanel.module.css'

/** Whether a bot page's composer takes the caret when that page next shows, after Edit on another page. */
let focusOnArrival = false

/**
 * The bot id a bot page's address names.
 * @param address - the open start address, such as `/bots/<uuid>`.
 * @returns the last segment, or undefined on another address.
 */
function botIdOf(address: string | undefined): string | undefined {
  if (address === undefined) return undefined
  const id = address.slice(address.lastIndexOf('/') + 1)
  return id === '' ? undefined : id
}

/**
 * Render the bot page this registration's address shows. Every creation and change still goes through the
 * conversation's own approval; a page only sends the reader's request there.
 * @param props - session input actions, locale, and authenticated management operations.
 * @returns the page for the open address.
 */
export function AutomationsPanel(props: PropsRuntime<'conversation.start'> & PropsLocale<'automations'> & InjectFace<AutomationPanelInjected>) {
  const { t, inputActions, call, openRun, view, showView, showBot, openConnector, useAddress } = props
  const state = useAutomations(props)
  const address = useAddress(value => value)
  const { data, connected, unavailable, pending } = state
  const fmt = formatters(t, data)
  const showOverview = (): void => { showView('overview') }
  const root = useRef<HTMLElement>(null)
  // The seat is ui-conversation's, reached through its data attribute because the input actions carry no focus.
  const focusComposer = (): void => {
    const column = root.current?.closest('[data-conversation-root]')
    column?.querySelector<HTMLElement>('[data-composer-seat] [contenteditable="true"]')?.focus()
  }
  /** Edit a bot: its page's composer takes the caret, opening the page first when another one is shown. */
  const editBot = (id: string): void => {
    if (view === 'bot' && botIdOf(address) === id) { focusComposer(); return }
    focusOnArrival = true
    showBot(id)
  }
  useEffect(() => {
    if (view !== 'bot' || !focusOnArrival) return
    focusOnArrival = false
    focusComposer()
  }, [view])
  /** Put one starter in the overview's composer without sending it, so the reader can read and change it first. */
  const start = (text: string): void => {
    inputActions.setDraft(text)
    focusComposer()
  }
  const ideas = data === null ? null : (
    <IdeaGallery
      t={t} data={data} serviceState={state.serviceState} missing={state.missing} anyMissing={state.anyMissing}
      unavailable={unavailable} start={start} openConnector={openConnector}
    />
  )
  const body = () => {
    if (data === null) return <div className={css.empty}><p className={css.state}>{t(connected ? 'loading' : 'offlineDetail')}</p></div>
    switch (view) {
      case 'overview':
        return <Overview t={t} fmt={fmt} data={data} state={state} showBot={showBot} editBot={editBot} startBoard={() => { start(t('boardDraft')) }} ideas={ideas} />
      case 'bot': {
        const id = botIdOf(address)
        return id === undefined
          ? null
          : <BotDetail
            t={t} fmt={fmt} id={id} data={data} state={state} call={call} openRun={openRun}
            showOverview={showOverview} editBot={editBot}
          />
      }
      case 'runs':
        return data.runs.length === 0 ? <div className={css.empty}><p className={css.emptyText}>{t('noRuns')}</p></div> : (
          <>
            <RunRows
              t={t} fmt={fmt} runs={data.runs} named removable unavailable={unavailable}
              openRun={openRun} setPending={state.setPending}
            />
            <div className={css.clearRow}>
              <Button variant="primary" size="sm" icon={<IconTrashOutline16 />} disabled={unavailable} onClick={() => { state.setPending({ kind: 'clear' }) }}>
                {t('clearRuns')}
              </Button>
            </div>
          </>
        )
    }
  }
  const copy = pending === null ? null : confirmationOf(pending, t)
  return (
    <section ref={root} className={css.root} aria-label={t('title')}>
      <div className={css.content}>
        <ViewBar t={t} view={view} showView={showView} />
        {state.error && <p role="alert" className={css.alert}>{state.error}</p>}
        {body()}
      </div>
      {pending !== null && copy !== null && (
        <Modal
          open onClose={() => { state.setPending(null) }} closeLabel={t('close')}
          title={copy.title} description={copy.description}
          footer={(
            <>
              <Button variant="ghost" onClick={() => { state.setPending(null) }}>{t('cancel')}</Button>
              <Button variant="primary" disabled={unavailable} onClick={() => { state.confirm(pending) }}>{copy.confirm}</Button>
            </>
          )}
        />
      )}
    </section>
  )
}
