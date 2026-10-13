/** The permission modes the composer's Options popup offers: the mode list, and
 * the glyph and product label each mode shows. The popup owns the pick flow —
 * the optimistic pick, the command, and the Full-access risk confirmation — so
 * this module carries only what a mode is called and how its row is drawn. */

import type { ReactNode } from 'react'
import clsx from 'clsx'
import type { PermissionSelect as PermissionSelectValue } from '@aeven/permission-presets/client'
import { IconCheckOutline16 } from '@aeven/client-ui-primitives'
import type { ComposerBarProps } from '../contract/slots.ts'
import { en } from '../locales.ts'
import css from './PermissionOptions.module.css'

/** The mode whose pick raises the risk confirmation. */
export const FULL_ACCESS = 'danger-full-access'

/* Shield glyphs (design set 1556): check = read-only, pencil = workspace
   write, exclamation = full access. currentColor so the popup row and the
   list rows tint them with their own text color. */

const shieldOutline = 'M8.20554 0.899994L14.7901 3.36857V7.01026C14.7901 12 11.0466 14.2103 8.20554 15.3C5.36446 14.2103 1.62012 12 1.62012 7.01026V3.36857L8.20554 0.899994Z'

const permissionGlyphs = new Map<string, ReactNode>([
  ['read-only', (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d={shieldOutline} stroke="currentColor" strokeWidth="1.31831" strokeLinejoin="round" />
      <path d="M12.1654 5.7552L8.9447 9.41475C8.73044 9.65816 8.53628 9.8804 8.35774 10.0423C8.1713 10.2114 7.94235 10.3717 7.64016 10.4254C7.48207 10.4535 7.32 10.4552 7.16151 10.4294C6.85843 10.3801 6.62728 10.2223 6.43836 10.0559C6.25752 9.89653 6.06037 9.67732 5.84264 9.43705L4.72925 8.20897L5.63557 7.38707L6.74897 8.61594C6.98603 8.87755 7.12974 9.03533 7.24673 9.13839C7.31033 9.19443 7.34485 9.21476 7.35823 9.22122C7.38068 9.22484 7.40352 9.22515 7.42593 9.22122C7.40522 9.22502 7.42893 9.23294 7.53583 9.136C7.65132 9.03126 7.79316 8.87139 8.02643 8.60638L11.2479 4.94763L12.1654 5.7552Z" fill="currentColor" />
    </svg>
  )],
  ['workspace-write', (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8.08887 0.251709C8.20479 0.23085 8.32486 0.241168 8.43652 0.282959L15.0215 2.75171C15.2787 2.84819 15.4492 3.09414 15.4492 3.3689V7.0105C15.4492 7.10986 15.4441 7.2081 15.4414 7.30542C15.0285 7.07175 14.5905 6.87695 14.1309 6.73022V3.82495L8.20508 1.60327L2.2793 3.82495V7.0105C2.27936 9.7171 3.4745 11.5379 5.02734 12.7947C5.01025 12.9942 5 13.1962 5 13.4001C5.00001 13.7617 5.02722 14.1169 5.08008 14.4636C2.91555 13.0393 0.961014 10.752 0.960938 7.0105V3.3689C0.960938 3.09417 1.13146 2.84821 1.38867 2.75171L7.97461 0.282959L8.08887 0.251709Z" fill="currentColor" />
      <path d="M11.3525 5.64688V6.85688H5V5.64688H11.3525Z" fill="currentColor" />
      <path d="M9.5824 8.29376V9.50376H5V8.29376H9.5824Z" fill="currentColor" />
      <path d="M14.6647 15.6852H10.0338C10.3878 15.3751 10.7567 15.0517 11.0772 14.7706C11.2531 14.6164 11.4144 14.4746 11.5511 14.3547H14.6647V15.6852Z" fill="currentColor" />
      <path d="M8.14852 14.1308L7.33925 15.4976C7.22458 15.6912 7.42245 15.9194 7.63037 15.8333L9.09785 15.2254L15.0399 10.0719L14.0905 8.97733L8.14852 14.1308Z" fill="currentColor" />
    </svg>
  )],
  [FULL_ACCESS, (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d={shieldOutline} stroke="currentColor" strokeWidth="1.31831" strokeLinejoin="round" />
      <path d="M9.10094 4.5V8.75939H7.59888V4.5H9.10094Z" fill="currentColor" />
      <path d="M9.10094 9.8114V11.5H7.59888V9.8114H9.10094Z" fill="currentColor" />
    </svg>
  )],
])

/** Glyph for a permission option value; host-configured names outside the design set get none. */
export function permissionGlyph(value: string): ReactNode | undefined {
  return permissionGlyphs.get(value)
}

/**
 * Display transform: built-in machine names render as locale product labels;
 * non-kebab host-configured names pass through.
 */
function displayName(name: string): string {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return name
  return name.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

/** Product label key of one built-in mode. */
type PermissionLabelKey =
  | 'access.preset.readOnly'
  | 'access.preset.workspaceWrite'
  | 'access.preset.fullAccess'

const BUILT_IN_PERMISSION_LABELS = new Map<string, PermissionLabelKey>([
  ['read-only', 'access.preset.readOnly'],
  ['workspace-write', 'access.preset.workspaceWrite'],
  [FULL_ACCESS, 'access.preset.fullAccess'],
])

/**
 * The built-in label key describing a host option, or undefined while the
 * deployment presents that value under a name of its own — a renamed mode's
 * meaning belongs to the deployment, so built-in copy would name behavior it
 * may no longer configure.
 */
function builtInPermissionLabel(value: string, name: string): PermissionLabelKey | undefined {
  const key = BUILT_IN_PERMISSION_LABELS.get(value)
  if (key === undefined) return undefined
  return name === value || name === en[key] ? key : undefined
}

/**
 * Product label of one permission mode.
 * @param value - machine value of the mode.
 * @param name - host-provided name for that value.
 * @param t - Conversation locale seat.
 * @returns the built-in localized label, or the host name when it is the deployment's own.
 */
export function permissionLabel(
  value: string,
  name: string,
  t: ComposerBarProps['t'],
): string {
  const key = builtInPermissionLabel(value, name)
  return key === undefined ? displayName(name) : t(key)
}

export interface PermissionListProps {
  /** Host-computed modes, in the order the popup presents them. */
  options: PermissionSelectValue['options']
  /** The mode a check marks as current, including an optimistic pick. */
  current: string
  disabled: boolean
  /** The owning bar's locale seat, passed down as a plain prop. */
  t: ComposerBarProps['t']
  onSelect: (id: string) => void
}

/**
 * Render the permission mode rows of the composer's Options popup.
 * @param props - the host modes, the current value, and the pick callback.
 * @returns the list of mode rows.
 */
export function PermissionList({ options, current, disabled, t, onSelect }: PermissionListProps) {
  return (
    <>
      {options
        .filter(option => option.value !== 'custom')
        .map((option) => {
          const icon = permissionGlyph(option.value)
          const selected = option.value === current
          const label = permissionLabel(option.value, option.name, t)
          return (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={selected}
              className={clsx(css.item, selected && css.selected)}
              title={option.description}
              disabled={disabled}
              onClick={() => { onSelect(option.value) }}
            >
              {icon !== undefined && <span className={css.itemIcon} aria-hidden>{icon}</span>}
              <span className={css.itemLabel}>{label}</span>
              {/* Selection marker is a trailing check (figma .Menu_cell), not a fill. */}
              {selected && <IconCheckOutline16 className={css.check} />}
            </button>
          )
        })}
    </>
  )
}
