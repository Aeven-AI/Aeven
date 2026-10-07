/** Composer takeover for one pending approval waterfall. */
import { useState, type ReactNode } from 'react'
import { Button } from '@aeven/client-ui-primitives'
import type { ApprovalComposerProps, ApprovalDecision, PendingApproval } from './contract/slots.ts'
import css from './ApprovalPanel.module.css'

/**
 * Render one pending approval and its optional Tool-owned detail.
 * @param props - selector-matched request and standard Slot props.
 * @returns The approval composer takeover.
 */
export function ApprovalPanel(props: ApprovalComposerProps) {
  const approval = props.matched
  const detail = approval.callId === undefined
    ? null
    : props.renderSlot('conversation.approval.detail', { callId: approval.callId })
  return <ApprovalFlow key={approval.key} pending={approval} detail={detail} t={props.t} />
}

function ApprovalFlow({ pending, detail, t }: {
  pending: PendingApproval
  detail: ReactNode
  t: ApprovalComposerProps['t']
}) {
  const [answered, setAnswered] = useState(false)
  const answer = (outcome: ApprovalDecision): void => {
    setAnswered(true)
    void pending.answer(outcome).catch(() => { setAnswered(false) })
  }
  const connector = /^mcp__([a-z-]+)_([a-f0-9]{8})__(.+)$/.exec(pending.toolName)
  const providers: Record<string, string> = {
    whatsapp: 'WhatsApp', telegram: 'Telegram', discord: 'Discord', slack: 'Slack',
    gmail: 'Gmail', 'google-drive': 'Google Drive', 'google-calendar': 'Google Calendar',
    outlook: 'Outlook', 'outlook-calendar': 'Outlook Calendar', onedrive: 'OneDrive',
    sharepoint: 'SharePoint', teams: 'Microsoft Teams',
  }
  const provider = connector === null ? undefined : providers[connector[1]!] ?? connector[1]
  const operation = connector?.[3]
  const headline = provider === undefined || operation === undefined
    ? pending.reason ?? t('escalation', { toolName: pending.toolName })
    : /(?:send|post|reply).*?(?:message|draft)|chat_postMessage/i.test(operation)
      ? t('send', { provider })
      : t('action', { provider, operation: operation.replaceAll('_', ' ') })
  return (
    <div className={css.root} data-approval-key={pending.key}>
      <div className={css.card}>
        <div className={css.header}>
          <div className={css.eyebrow}>{t('waiting')}</div>
          <div className={css.headline}>
            {headline}
          </div>
        </div>
        <div
          className={`${css.body} no-scrollbar`}
          data-approval-scroll=""
          tabIndex={0}
          role="group"
          aria-label={t('detail.aria')}
        >
          {detail !== null && <div className={css.command}>{detail}</div>}
        </div>
        <div className={css.note}>{t(pending.allowSession ? 'session' : 'once')}</div>
        <div className={css.actionRow}>
          <Button
            variant="outline" className={`${css.reject} ${css.action}`}
            disabled={answered} onClick={() => { answer('rejected') }}
          >
            {t('reject')}
          </Button>
          {pending.allowSession && <Button
            variant="outline" className={css.action}
            disabled={answered} onClick={() => { answer('allowed-session') }}
          >
            {t('allowSession')}
          </Button>}
          <Button
            variant="primary" className={css.action}
            disabled={answered} onClick={() => { answer('allowed-once') }}
          >
            {t('allowOnce')}
          </Button>
        </div>
      </div>
    </div>
  )
}
