/**
 * The naming occupant of ui-workspace's directory-flow holes: a small dialog
 * that asks for a title and hands it to the owner, which creates a Workspace
 * with no directory. Composed instead of a directory picker on a Host whose
 * Workspaces carry no folder.
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { Button, Modal } from '@aeven/client-ui-primitives'
import type { Translate } from '@aeven/client-locale/client'
// Type-only: the owner contract of the directory-flow holes.
import type { DirectoryFlowOwnerProps } from '@aeven/client-ui-workspace/client'
import css from './NameWorkspaceFlow.module.css'

/** Injected face: this package's localized copy. */
export interface NameFlowInjected {
  /** Localized dialog copy (this package's namespace). */
  t: Translate
}

/**
 * Ask for a Workspace title while the owner requests a flow; a confirmed
 * non-blank title is the outcome, dismissal is the cancellation.
 * @param props - owner conversation plus the injected copy.
 * @returns the dialog element (renders nothing while closed).
 */
export function NameWorkspaceFlow(props: DirectoryFlowOwnerProps & NameFlowInjected): ReactElement {
  const { open, busy, onNamed, onCancel, t } = props
  const [draft, setDraft] = useState('')
  const composing = useRef(false)
  // Each request starts from an empty field.
  useEffect(() => {
    if (open) setDraft('')
  }, [open])
  const title = draft.trim()
  const confirm = (): void => {
    if (busy || title === '') return
    onNamed(title)
  }
  const cancel = (): void => {
    if (!busy) onCancel()
  }
  return (
    <Modal open={open} onClose={cancel} title={t('name.title')} className={css.dialog ?? ''} headless>
      <div className={css.body}>
        <h3 className={css.heading}>{t('name.title')}</h3>
        <p className={css.hint}>{t('name.hint')}</p>
        <input
          className={css.input}
          value={draft}
          aria-label={t('name.label')}
          placeholder={t('name.placeholder')}
          autoFocus
          disabled={busy}
          onChange={(event) => { setDraft(event.target.value) }}
          onCompositionStart={() => { composing.current = true }}
          onCompositionEnd={() => { composing.current = false }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !composing.current) {
              event.preventDefault()
              confirm()
            }
          }}
        />
        <div className={css.actions}>
          <Button variant="outline" disabled={busy} onClick={cancel}>{t('name.cancel')}</Button>
          <Button variant="primary" disabled={busy || title === ''} onClick={confirm}>{t('name.create')}</Button>
        </div>
      </div>
    </Modal>
  )
}
