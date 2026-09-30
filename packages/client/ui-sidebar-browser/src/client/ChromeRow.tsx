/**
 * The browser's chrome row: navigation, the address field, and page actions,
 * ported from t3code's `PreviewChromeRow` with its ordering and the app's lucide
 * glyphs.
 *
 * The address field is a combined field: it shows the committed URL until
 * focused, and text that names no host is searched for with the reader's
 * engine. Editing works on a draft, so a page that navigates mid-edit does not
 * overwrite what is typed, and the completion list the pane fetched for that
 * draft hangs under the field with the keyboard selecting inside it.
 */
import clsx from 'clsx'
import type { FormEvent, ReactNode } from 'react'
import { useId, useRef, useState } from 'react'
import {
  IconLucideArrowLeft, IconLucideArrowRight, IconLucideCamera, IconLucideCheck, IconLucideRefreshCw,
  IconLucideSquareArrowOutUpRight, Tooltip,
} from '@aeven/client-ui-primitives'
import type { SidebarBrowserKey } from './locales.ts'
import { SuggestionList } from './SuggestionList.tsx'
import css from './BrowserPane.module.css'

/** Props of the chrome row. */
export interface ChromeRowProps {
  /** Committed URL of the page. */
  url: string
  /** Whether a load is in progress; the refresh control stops it. */
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  onBack: () => void
  onForward: () => void
  onRefresh: () => void
  /** Called with the entered text on Enter, or with the entry a pointer picked. */
  onSubmit: (text: string) => void
  /** Called with the draft on every edit, so the pane can fetch completions for it. */
  onDraftChange: (text: string) => void
  /** Completions for the current draft, in engine order. */
  suggestions: readonly string[]
  /** Placeholder naming the engine a query searches with. */
  placeholder: string
  /** Open the page in the Host's Chrome, the profile the agent's DevTools tools drive; revealed on hover over the address. */
  onOpenInChrome: () => void
  /** Copy a screenshot of the page to the clipboard. */
  onCapture: () => void
  /** True briefly after a capture reached the clipboard; the control shows a check meanwhile. */
  captured: boolean
  /** Rendered after the page actions: the three-dot menu. */
  trailingActions: ReactNode
  t: (key: SidebarBrowserKey) => string
}

/**
 * Render the chrome row.
 * @param props - see {@link ChromeRowProps}.
 * @returns the row element tree.
 */
export function ChromeRow(props: ChromeRowProps): ReactNode {
  const { url, loading, t } = props
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [draft, setDraft] = useState(url)
  const [focused, setFocused] = useState(false)
  const [selected, setSelected] = useState(-1)
  const [dismissed, setDismissed] = useState(false)
  const listId = useId()

  // A completion list the reader dismissed with Escape stays closed until the
  // draft moves again, and a selection left past a shorter list selects nothing.
  const highlight = selected < props.suggestions.length ? selected : -1
  const open = focused && !dismissed && props.suggestions.length > 0

  const submit = (text: string): void => {
    const next = text.trim()
    if (next.length === 0) return
    props.onSubmit(next)
    inputRef.current?.blur()
  }

  const submitForm = (event: FormEvent): void => {
    event.preventDefault()
    submit(open && highlight >= 0 ? props.suggestions[highlight] as string : draft)
  }

  return (
    <div className={css.chrome}>
      <form className={css.row} onSubmit={submitForm}>
        <div className={css.group} role="group" aria-label={t('navigation')}>
          <Tooltip label={t('back')} side="bottom">
            <button type="button" className={css.control} aria-label={t('back')} disabled={!props.canGoBack} onClick={props.onBack}>
              <IconLucideArrowLeft />
            </button>
          </Tooltip>
          <Tooltip label={t('forward')} side="bottom">
            <button type="button" className={css.control} aria-label={t('forward')} disabled={!props.canGoForward} onClick={props.onForward}>
              <IconLucideArrowRight />
            </button>
          </Tooltip>
          <Tooltip label={loading ? t('loading') : t('refresh')} side="bottom">
            <button type="button" className={css.control} aria-label={loading ? t('stop') : t('refresh')} onClick={props.onRefresh}>
              <IconLucideRefreshCw className={clsx(loading && css.spin)} />
            </button>
          </Tooltip>
        </div>

        <div className={css.address}>
          <input
            ref={inputRef}
            className={css.addressInput}
            type="text"
            role="combobox"
            aria-label={t('address.label')}
            aria-expanded={open}
            aria-autocomplete="list"
            aria-controls={listId}
            aria-activedescendant={open && highlight >= 0 ? `${listId}-${String(highlight)}` : undefined}
            placeholder={props.placeholder}
            spellCheck={false}
            value={focused ? draft : url}
            onChange={(event) => {
              setDraft(event.target.value)
              setSelected(-1)
              setDismissed(false)
              props.onDraftChange(event.target.value)
            }}
            onFocus={() => {
              setDraft(url)
              setFocused(true)
              setDismissed(false)
              setSelected(-1)
              queueMicrotask(() => inputRef.current?.select())
            }}
            onBlur={() => {
              setFocused(false)
              setSelected(-1)
            }}
            onKeyDown={(event) => {
              const count = props.suggestions.length
              if (event.key === 'ArrowDown' && count > 0) {
                event.preventDefault()
                setDismissed(false)
                setSelected(selected + 1 >= count ? count - 1 : selected + 1)
                return
              }
              if (event.key === 'ArrowUp' && count > 0) {
                event.preventDefault()
                setDismissed(false)
                setSelected(selected <= -1 ? count - 1 : selected - 1)
                return
              }
              if (event.key !== 'Escape') return
              event.preventDefault()
              if (open) {
                setDismissed(true)
                setSelected(-1)
                return
              }
              setDraft(url)
              inputRef.current?.blur()
            }}
          />
          {!focused && url !== '' && (
            <span className={css.addressAddon}>
              <Tooltip label={t('openInChrome')} side="bottom">
                <button type="button" className={css.control} aria-label={t('openInChrome')} onClick={props.onOpenInChrome}>
                  <IconLucideSquareArrowOutUpRight />
                </button>
              </Tooltip>
            </span>
          )}
          {open && (
            <SuggestionList
              suggestions={props.suggestions}
              query={draft}
              selected={highlight}
              listId={listId}
              optionId={index => `${listId}-${String(index)}`}
              label={t('address.suggestions')}
              onHover={setSelected}
              onPick={(index) => { submit(props.suggestions[index] as string) }}
            />
          )}
        </div>

        <Tooltip label={props.captured ? t('capture.done') : t('capture')} side="bottom">
          <button type="button" className={css.control} aria-label={t('capture')} disabled={url === ''} onClick={props.onCapture}>
            {props.captured ? <IconLucideCheck /> : <IconLucideCamera />}
          </button>
        </Tooltip>
        {props.trailingActions}
      </form>
      <div aria-hidden className={css.progress} data-loading={loading} />
    </div>
  )
}
