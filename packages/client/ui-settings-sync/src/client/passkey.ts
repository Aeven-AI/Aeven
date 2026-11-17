/** Operations Settings → Sync and the sign-in popup share: reading the status and running a passkey step. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { SyncDeviceView, SyncPasskeyPurpose, SyncPasskeyStart, SyncRecoveryKey, SyncSignInUnlock, SyncView } from '@aeven/api-remotes/client'
import { externalWindow } from '@aeven/client-ui-primitives'

/** Registration-side operations over the sync Remote. */
export interface SyncOperations {
  status: () => Promise<SyncView>
  setEnabled: (enabled: boolean) => Promise<SyncView>
  devices: () => Promise<SyncDeviceView[]>
  /**
   * Start a passkey step; `account` names a created passkey in the password manager, and `replaces` is the passkey an
   * `upgrade` replaces.
   */
  startPasskey: (purpose: SyncPasskeyPurpose, account?: string, replaces?: string) => Promise<SyncPasskeyStart>
  cancelPasskey: () => Promise<SyncView>
  /** Hand the key back to the relay; on a locked device this starts over from the device's own data. */
  unprotect: () => Promise<SyncView>
  acceptServerKey: () => Promise<SyncView>
  /** Create a recovery key that also holds the account key; its text is shown once. */
  createRecoveryKey: () => Promise<SyncRecoveryKey>
  /** Unlock this device with a recovery key the user typed. */
  unlockWithRecoveryKey: (key: string) => Promise<SyncView>
  /** Name one of the account's passkeys. */
  renamePasskey: (id: string, name: string) => Promise<SyncView>
  /** Remove one of the account's passkeys or its recovery key. */
  removePasskey: (id: string) => Promise<SyncView>
  /**
   * Unlock this device with the passkey a sign-in on this page just used.
   * @param unlock - the verifier and key pair the sign-in page was opened with.
   * @returns the status afterwards.
   */
  unlockFromSignIn: (unlock: SyncSignInUnlock) => Promise<SyncView>
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
 * Bring the desktop window forward once a passkey step the reader finished in the system browser succeeds. The
 * browser build has no desktop shell and stays as it is.
 */
export function focusAfterPasskey(): void {
  const carrier = typeof window === 'undefined' ? undefined : (window as { avnDesktop?: { window?: { focus?: () => Promise<void> } } }).avnDesktop
  void carrier?.window?.focus?.().catch(() => undefined)
}

/**
 * Bring the desktop window forward when the passkey step this view waited on ends without an error.
 * @param view - the sync status, or undefined while it loads.
 */
export function useFocusAfterPasskey(view: SyncView | undefined): void {
  const waiting = useRef(false)
  useEffect(() => {
    if (view === undefined) return
    const now = view.passkey?.state === 'waiting'
    // A step that ended with no step left in the status succeeded; a failed one stays in the status to explain itself.
    if (waiting.current && !now && view.passkey === undefined) focusAfterPasskey()
    waiting.current = now
  }, [view])
}

/**
 * Open the passkey page for a step. The browser tab opens inside the click, before the Host answers, or a browser
 * blocks it as a popup; the desktop shell hands the page to the system browser.
 * @param ops - the sync operations.
 * @param purpose - what the passkey is for.
 * @param account - the account's email, which names a created passkey in the password manager.
 * @param replaces - the passkey an `upgrade` replaces.
 * @returns when the page was handed its address.
 */
export async function openPasskeyPage(
  ops: SyncOperations, purpose: SyncPasskeyPurpose, account?: string, replaces?: string,
): Promise<void> {
  const target = externalWindow()
  try {
    target.navigate((await ops.startPasskey(purpose, account, replaces)).url)
  } catch (error) {
    target.cancel()
    throw error
  }
}
