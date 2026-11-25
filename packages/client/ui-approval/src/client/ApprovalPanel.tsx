/** Composer takeover for one pending approval waterfall. */
import { useState, type ReactNode } from 'react'
import { Button } from '@aeven/client-ui-primitives'
import type {
  ApprovalComposerProps, ApprovalDecision, ApprovalOutbound, ApprovalSessionCoverage, PendingApproval,
} from './contract/slots.ts'
import css from './ApprovalPanel.module.css'

const SESSION_NOTES: Record<ApprovalSessionCoverage, 'session' | 'sessionAction' | 'sessionSandbox' | 'sessionPrivilege' | 'sessionSite'> = {
  account: 'session',
  action: 'sessionAction',
  sandbox: 'sessionSandbox',
  privilege: 'sessionPrivilege',
  site: 'sessionSite',
}

/**
 * Render the content a send-like action delivers, in the same labeled lines the
 * correlated-call detail uses for an outbound message.
 * @param outbound - what the action publishes.
 * @param t - approval copy.
 * @returns the labeled publishing input, recipients, subject, and text, or null when the asker read none of them.
 */
function OutboundDetail({ outbound, t }: { outbound: ApprovalOutbound; t: ApprovalComposerProps['t'] }): ReactNode {
  const trigger = outbound.trigger === undefined ? undefined
    : outbound.trigger.kind === 'key' ? t('trigger.key', { key: outbound.trigger.key }) : t('trigger.click', { label: outbound.trigger.label })
  const lines = [
    trigger === undefined ? undefined : [t('trigger'), trigger] as const,
    outbound.to === undefined ? undefined : [t('to'), outbound.to] as const,
    outbound.subject === undefined ? undefined : [t('subject'), outbound.subject] as const,
    outbound.text === undefined ? undefined : [t('message'), outbound.text] as const,
  ].filter(line => line !== undefined)
  if (lines.length === 0) return null
  return <>{lines.map(([label, text]) => <div key={label}><strong>{label}</strong>{'\n'}{text}{'\n\n'}</div>)}</>
}

/**
 * Render one pending approval and its optional Tool-owned detail; a request
 * that carries what it publishes shows that content instead.
 * @param props - selector-matched request and standard Slot props.
 * @returns The approval composer takeover.
 */
export function ApprovalPanel(props: ApprovalComposerProps) {
  const approval = props.matched
  const outbound = approval.outbound === undefined ? null : <OutboundDetail outbound={approval.outbound} t={props.t} />
  const detail = outbound ?? (approval.callId === undefined
    ? null
    : props.renderSlot('conversation.approval.detail', { callId: approval.callId }))
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
    gmail: 'Gmail', 'google-drive': 'Google Drive', 'google-calendar': 'Google Calendar', 'google-tasks': 'Google Tasks', 'google-contacts': 'Google Contacts', 'google-meet': 'Google Meet',
    outlook: 'Outlook', 'outlook-calendar': 'Outlook Calendar', onedrive: 'OneDrive',
    sharepoint: 'SharePoint', teams: 'Microsoft Teams', github: 'GitHub', notion: 'Notion',
    vercel: 'Vercel', atlassian: 'Atlassian', monday: 'Monday', stripe: 'Stripe', salesforce: 'Salesforce', shopify: 'Shopify', 'microsoft-365': 'Microsoft 365',
    cloudflare: 'Cloudflare', aws: 'AWS', supabase: 'Supabase', calendly: 'Calendly', bigquery: 'BigQuery', 'azure-devops': 'Azure DevOps', oracle: 'Oracle Cloud',
  }
  const connectorId = connector?.[1]
  const provider = connectorId === undefined ? undefined : providers[connectorId] ?? connectorId
  const operation = connector?.[3]
  const kind = pending.outbound?.kind
  const headline = kind !== undefined
    ? t(`outbound.${kind}`, { site: pending.outbound?.site ?? t('outbound.anySite') })
    : provider === undefined || operation === undefined
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
        <div className={css.note}>{t(pending.allowSession ? SESSION_NOTES[pending.sessionCoverage] : 'once')}</div>
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
