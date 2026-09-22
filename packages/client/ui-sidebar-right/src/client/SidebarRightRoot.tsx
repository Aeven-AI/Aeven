/**
 * Right sidebar shell, the left sidebar's mirror: collapse is one CSS state
 * (`.visible`), the column's width lives in the frame, and the shell
 * repositions and remounts nothing.
 *
 * Its one departure from the left is the drag handle, which the frame draws on
 * the column's inner edge. The width that handle writes is per session, so the
 * panel states nothing about its own width here either — it fills whatever the
 * column gives it.
 *
 * The panel holds its own collapse control and nothing else of its chrome:
 * reopening belongs to the header, whose corner stays put whether or not this
 * column has any width.
 */
import clsx from 'clsx'
import type { SidebarRightRootComponentProps } from './contract/slots.ts'
import css from './SidebarRightRoot.module.css'

/**
 * Render the right sidebar column shell.
 * @param props - composed slot props (runtime share + injected callbacks, contract/slots.ts).
 * @returns the right sidebar element tree.
 */
export function SidebarRightRoot({
  collapsed,
  renderSlot,
}: SidebarRightRootComponentProps) {
  return (
    <div className={clsx(css.root, !collapsed && css.visible)}>
      <div className={css.content}>
        {/* Everything below the frame's corner narrows and fades as one body,
            as the left sidebar's `.side-content` does. The panel carries no
            collapse control of its own: the corner's toggle closes it from the
            one place that holds still whether or not this column has width. */}
        <div className={css.sideContent}>
          <div className={css.sideContentInner}>
            {renderSlot('sidebar.right.body', {})}
          </div>
        </div>

        {/* Last inside the content column so it paints under the z-indexed
            button and body above it, as the left sidebar has it. */}
        <div className={css.panel} aria-hidden="true" />
      </div>
    </div>
  )
}
