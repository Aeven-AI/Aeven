/** The handoff: Aeven's standard modal telling the reader which browser step is theirs. */
import { useSyncExternalStore } from 'react'
import { Button, Modal } from '@aeven/client-ui-primitives'
import type { TranslateNS } from '@aeven/client-locale/client'
import { handoffs, type HandoffReason } from './handoff.ts'

/** Title key per reason. */
const TITLE_KEYS: Readonly<Record<HandoffReason, 'handoff.title.authentication' | 'handoff.title.captcha' | 'handoff.title.confirmation' | 'handoff.title.other'>> = {
  authentication: 'handoff.title.authentication',
  captcha: 'handoff.title.captcha',
  confirmation: 'handoff.title.confirmation',
  user_requested: 'handoff.title.other',
  other: 'handoff.title.other',
}

/**
 * The pending handoff of one session.
 * @param props.sessionId - the session whose handoff is shown.
 * @param props.t - the pane's dictionary.
 * @returns the modal, closed when nothing is pending.
 */
export function HandoffModal({ sessionId, t }: { sessionId: string; t: TranslateNS<'sidebarBrowser'> }) {
  const handoff = useSyncExternalStore(handoffs.subscribe, () => handoffs.get(sessionId))
  const decline = (): void => { handoffs.settle(sessionId, false) }
  return (
    <Modal
      open={handoff !== undefined}
      onClose={decline}
      title={handoff === undefined ? '' : t(TITLE_KEYS[handoff.reason])}
      closeLabel={t('handoff.close')}
      description={handoff?.message ?? ''}
      footer={(
        <>
          <Button variant="outline" onClick={decline}>{t('handoff.decline')}</Button>
          <Button variant="primary" onClick={() => { handoffs.settle(sessionId, true) }}>{t('handoff.ok')}</Button>
        </>
      )}
    />
  )
}
