/**
 * The dialog that hands the user a new recovery key: it shows the key with Copy and Download, then asks for it once
 * more, so the user leaves with the key saved, as Apple's account recovery key setup does.
 */
import { useState } from 'react'
import { Button, Input, Modal } from '@aeven/client-ui-primitives'
import type { SyncLocaleKey } from './locales.ts'
import { normalizeRecoveryKey, saveRecoveryKey } from './recovery.ts'
import css from './SyncSection.module.css'

/** Translate a key with `{name}` placeholders, as the section's `t` does. */
type Translate = (key: SyncLocaleKey, values?: Record<string, string>) => string

/**
 * Show a new recovery key and confirm the user saved it.
 * @param props - the key, the translator, and what closing does.
 * @param props.recoveryKey - the key in groups of four, as the Host returned it.
 * @param props.t - the section's translator.
 * @param props.onClose - called when the user finished or closed the dialog.
 * @returns the dialog.
 */
export function RecoveryKeyDialog({ recoveryKey, t, onClose }: { recoveryKey: string; t: Translate; onClose: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const [typed, setTyped] = useState('')
  const [mismatch, setMismatch] = useState(false)
  const [copied, setCopied] = useState(false)

  if (confirming) {
    const check = (): void => {
      if (normalizeRecoveryKey(typed) === normalizeRecoveryKey(recoveryKey)) onClose()
      else setMismatch(true)
    }
    return (
      <Modal
        open onClose={onClose} title={t('confirmTitle')} description={t('confirmBody')} closeLabel={t('close')}
        footer={(
          <>
            <Button variant="outline" onClick={() => { setConfirming(false); setMismatch(false) }}>{t('back')}</Button>
            <Button variant="primary" disabled={typed.trim() === ''} onClick={check}>{t('done')}</Button>
          </>
        )}
      >
        <Input
          value={typed}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          placeholder={t('recoveryPlaceholder')}
          aria-label={t('confirmTitle')}
          onChange={(event) => { setTyped(event.target.value); setMismatch(false) }}
          onKeyDown={(event) => { if (event.key === 'Enter' && typed.trim() !== '') check() }}
        />
        {mismatch ? <p className={css.failed} role="alert">{t('confirmMismatch')}</p> : undefined}
      </Modal>
    )
  }
  return (
    <Modal
      open onClose={onClose} title={t('recoveryKeyTitle')} description={t('recoveryKeyBody')} closeLabel={t('close')}
      footer={<Button variant="primary" onClick={() => { setConfirming(true) }}>{t('continue')}</Button>}
    >
      <p className={css.recoveryKey}>{recoveryKey}</p>
      <div className={css.stepActions}>
        <Button variant="outline" size="sm" onClick={() => { void navigator.clipboard.writeText(recoveryKey).then(() => { setCopied(true) }) }}>
          {copied ? t('copied') : t('copy')}
        </Button>
        <Button variant="outline" size="sm" onClick={() => { saveRecoveryKey(recoveryKey, t('recoveryFile')) }}>{t('download')}</Button>
      </div>
    </Modal>
  )
}
