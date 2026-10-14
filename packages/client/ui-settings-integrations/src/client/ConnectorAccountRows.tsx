/** The account list every connector page draws its own rows inside. */

import type { ReactNode } from 'react'
import type { Connection } from './connector-page.ts'
import css from './IntegrationsSection.module.css'

/** Props of the shared account list. */
export interface ConnectorAccountRowsProps {
  connections: readonly Connection[]
  /** Draw one account's row content; the list supplies the row element and its React key. */
  row: (connection: Connection) => ReactNode
}

/**
 * Render one row per connector account.
 * @param props - the accounts to list and the page's own row content.
 * @returns the list element holding the page's rows.
 */
export function ConnectorAccountRows({ connections, row }: ConnectorAccountRowsProps): ReactNode {
  return <div className={css.serverList}>{connections.map(connection =>
    <div key={connection.id} className={css.serverRow}>{row(connection)}</div>)}</div>
}
