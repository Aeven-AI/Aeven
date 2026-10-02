/**
 * Shared inline styles using AVN design tokens. Card, header, body, footer,
 * and button values copy the Plugins card (`PluginCard.module.css`) so the
 * provider cards read as the same component family. Every text style is
 * 14px or larger.
 */

import type { CSSProperties } from 'react'

/** Usage meter fills by how much of a window is spent. Info fill stands in for brand-primary, which dark theme inverts to near-white. */
export const METER_FILL = {
  critical: 'var(--dsw-alias-state-error-primary, #d92d20)',
  warning: 'var(--dsw-alias-state-warn-primary, #e06c00)',
  normal: 'var(--dsw-alias-button-info-fill, var(--dsw-static-deepseek-500, #4f6ef7))',
} as const
/** Unfilled part of every usage meter. */
export const METER_TRACK = 'var(--dsw-alias-border-l2)'
/** Per-product segments of a pooled allowance, strongest first; a product past the last reuses it. */
export const PRODUCT_FILLS: readonly string[] = [
  METER_FILL.normal,
  `color-mix(in srgb, ${METER_FILL.normal} 60%, transparent)`,
  `color-mix(in srgb, ${METER_FILL.normal} 30%, transparent)`,
]

/** Page style of the hub-owned summary. */
export const pageStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  width: '100%',
  maxWidth: 760,
  minWidth: 0,
}
/** Title of the hub-owned summary. */
export const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 18,
  lineHeight: '26px',
  fontWeight: 600,
  color: 'var(--dsw-alias-label-primary)',
}
/** Body copy. */
export const bodyStyle: CSSProperties = {
  margin: 0,
  fontSize: 14,
  lineHeight: 1.5,
  color: 'var(--dsw-alias-label-tertiary)',
}
/** Secondary copy such as timestamps; the same size as body copy. */
export const hintStyle: CSSProperties = bodyStyle
/** Error copy. */
export const errorStyle: CSSProperties = { ...bodyStyle, color: 'var(--dsw-alias-label-error)' }
/** Link style. */
export const linkStyle: CSSProperties = { fontSize: 14, color: 'var(--dsw-alias-brand-primary)', wordBreak: 'break-all' }
/** A device code to type on the provider's page. */
export const codeStyle: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: 20,
  letterSpacing: '0.08em',
  fontWeight: 600,
  color: 'var(--dsw-alias-label-primary)',
}
/** A block title inside an open card, such as Usage or Models. */
export const sectionTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 14,
  lineHeight: '20px',
  fontWeight: 500,
  color: 'var(--dsw-alias-label-primary)',
}

const buttonBase: CSSProperties = {
  appearance: 'none',
  border: '1px solid transparent',
  borderRadius: 8,
  padding: '5px 14px',
  font: 'inherit',
  fontSize: 14,
  lineHeight: 1.5,
  cursor: 'pointer',
}
/** The Plugins card's Discard button. */
export const secondaryButtonStyle: CSSProperties = {
  ...buttonBase,
  borderColor: 'var(--dsw-alias-border-l2)',
  background: 'none',
  color: 'var(--dsw-alias-label-secondary)',
}
/** Generic button, used outside the cards. */
export const buttonStyle: CSSProperties = secondaryButtonStyle
/** The Plugins card's Save button. */
export const primaryButtonStyle: CSSProperties = {
  ...buttonBase,
  background: 'var(--dsw-alias-label-primary)',
  color: 'var(--dsw-alias-bg-layer-3)',
}
/** A confirmed destructive action, such as signing out. */
export const dangerButtonStyle: CSSProperties = {
  ...buttonBase,
  background: 'var(--dsw-alias-state-error-primary)',
  color: 'var(--dsw-alias-bg-layer-3)',
}
/** Small inline action such as Copy. */
export const compactButtonStyle: CSSProperties = secondaryButtonStyle
/** Borderless text action, such as Select all. */
export const textButtonStyle: CSSProperties = {
  appearance: 'none',
  border: 0,
  padding: 0,
  background: 'none',
  font: 'inherit',
  fontSize: 14,
  lineHeight: '20px',
  color: 'var(--dsw-alias-label-secondary)',
  cursor: 'pointer',
}

/** The card list, spaced like the Plugins card list. */
export const cardListStyle: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
}

/**
 * One provider card; an open card reads as the one being worked on.
 * @param open - whether the card is disclosed.
 * @returns the card's inline style.
 */
export function foldoutStyle(open: boolean): CSSProperties {
  return {
    listStyle: 'none',
    borderWidth: 0.5,
    borderStyle: 'solid',
    borderColor: open ? 'var(--dsw-alias-label-dimmed)' : 'var(--dsw-alias-border-l4)',
    borderRadius: 16,
    background: open ? 'var(--dsw-alias-bg-layer-2)' : 'var(--dsw-alias-bg-layer-3)',
    transition: 'border-color 0.16s, background 0.16s',
  }
}
/** The card header: the whole row is the disclosure control. */
export const cardHeaderStyle: CSSProperties = {
  width: '100%',
  appearance: 'none',
  border: 0,
  background: 'none',
  font: 'inherit',
  color: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '14px 16px',
  borderRadius: 12,
}
/** Provider name on the card header. */
export const cardNameStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 500,
  lineHeight: 1.4,
  color: 'var(--dsw-alias-label-primary)',
}
/** The line under the provider name. */
export const cardDescriptionStyle: CSSProperties = {
  fontSize: 14,
  lineHeight: 1.5,
  color: 'var(--dsw-alias-label-tertiary)',
}
/** Sign-in state on the card header. */
export const statusLabelStyle: CSSProperties = {
  flex: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 14,
  lineHeight: '20px',
  color: 'var(--dsw-alias-label-secondary)',
  whiteSpace: 'nowrap',
}
/** Disclosed content, ruled off from the header. */
export const cardBodyStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
  margin: '0 16px',
  paddingTop: 14,
  paddingBottom: 8,
  borderTop: '0.5px solid var(--dsw-alias-border-l2)',
}
/** Card actions, right-aligned at the foot of the card. */
export const cardFooterStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 8,
  padding: '12px 0 4px',
  borderTop: '0.5px solid var(--dsw-alias-border-l2)',
}
/**
 * Disclosure chevron; it turns half a revolution while its card is open.
 * @param open - whether the card it belongs to is open.
 * @returns the chevron wrapper's inline style.
 */
export function chevronStyle(open: boolean): CSSProperties {
  return {
    flex: 'none',
    display: 'inline-flex',
    color: 'var(--dsw-alias-label-tertiary)',
    transition: 'transform 0.16s',
    transform: open ? 'rotate(180deg)' : 'none',
  }
}
