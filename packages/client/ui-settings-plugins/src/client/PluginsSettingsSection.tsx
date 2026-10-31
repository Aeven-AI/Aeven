/**
 * Plugin settings section: the pages the plugins themselves contribute, under
 * one heading. A deployment that registers a single page shows it as the
 * section; the tab strip appears only once a second page joins.
 */

import { useEffect, useId, useState } from 'react'
import { SectionHeader, Tabs } from '@aeven/client-ui-primitives'
import type {
  HostObservable, InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime,
} from '@aeven/client-ui-slots'
import type { PluginsSettingsLocaleKey } from './locales.ts'
import css from './PluginsSettingsSection.module.css'

/** One tab projected from a `settings.plugins.tab` contribution. */
export interface PluginsSettingsTabEntry {
  id: string
  order: number
  label: string
}

/** Registration-side business face for the section. */
export interface PluginsSettingsSectionInjected {
  hooks: {
    /** Ordered, locale-aware projection of the Plugins tab ledger. */
    tabs: HostObservable<readonly PluginsSettingsTabEntry[]>
  }
}

/** Props the renderer binds for the section. */
export type PluginsSettingsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.plugins'>
  & PropsRenderSlots<'settings.plugins.tab'>
  & InjectFace<PluginsSettingsSectionInjected>

/** Render the plugin settings pages whose contents arrive from feature-owned tabs. */
export function PluginsSettingsSection({ t, renderSlot, useTabs }: PluginsSettingsSectionProps) {
  const tabsId = useId()
  const rows = useTabs(value => value)
  const [activeId, setActiveId] = useState<string>()
  const [visitedIds, setVisitedIds] = useState<ReadonlySet<string>>(() => new Set())
  const active = rows.find(row => row.id === activeId)?.id ?? rows[0]?.id

  // One page is the section itself: a strip would label a single view that
  // never changes, so the page renders directly under the heading.
  const tabbed = rows.length > 1

  // A tab mounts only when first selected, then stays mounted while hidden so
  // local drafts, disclosure state, search, and the inventory snapshot survive
  // switching between the views.
  useEffect(() => {
    if (active === undefined) return
    setVisitedIds((previous) => {
      if (previous.has(active)) return previous
      return new Set([...previous, active])
    })
  }, [active])

  const pages = tabbed ? rows.filter(row => row.id === active || visitedIds.has(row.id)) : rows.slice(0, 1)

  return (
    <div className={css.section}>
      <SectionHeader title={t('title')} description={t('intro')} />
      {rows.length === 0 ? <p className={css.empty}>{t('empty')}</p> : (
        <>
          {tabbed && (
            <Tabs
              items={rows.map(row => ({ id: row.id, label: row.label }))}
              activeId={active}
              onSelect={setActiveId}
              label={t('tabs')}
              idPrefix={tabsId}
            />
          )}
          {pages.map((row) => {
            const selected = row.id === active
            return (
              <div
                key={row.id}
                id={`${tabsId}-panel-${row.id}`}
                className={css.panel}
                role={tabbed ? 'tabpanel' : undefined}
                aria-labelledby={tabbed ? `${tabsId}-tab-${row.id}` : undefined}
                hidden={tabbed ? !selected : undefined}
              >
                {renderSlot('settings.plugins.tab', {}, { only: row.id })}
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}

declare module '@aeven/client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Plugins section, configurable-tab, and card copy. */
    'settings.plugins': PluginsSettingsLocaleKey
  }
}
