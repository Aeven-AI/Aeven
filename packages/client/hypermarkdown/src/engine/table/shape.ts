import React, {
  type ReactElement,
  type ReactNode,
} from 'react'

/**
 * What the rendered table's children say about its shape, latched so the table
 * keeps one look while the rest of it streams in.
 */
export interface TableShape {
  /** No header cell has content, so the header row is hidden by CSS. */
  headless: boolean
  /** Widest header seen so far, used for the column-count style hooks. */
  headerColumns: number
}

interface TableElementProps {
  children?: ReactNode
}

/**
 * Reads the shape of the rendered table out of its children.
 *
 * A streaming table arrives one row at a time, so both answers wobble before
 * they settle: the header looks empty until its first cell lands, and the
 * column count grows as cells appear. Each is latched once it can no longer
 * change, so the table never re-styles itself mid-stream.
 */
/**
 * A settled-latch ref cell.
 *
 * Written structurally rather than as React's `RefObject`: React 18 types
 * that as a readonly `current`, React 19 as a mutable one, and both satisfy
 * this. `useRef<boolean>(false)` is assignable under either.
 */
interface MutableLatch {
  current: boolean
}

/**
 * Reads the shape of the rendered table out of its children.
 *
 * Call this on every render of a streaming table: it updates `shape` in place
 * only for as long as either answer can still change, and marks the matching
 * latch as settled the moment it cannot. A headless header stays headless once
 * enough body rows have arrived, and the widest header seen wins, so the two
 * style hooks the table renders from never flicker mid-stream.
 * @param children - the table element's React children.
 * @param shape - the running shape, updated in place with what this pass found.
 * @param headlessSettled - latch set once the headless answer is final.
 * @param columnsSettled - latch set once the column count is final.
 */
export function readTableShape(
  children: ReactNode,
  shape: TableShape,
  headlessSettled: MutableLatch,
  columnsSettled: MutableLatch,
): void {
  if (headlessSettled.current &&  columnsSettled.current) {
    return
  }

  let headless = true
  let headerColumns = 0
  let bodyRows = 0

  // A header with no rows is a single child, and a one-column header row a
  // single cell. React hands those over unwrapped, so counting by .length
  // silently skips the table and leaves it looking headless.
  const tableChildren = React.Children.toArray(children).filter(isTableElement)

  for (let i = 0, iCount = tableChildren.length; i < iCount; i++) {
    const child = tableChildren[i]!

    if (child.type === 'thead') {
      const headRow = React.Children.toArray(child.props.children).find(
        isTableElement,
      )

      const headCells = headRow
        ? React.Children.toArray(headRow.props.children).filter(isTableElement)
        : []

      for (let j = 0, jCount = headCells.length; j < jCount; j++) {
        const cell = headCells[j]!

        if (cell.type === 'th') {
          headerColumns++

          if (cell.props.children) {
            headless = false
          }
        }
      }
    }

    if (child.type === 'tbody') {
      // Only whether there are more than a couple matters; toArray() over
      // every row of a long table on every chunk is what made this quadratic.
      bodyRows = React.Children.count(child.props.children)
    }
  }

  // Both answers are monotonic. A header cell that has gained content never
  // loses it, so the moment one does, both answers are final and there is no
  // reason to look again.
  if (!headless) {
    shape.headless = false
    shape.headerColumns = headerColumns

    headlessSettled.current = true
    columnsSettled.current = true
    return
  }

  shape.headless = true

  if (headerColumns >= shape.headerColumns) {
    shape.headerColumns = headerColumns
  }

  // Past a couple of body rows a header can no longer turn up, so a table
  // still looking headless here is headless for good. Without this the
  // latches never close and every chunk re-walks the whole table.
  if (bodyRows > 2) {
    headlessSettled.current = true
    columnsSettled.current = true
  }

  function isTableElement(
    node: ReactNode,
  ): node is ReactElement<TableElementProps> {
    return React.isValidElement<TableElementProps>(node)
  }
}
