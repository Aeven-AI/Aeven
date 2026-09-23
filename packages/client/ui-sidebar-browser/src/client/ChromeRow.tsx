/**
 * The browser's chrome row: navigation, the address field, and page actions,
 * ported from t3code's `PreviewChromeRow` with its glyphs and ordering.
 *
 * The address field shows the committed URL until focused; editing works on a
 * draft, so a page that navigates mid-edit does not overwrite what is typed.
 */
import clsx from 'clsx'
import type { FormEvent, ReactNode } from 'react'
import { useRef, useState } from 'react'
import { Tooltip } from '@aeven/client-ui-primitives'
import { ArrowLeft, ArrowRight, Camera, ExternalLink, RefreshCw } from './icons.tsx'
import type { SidebarBrowserKey } from './locales.ts'
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
  /** Called with the typed address on Enter. */
  onSubmit: (text: string) => void
  /** Open the page in the system browser; revealed on hover over the address. */
  onOpenInBrowser: () => void
  /** Copy a screenshot of the page to the clipboard. */
  onCapture: () => void
  /** True briefly after a capture reached the clipboard. */
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

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    const next = draft.trim()
    if (next.length === 0) return
    props.onSubmit(next)
    inputRef.current?.blur()
  }

  return (
    <div className={css.chrome}>
      <form className={css.row} onSubmit={submit}>
        <div className={css.group} role="group" aria-label={t('navigation')}>
          <Tooltip label={t('back')} side="bottom">
            <button type="button" className={css.control} aria-label={t('back')} disabled={!props.canGoBack} onClick={props.onBack}>
              <ArrowLeft />
            </button>
          </Tooltip>
          <Tooltip label={t('forward')} side="bottom">
            <button type="button" className={css.control} aria-label={t('forward')} disabled={!props.canGoForward} onClick={props.onForward}>
              <ArrowRight />
            </button>
          </Tooltip>
          <Tooltip label={loading ? t('loading') : t('refresh')} side="bottom">
            <button type="button" className={css.control} aria-label={loading ? t('stop') : t('refresh')} onClick={props.onRefresh}>
              <RefreshCw className={clsx(loading && css.spin)} />
            </button>
          </Tooltip>
        </div>

        <div className={css.address}>
          <input
            ref={inputRef}
            className={css.addressInput}
            type="text"
            aria-label={t('address.label')}
            placeholder={t('address.placeholder')}
            spellCheck={false}
            value={focused ? draft : url}
            onChange={(event) => { setDraft(event.target.value) }}
            onFocus={() => {
              setDraft(url)
              setFocused(true)
              queueMicrotask(() => inputRef.current?.select())
            }}
            onBlur={() => { setFocused(false) }}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return
              event.preventDefault()
              setDraft(url)
              inputRef.current?.blur()
            }}
          />
          {!focused && url !== '' && (
            <span className={css.addressAddon}>
              <Tooltip label={t('openExternal')} side="bottom">
                <button type="button" className={css.control} aria-label={t('openExternal')} onClick={props.onOpenInBrowser}>
                  <ExternalLink />
                </button>
              </Tooltip>
            </span>
          )}
        </div>

        <Tooltip label={props.captured ? t('capture.done') : t('capture')} side="bottom">
          <button type="button" className={css.control} aria-label={t('capture')} disabled={url === ''} onClick={props.onCapture}>
            <Camera />
          </button>
        </Tooltip>
        {props.trailingActions}
      </form>
      <div aria-hidden className={css.progress} data-loading={loading} />
    </div>
  )
}
