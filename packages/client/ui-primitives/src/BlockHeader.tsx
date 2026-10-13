/** The header of a tool card, drawn like the Markdown engine's table and code toolbars. */
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { IconCopyOutline16 } from './icons/index.tsx'
import { Tooltip } from './Tooltip.tsx'
import { useCopyFeedback } from './use-copy-feedback.ts'
import css from './BlockHeader.module.css'

/** What the header's copy control writes, and how it names itself. */
export interface BlockHeaderCopy {
  /** The text written to the clipboard. An empty text renders no control. */
  readonly text: string
  /** Tooltip and accessible name of the idle control. */
  readonly label: string
  /** Tooltip and accessible name during the post-copy confirmation window. */
  readonly copiedLabel: string
}

/** Props of {@link BlockHeader}. */
export interface BlockHeaderProps {
  /** The card's name, shown at the header's start, as a table shows "Table". */
  readonly title: string
  /** Status shown before the copy control, such as a failed exit code. */
  readonly children?: ReactNode
  /** The copy control; absent renders none. */
  readonly copy?: BlockHeaderCopy | undefined
  readonly className?: string | undefined
}

/**
 * The copy control: the engine's copy glyph as an icon button, with its name
 * in a tooltip rather than as visible text. Shared by every card header.
 * @param props - see {@link BlockHeaderCopy}.
 * @returns the icon button.
 */
export function CopyIconButton({ text, label, copiedLabel }: BlockHeaderCopy) {
  const { copied, onCopy } = useCopyFeedback(text)
  const name = copied ? copiedLabel : label
  return (
    <Tooltip label={name} side="top">
      <button type="button" className={css.iconButton} aria-label={name} onClick={onCopy}>
        <IconCopyOutline16 className={css.icon} />
      </button>
    </Tooltip>
  )
}

/**
 * A tool card's header: the card's name at the start and its controls at the
 * end, at the same height, type, and icon size as a Markdown table's header.
 * @param props - see {@link BlockHeaderProps}.
 * @returns the header row.
 */
export function BlockHeader({ title, children, copy, className }: BlockHeaderProps) {
  return (
    <div className={clsx(css.header, className)}>
      <span className={css.title}>{title}</span>
      <span className={css.spacer} />
      {children}
      {copy !== undefined && copy.text !== '' && <CopyIconButton {...copy} />}
    </div>
  )
}
