/**
 * Language preference row registered into the General section item slot:
 * the row title and a selector opening the locale menu. Registered by this
 * package — the locale feature owns its own settings surface.
 */
import type { PropsLocale, PropsRuntime, PropsStore } from '@aeven/client-ui-slots'
import { SettingsRow, SettingsSelect } from '@aeven/client-ui-primitives'
import type {} from '@aeven/client-ui-settings/client'
import type { createLanguageRowStore } from './settings-store.ts'

/** Injected business face: the preference write (t rides the standard locale seat). */
export interface LanguageRowInjected {
  /** Switch the active locale (a registered locale id). */
  setLocale: (id: string) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type LanguageRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createLanguageRowStore>>
  & PropsLocale<'settings.locale'> & LanguageRowInjected

/**
 * Render the Language row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function LanguageRow({ t, setLocale, useStore }: LanguageRowComponentProps) {
  const active = useStore(s => s.active)
  const options = useStore(s => s.options)
  const activeLabel = options.find(o => o.id === active)?.label ?? active

  return (
    <SettingsRow
      title={t('language.title')}
      control={(
        <SettingsSelect
          items={options.map(o => ({ id: o.id, label: o.label }))}
          selectedId={active}
          value={activeLabel}
          onSelect={setLocale}
        />
      )}
    />
  )
}
