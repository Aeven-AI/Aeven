/**
 * A subscription's models with one checkbox each and a select-all control.
 * A change applies at once: the Host persists the switched-off ids and the
 * model picker and image-model menus follow its pushed invalidation.
 */

import { Tooltip } from '@aeven/client-ui-primitives'
import { bodyStyle, sectionTitleStyle, textButtonStyle } from '../styles.ts'
import type { GrokBuildSettingsInjected, ModelView } from '../types.ts'

export interface ModelsListProps {
  t: GrokBuildSettingsInjected['t']
  models: readonly ModelView[]
  /** A selection write is in flight; controls stay disabled until it settles. */
  busy: boolean
  /**
   * Replace the selection with exactly `selected`.
   * @param selected - every model id that should be on.
   */
  onChange: (selected: readonly string[]) => void
}

const listStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 0',
  borderTop: '0.5px solid var(--dsw-alias-border-l2)',
  cursor: 'pointer',
}

const nameStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontSize: 14,
  lineHeight: '20px',
  color: 'var(--dsw-alias-label-primary)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const capabilityStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  color: 'var(--dsw-alias-label-tertiary)',
}

const checkboxStyle: React.CSSProperties = {
  width: 16,
  height: 16,
  margin: 0,
  flex: 'none',
  accentColor: 'var(--dsw-alias-label-primary)',
  cursor: 'inherit',
}

/** Lucide `eye`: the model reads images. */
function ImageInputIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

/** Lucide `image-plus`: the model generates images. */
function ImageOutputIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 5h6" />
      <path d="M19 2v6" />
      <path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
      <circle cx="9" cy="9" r="2" />
    </svg>
  )
}

function Capability({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip label={label} side="top">
      <span style={capabilityStyle} role="img" aria-label={label}>
        {children}
      </span>
    </Tooltip>
  )
}

/**
 * Render the Models block of one provider card.
 * @param props - the models, the write state, and the change handler.
 * @returns the block.
 */
export function ModelsList({ t, models, busy, onChange }: ModelsListProps) {
  const selected = models.filter(model => model.selected).map(model => model.id)
  const allSelected = selected.length === models.length
  const toggle = (id: string, on: boolean): void => {
    onChange(on ? [...selected, id] : selected.filter(other => other !== id))
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <p style={sectionTitleStyle}>{t('models')}</p>
        {models.length === 0 ? null : (
          <button
            type="button"
            style={textButtonStyle}
            disabled={busy}
            onClick={() => { onChange(allSelected ? [] : models.map(model => model.id)) }}
          >
            {t(allSelected ? 'deselectAll' : 'selectAll')}
          </button>
        )}
      </div>
      {models.length === 0 ? <p style={bodyStyle}>{t('modelsEmpty')}</p> : (
        <ul style={listStyle} aria-label={t('models')}>
          {models.map(model => (
            <li key={model.id}>
              <label style={{ ...rowStyle, cursor: busy ? 'default' : 'pointer' }} title={model.id}>
                <input
                  type="checkbox"
                  style={checkboxStyle}
                  checked={model.selected}
                  disabled={busy}
                  onChange={(event) => { toggle(model.id, event.target.checked) }}
                />
                <span style={nameStyle}>{model.name}</span>
                {model.imageInput ? <Capability label={t('capabilityImageInput')}><ImageInputIcon /></Capability> : null}
                {model.imageOutput ? <Capability label={t('capabilityImageOutput')}><ImageOutputIcon /></Capability> : null}
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
