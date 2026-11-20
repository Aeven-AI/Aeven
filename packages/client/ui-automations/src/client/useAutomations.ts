/** Data and actions every bot page shares: the refreshed list, connector state, operations, and confirmations. */
import { useEffect, useState } from 'react'
import type { InjectFace } from '@aeven/client-ui-slots'
import type { Translate } from './format.ts'
import { SERVICE_NEEDS, TEMPLATE_CATEGORIES, type ServiceNeed } from './templates.ts'
import type { AutomationList, AutomationPanelInjected, ServiceState } from './model.ts'

/** Last management projection, so moving between the bot pages shows it instead of a loading state. */
let lastList: AutomationList | null = null

/**
 * The page's own confirmation, in place of the browser's, for every action that removes records, invalidates a
 * credential, or repeats work that may already have changed something. `done` runs once the Host accepted it.
 */
export type PendingAction =
  | { kind: 'clear' }
  | { kind: 'delete'; id: string; done?: () => void }
  | { kind: 'remove-run'; id: string }
  | { kind: 'retry'; id: string }
  | { kind: 'webhook-rotate'; id: string; done?: () => void }
  | { kind: 'webhook-remove'; id: string; done?: () => void }
  | { kind: 'board-remove'; id: string }

/** Operation and payload each confirmed action sends. */
function operationOf(action: PendingAction): { operation: string; payload: object } {
  switch (action.kind) {
    case 'clear': return { operation: 'clear', payload: {} }
    case 'delete': return { operation: 'delete', payload: { id: action.id } }
    case 'remove-run': return { operation: 'remove-run', payload: { id: action.id } }
    case 'retry': return { operation: 'retry', payload: { id: action.id } }
    case 'webhook-rotate': return { operation: 'webhook-rotate', payload: { id: action.id } }
    case 'webhook-remove': return { operation: 'webhook-disable', payload: { id: action.id } }
    case 'board-remove': return { operation: 'board-remove', payload: { id: action.id } }
  }
}

/**
 * Confirmation copy of one pending action.
 * @param action - the action awaiting confirmation.
 * @param t - the automations dictionary.
 * @returns the dialog's title, description, and confirm label.
 */
export function confirmationOf(action: PendingAction, t: Translate): { title: string; description: string; confirm: string } {
  switch (action.kind) {
    case 'clear': return { title: t('clearRuns'), description: t('clearConfirm'), confirm: t('clearRuns') }
    case 'delete': return { title: t('deleteTitle'), description: t('confirmation'), confirm: t('remove') }
    case 'remove-run': return { title: t('removeRun'), description: t('removeRunConfirm'), confirm: t('remove') }
    case 'retry': return { title: t('retry'), description: t('retryWarning'), confirm: t('retry') }
    case 'webhook-rotate': return { title: t('webhookRotateTitle'), description: t('webhookRotateConfirm'), confirm: t('webhookRotate') }
    case 'webhook-remove': return { title: t('webhookRemove'), description: t('webhookRemoveConfirm'), confirm: t('webhookRemove') }
    case 'board-remove': return { title: t('boardRemove'), description: t('boardRemoveConfirm'), confirm: t('remove') }
  }
}

/** What the data hook needs from the page's props. */
type Source = Pick<InjectFace<AutomationPanelInjected>, 'list' | 'call' | 'services' | 'useGeneration'> & { t: Translate }

/**
 * Read the bot list every five seconds while connected, read connector state, and send management operations.
 * @param source - the page's bound operations and dictionary.
 * @returns the list, its error, and the operations the bot pages share.
 */
export function useAutomations({ t, list, call, services, useGeneration }: Source) {
  const connected = useGeneration(generation => generation !== undefined)
  const [data, setData] = useState<AutomationList | null>(lastList)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [pending, setPending] = useState<PendingAction | null>(null)
  /** Runs whose stop was sent; a cloud run stays active until its cloud Host reports the stop. */
  const [stopping, setStopping] = useState<ReadonlySet<string>>(new Set())
  const [serviceState, setServiceState] = useState<ServiceState | null>(null)
  useEffect(() => {
    if (!connected) return
    let alive = true
    const load = (): void => {
      void list()
        .then((value) => { lastList = value; if (alive) { setData(value); setError('') } })
        .catch((reason: unknown) => { if (alive) setError(reason instanceof Error ? reason.message : t('error')) })
    }
    load()
    const timer = setInterval(load, 5000)
    return () => { alive = false; clearInterval(timer) }
  }, [connected, list, refresh, t])
  /** Service groups a starter needs and the account has not connected. */
  const missing = (needs: readonly ServiceNeed[]): ServiceNeed[] => serviceState === null
    ? []
    : needs.filter(need => !SERVICE_NEEDS[need].some(provider => serviceState.connected.has(provider)))
  const anyMissing = TEMPLATE_CATEGORIES.some(category => category.templates.some(template => missing(template.needs).length > 0))
  useEffect(() => {
    if (!connected) return
    let alive = true
    const load = (): void => {
      void services()
        .then((value) => { if (alive) setServiceState(value) })
        // A failed read keeps the last known state; the page stays usable without Connect actions.
        .catch((): void => undefined)
    }
    load()
    // Connecting happens in Settings or in a provider's consent window, so re-read on return
    // and, while a starter still lacks an account, at a slow interval.
    window.addEventListener('focus', load)
    const timer = anyMissing ? setInterval(load, 15000) : undefined
    return () => { alive = false; window.removeEventListener('focus', load); clearInterval(timer) }
  }, [connected, services, anyMissing])
  /** Send one management operation, then reload the list; a refusal shows as the page's alert. */
  const send = (operation: string, payload: object, done?: () => void): void => {
    setBusy(true); setError('')
    void call(operation, payload)
      .then(() => { setRefresh(value => value + 1); done?.() })
      .catch((reason: unknown) => { setError(reason instanceof Error ? reason.message : t('error')) })
      .finally(() => { setBusy(false) })
  }
  /** Send one stop; the bot's status spins from the click until the run is no longer queued or running. */
  const stop = (id: string): void => {
    if (stopping.has(id)) return
    setStopping(value => new Set(value).add(id)); setError('')
    void call('stop', { id })
      .then(() => { setRefresh(value => value + 1) })
      .catch((reason: unknown) => {
        setStopping((value) => { const next = new Set(value); next.delete(id); return next })
        setError(reason instanceof Error ? reason.message : t('error'))
      })
  }
  /** Send the confirmed action and close its dialog. */
  const confirm = (action: PendingAction): void => {
    setPending(null)
    const { operation, payload } = operationOf(action)
    send(operation, payload, 'done' in action ? action.done : undefined)
  }
  return {
    connected, data, error, busy, unavailable: !connected || data === null || busy,
    send, stop, stopping, pending, setPending, confirm, serviceState, missing, anyMissing,
  }
}

/** The shared page state and operations. */
export type Automations = ReturnType<typeof useAutomations>
