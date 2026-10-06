/** The Personalization settings page: a voice picked from example replies, the account name, and notes in the person's own words. */
import { useCallback, useEffect, useId, useState } from 'react'
import type { PersonalizationChange, PersonalizationUpdate, PersonalizationView, PersonalizationVoice } from '@aeven/api-remotes/client'
import { Button, SectionHeader, Spinner } from '@aeven/client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import css from './PersonalizationSection.module.css'

/** Registration-side operations the page calls. */
export interface PersonalizationSectionInjected {
  read: () => Promise<PersonalizationView>
  update: (update: PersonalizationUpdate) => Promise<PersonalizationChange>
  /**
   * The account display name and how to change it, or undefined when nobody is signed in to an Aeven account.
   * @returns the current name and its save operation.
   */
  accountName: () => { readonly name: string; readonly save: (name: string) => Promise<string> } | undefined
}

/** Full component props assembled by the slot renderer. */
export type PersonalizationSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.personalization'>
  & InjectFace<PersonalizationSectionInjected>

type Load = { readonly status: 'loading' } | { readonly status: 'error' } | { readonly status: 'ready'; readonly view: PersonalizationView }
type Notice = 'saved' | 'tooLong' | 'failed'

const VOICES: readonly PersonalizationVoice[] = ['automatic', 'warm', 'direct', 'playful']

/**
 * Render the Personalization section.
 * @param props - composed Settings slot props.
 * @returns the section.
 */
export function PersonalizationSection({ read, update, accountName, t }: PersonalizationSectionProps) {
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [account] = useState(accountName)
  const [savedName, setSavedName] = useState(account?.name ?? '')
  const [callName, setCallName] = useState(account?.name ?? '')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>()
  const nameId = useId()
  const notesId = useId()

  const adopt = useCallback((view: PersonalizationView) => {
    setLoad({ status: 'ready', view })
    setNotes(view.notes)
  }, [])

  const refresh = useCallback(() => {
    setLoad({ status: 'loading' })
    read().then(adopt, () => { setLoad({ status: 'error' }) })
  }, [read, adopt])

  useEffect(() => { refresh() }, [refresh])

  /** Apply a voice change at once; unsaved name and notes drafts stay as typed. */
  const commitVoice = (voice: PersonalizationVoice) => {
    setBusy(true)
    setNotice(undefined)
    update({ voice }).then((result) => {
      setLoad({ status: 'ready', view: result.view })
      setNotice('saved')
    }, () => { setNotice('failed') }).finally(() => { setBusy(false) })
  }

  /** Save the name to the account and the notes to this person's preferences, each only when it changed. */
  const saveText = async (view: PersonalizationView) => {
    setBusy(true)
    setNotice(undefined)
    try {
      const name = callName.trim()
      if (account !== undefined && name !== '' && name !== savedName) {
        const stored = await account.save(name)
        setSavedName(stored)
        setCallName(stored)
      }
      if (notes.trim() !== view.notes) {
        const result = await update({ notes })
        if (result.reason === 'too-long') {
          setLoad({ status: 'ready', view: result.view })
          setNotice('tooLong')
          return
        }
        adopt(result.view)
      }
      setNotice('saved')
    } catch {
      setNotice('failed')
    } finally {
      setBusy(false)
    }
  }

  if (load.status === 'loading') {
    return (
      <div className={css.section}>
        <SectionHeader title={t('nav')} description={t('intro')} />
        <p className={css.status}><Spinner /> {t('loading')}</p>
      </div>
    )
  }
  if (load.status === 'error') {
    return (
      <div className={css.section}>
        <SectionHeader title={t('nav')} description={t('intro')} />
        <p className={css.failure}>
          {t('failed')} <button type="button" className={css.textButton} onClick={refresh}>{t('retry')}</button>
        </p>
      </div>
    )
  }

  const { view } = load
  const nameDirty = account !== undefined && callName.trim() !== '' && callName.trim() !== savedName
  const textDirty = nameDirty || notes.trim() !== view.notes
  const overLimit = notes.trim().length > view.maxNotesChars
  return (
    <div className={css.section}>
      <SectionHeader title={t('nav')} description={t('intro')} />

      <div className={css.group} role="radiogroup" aria-label={t('voice')}>
        <div className={css.label}>{t('voice')}</div>
        {VOICES.map((voice) => {
          const selected = view.voice === voice
          return (
            <button
              key={voice}
              type="button"
              role="radio"
              aria-checked={selected}
              className={css.voice}
              data-active={selected ? 'true' : undefined}
              disabled={busy}
              onClick={() => { if (!selected) commitVoice(voice) }}
            >
              <span className={css.voiceHead}>
                <span className={css.radio} aria-hidden="true" />
                <span className={css.voiceName}>{t(`voice.${voice}`)}</span>
              </span>
              <span className={css.voiceDescription}>{t(`voice.${voice}.description`)}</span>
              <span className={css.voiceSample}>{t(`voice.${voice}.sample`)}</span>
            </button>
          )
        })}
      </div>

      {account !== undefined && (
        <div className={css.group}>
          <label className={css.label} htmlFor={nameId}>{t('callName')}</label>
          <input
            id={nameId}
            className={css.input}
            value={callName}
            placeholder={t('callNamePlaceholder')}
            onChange={(event) => { setCallName(event.target.value); setNotice(undefined) }}
          />
          <span className={css.count}>{t('callNameHint')}</span>
        </div>
      )}

      <div className={css.group}>
        <label className={css.label} htmlFor={notesId}>{t('notes')}</label>
        <textarea
          id={notesId}
          className={css.input}
          rows={4}
          value={notes}
          placeholder={t('notesPlaceholder')}
          onChange={(event) => { setNotes(event.target.value); setNotice(undefined) }}
        />
        <div className={css.footer}>
          <span className={notes.trim().length > view.maxNotesChars ? css.countOver : css.count}>
            {t('notesCount', { chars: String(notes.trim().length), max: String(view.maxNotesChars) })}
          </span>
          <Button
            variant="primary"
            disabled={busy || !textDirty || overLimit}
            onClick={() => { void saveText(view) }}
          >
            {t('save')}
          </Button>
        </div>
      </div>

      {notice !== undefined && (
        <p className={notice === 'saved' ? css.note : css.failure} role="status">{t(notice)}</p>
      )}
    </div>
  )
}
