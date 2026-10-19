/** The Personalization settings page: the voice as one row of options, notes in the person's own words, and their own master prompt. */
import { useCallback, useEffect, useId, useState } from 'react'
import type { PersonalizationChange, PersonalizationUpdate, PersonalizationView, PersonalizationVoice } from '@aeven/api-remotes/client'
import { Button, LoadingBlock, SectionHeader } from '@aeven/client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import css from './PersonalizationSection.module.css'

/** Registration-side operations the page calls. */
export interface PersonalizationSectionInjected {
  read: () => Promise<PersonalizationView>
  /**
   * The view this page read the last time it was mounted.
   * @returns that view, or undefined when the page has not settled one yet.
   */
  cachedView: () => PersonalizationView | undefined
  update: (update: PersonalizationUpdate) => Promise<PersonalizationChange>
  /** Put the shipped master prompt back in charge. */
  resetMasterPrompt: () => Promise<PersonalizationChange>
}

/** Full component props assembled by the slot renderer. */
export type PersonalizationSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.personalization'>
  & InjectFace<PersonalizationSectionInjected>

type Load = { readonly status: 'loading' } | { readonly status: 'error' } | { readonly status: 'ready'; readonly view: PersonalizationView }
type Notice = 'saved' | 'reset' | 'notesTooLong' | 'masterTooLong' | 'failed'

const VOICES: readonly PersonalizationVoice[] = ['automatic', 'warm', 'direct', 'playful']

/**
 * Render the Personalization section.
 * @param props - composed Settings slot props.
 * @returns the section.
 */
export function PersonalizationSection({ read, cachedView, update, resetMasterPrompt, t }: PersonalizationSectionProps) {
  // The page's own cache answers first, so a revisit paints the view it read
  // last and revalidates behind it instead of showing the spinner again.
  const [load, setLoad] = useState<Load>(() => {
    const view = cachedView()
    return view === undefined ? { status: 'loading' } : { status: 'ready', view }
  })
  const [notes, setNotes] = useState('')
  const [master, setMaster] = useState('')
  const [busy, setBusy] = useState(false)
  const [notesNotice, setNotesNotice] = useState<Notice>()
  const [masterNotice, setMasterNotice] = useState<Notice>()
  const voiceLabelId = useId()
  const notesId = useId()
  const masterId = useId()

  const adopt = useCallback((view: PersonalizationView) => {
    setLoad({ status: 'ready', view })
    setNotes(view.notes)
    setMaster(view.effectiveMasterPrompt)
  }, [])

  const refresh = useCallback(() => {
    setLoad({ status: 'loading' })
    read().then(adopt, () => { setLoad({ status: 'error' }) })
  }, [read, adopt])

  useEffect(() => { refresh() }, [refresh])

  /** Voice saves on the choice itself; the notes and master prompt drafts stay as typed. */
  const commitVoice = (voice: PersonalizationVoice) => {
    setBusy(true)
    update({ voice }).then((result) => {
      setLoad({ status: 'ready', view: result.view })
    }, () => { setNotesNotice('failed') }).finally(() => { setBusy(false) })
  }

  /** Save the notes to this person's preferences only when they changed. */
  const saveNotes = async () => {
    setBusy(true)
    setNotesNotice(undefined)
    try {
      const result = await update({ notes })
      setLoad({ status: 'ready', view: result.view })
      if (result.reason === 'notes-too-long') {
        setNotesNotice('notesTooLong')
        return
      }
      adopt(result.view)
      setNotesNotice('saved')
    } catch {
      setNotesNotice('failed')
    } finally {
      setBusy(false)
    }
  }

  /** Save this person's own master prompt, replacing the shipped one for their sessions. */
  const saveMaster = async () => {
    setBusy(true)
    setMasterNotice(undefined)
    try {
      const result = await update({ masterPrompt: master })
      setLoad({ status: 'ready', view: result.view })
      if (result.reason === 'master-prompt-too-long') {
        setMasterNotice('masterTooLong')
        return
      }
      adopt(result.view)
      setMasterNotice('saved')
    } catch {
      setMasterNotice('failed')
    } finally {
      setBusy(false)
    }
  }

  /** Put the shipped master prompt back in charge and show it in the editor again. */
  const resetMaster = async () => {
    setBusy(true)
    setMasterNotice(undefined)
    try {
      const result = await resetMasterPrompt()
      adopt(result.view)
      setMasterNotice('reset')
    } catch {
      setMasterNotice('failed')
    } finally {
      setBusy(false)
    }
  }

  const header = <SectionHeader title={t('nav')} description={t('intro')} />
  if (load.status === 'loading') {
    return <div className={css.section}>{header}<LoadingBlock label={t('loading')} /></div>
  }
  if (load.status === 'error') {
    return (
      <div className={css.section}>
        {header}
        <p className={css.failure}>
          {t('failed')} <button type="button" className={css.textButton} onClick={refresh}>{t('retry')}</button>
        </p>
      </div>
    )
  }

  const { view } = load
  const notesDirty = notes.trim() !== view.notes
  const notesOver = notes.trim().length > view.maxNotesChars
  const masterDirty = master.trim() !== view.effectiveMasterPrompt
  const masterOver = master.trim().length > view.maxMasterPromptChars
  const selected = view.voice
  return (
    <div className={css.section}>
      {header}

      <div className={css.group}>
        <div className={css.heading} id={voiceLabelId}>{t('voice')}</div>
        <div className={css.voices} role="radiogroup" aria-labelledby={voiceLabelId}>
          {VOICES.map((voice) => {
            const active = selected === voice
            return (
              <button
                key={voice}
                type="button"
                role="radio"
                aria-checked={active}
                className={css.voice}
                data-active={active ? 'true' : undefined}
                disabled={busy}
                onClick={() => { if (!active) commitVoice(voice) }}
              >
                {t(`voice.${voice}`)}
              </button>
            )
          })}
        </div>
        <p className={css.voiceDescription}>{t(`voice.${selected}.description`)}</p>
      </div>

      <div className={css.group}>
        <label className={css.heading} htmlFor={notesId}>{t('notes')}</label>
        <textarea
          id={notesId}
          className={css.input}
          rows={3}
          value={notes}
          placeholder={t('notesPlaceholder')}
          onChange={(event) => { setNotes(event.target.value); setNotesNotice(undefined) }}
        />
        <div className={css.footer}>
          <span className={notesOver ? css.countOver : css.count}>
            {t('count', { chars: String(notes.trim().length), max: String(view.maxNotesChars) })}
          </span>
          <Button
            variant="primary"
            disabled={busy || !notesDirty || notesOver}
            onClick={() => { void saveNotes() }}
          >
            {t('save')}
          </Button>
        </div>
        {notesNotice !== undefined && (
          <p className={notesNotice === 'failed' || notesNotice === 'notesTooLong' ? css.failure : css.note} role="status">
            {t(notesNotice)}
          </p>
        )}
      </div>

      <div className={css.group}>
        <div className={css.masterHead}>
          <label className={css.heading} htmlFor={masterId}>{t('master')}</label>
          {view.customMasterPrompt && <span className={css.badge}>{t('masterChanged')}</span>}
        </div>
        <p className={css.hint}>{t('masterDescription')}</p>
        <div className={css.masterFrame}>
          <textarea
            id={masterId}
            className={`${css.input} ${css.master}`}
            rows={6}
            spellCheck={false}
            value={master}
            onChange={(event) => { setMaster(event.target.value); setMasterNotice(undefined) }}
          />
        </div>
        <div className={css.footer}>
          <span className={masterOver ? css.countOver : css.count}>
            {t('count', { chars: String(master.trim().length), max: String(view.maxMasterPromptChars) })}
          </span>
          <span className={css.actions}>
            <button
              type="button"
              className={css.textButton}
              disabled={busy || !view.customMasterPrompt}
              onClick={() => { void resetMaster() }}
            >
              {t('masterReset')}
            </button>
            <Button
              variant="primary"
              disabled={busy || !masterDirty || masterOver}
              onClick={() => { void saveMaster() }}
            >
              {t('save')}
            </Button>
          </span>
        </div>
        {masterNotice !== undefined && (
          <p className={masterNotice === 'failed' || masterNotice === 'masterTooLong' ? css.failure : css.note} role="status">
            {t(masterNotice)}
          </p>
        )}
      </div>
    </div>
  )
}
