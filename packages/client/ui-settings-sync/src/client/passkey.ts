/** Operations Settings → Sync and the sign-in popup share: reading the status and running a passkey step. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { SyncDeviceView, SyncPasskeyPurpose, SyncPasskeyStart, SyncView } from '@aeven/api-remotes/client'
import { externalWindow } from '@aeven/client-ui-primitives'

/** Registration-side operations over the sync Remote. */
export interface SyncOperations {
  status: () => Promise<SyncView>
  setEnabled: (enabled: boolean) => Promise<SyncView>
  devices: () => Promise<SyncDeviceView[]>
  removeDevice: (id: string) => Promise<SyncDeviceView[]>
  startPasskey: (purpose: SyncPasskeyPurpose) => Promise<SyncPasskeyStart>
  cancelPasskey: () => Promise<SyncView>
  unprotect: () => Promise<SyncView>
  acceptServerKey: () => Promise<SyncView>
  /**
   * Call `listener` whenever the Host reports a sync change, including the end of a passkey step.
   * @param listener - refresh callback.
   * @returns a function that stops listening.
   */
  onChange: (listener: () => void) => () => void
  /**
   * Subscribe to changes to the account's device list.
   * @param listener - refresh callback.
   * @returns a function that stops listening.
   */
  onDevicesChange: (listener: () => void) => () => void
}

/** The status as a view reads it. */
export type SyncLoad = { readonly status: 'loading' } | { readonly status: 'error' } | { readonly status: 'ready'; readonly view: SyncView }

/**
 * Keep the caller's sync status current.
 * @param ops - the sync operations.
 * @param minIntervalMs - shortest time between two reads a change report triggers; a report inside it is answered
 *   once at its end. Status reports arrive several times a second while data uploads.
 * @returns the status and a function that reads it again.
 */
export function useSyncStatus(ops: SyncOperations, minIntervalMs = 0): { load: SyncLoad; refresh: () => Promise<void> } {
  const [load, setLoad] = useState<SyncLoad>({ status: 'loading' })
  const generation = useRef(0)
  const lastRead = useRef(0)
  const refresh = useCallback(async () => {
    lastRead.current = Date.now()
    const run = ++generation.current
    try {
      const view = await ops.status()
      if (run === generation.current) setLoad({ status: 'ready', view })
    } catch {
      if (run === generation.current) setLoad({ status: 'error' })
    }
  }, [ops])
  useEffect(() => {
    void refresh()
    let trailing: ReturnType<typeof setTimeout> | undefined
    const stop = ops.onChange(() => {
      const wait = lastRead.current + minIntervalMs - Date.now()
      if (wait <= 0) {
        void refresh()
        return
      }
      trailing ??= setTimeout(() => {
        trailing = undefined
        void refresh()
      }, wait)
    })
    return () => {
      stop()
      if (trailing !== undefined) clearTimeout(trailing)
    }
  }, [ops, refresh, minIntervalMs])
  return { load, refresh }
}

/**
 * Open the passkey page for a step. The browser tab opens inside the click, before the Host answers, or a browser
 * blocks it as a popup; the desktop shell hands the page to the system browser.
 * @param ops - the sync operations.
 * @param purpose - what the passkey is for.
 * @returns when the page was handed its address.
 */
export async function openPasskeyPage(ops: SyncOperations, purpose: SyncPasskeyPurpose): Promise<void> {
  const target = externalWindow()
  try {
    target.navigate((await ops.startPasskey(purpose)).url)
  } catch (error) {
    target.cancel()
    throw error
  }
}
