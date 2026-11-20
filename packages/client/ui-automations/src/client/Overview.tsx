/** The bot overview at /b: one card per bot, then boards; ideas only while the account has no bot. */
import type { ReactNode } from 'react'
import { Button, IconBotFaceLooping, IconChevronRightOutline14, IconTrashOutline16, Tooltip } from '@aeven/client-ui-primitives'
import type { Formatters, Translate } from './format.ts'
import { HANDOFF_STATUS } from './format.ts'
import type { AutomationList, Task } from './model.ts'
import { BotMenu, Facts, followLink, PauseControl, RunControl, StatusPill, useNarrowCards } from './shared.tsx'
import type { Automations } from './useAutomations.ts'
import css from './AutomationsPanel.module.css'

/** Address of one bot's page. */
export const botPath = (id: string): string => `/bots/${id}`

/**
 * One bot's card in the original card layout: its summary links to the bot's page, and the actions row runs or
 * pauses it in place.
 * @param props - the bot, the list it came from, and the card's actions.
 * @returns the card.
 */
function BotCard({ t, fmt, task, data, state, showBot, editBot }: {
  t: Translate
  fmt: Formatters
  task: Task
  data: AutomationList
  state: Automations
  showBot: (id: string) => void
  editBot: (id: string) => void
}) {
  const current = data.runs.find(run => run.definition.id === task.id && (run.status === 'queued' || run.status === 'running'))
  return (
    <article className={css.card}>
      <a className={css.toggle} href={botPath(task.id)} onClick={(event) => { followLink(event, () => { showBot(task.id) }) }}>
        <span className={css.heading}>
          <span className={css.title}>
            {task.name}
            <span className={css.disc} aria-hidden="true"><IconChevronRightOutline14 /></span>
          </span>
          {task.triggers.map((trigger, index) => <span className={css.schedule} key={index}>{fmt.describeTrigger(trigger)}</span>)}
        </span>
        <Facts t={t} fmt={fmt} task={task} />
      </a>
      <div className={css.cardActions}>
        <RunControl t={t} task={task} current={current} state={state} />
        <PauseControl t={t} task={task} state={state} />
        <BotMenu t={t} task={task} state={state} edit={editBot} />
        <StatusPill t={t} task={task} current={current} state={state} />
      </div>
    </article>
  )
}

/**
 * The overview's bot cards and boards.
 * @param props - the list, the shared state, and navigation.
 * @returns the overview body below the view switcher.
 */
export function Overview({ t, fmt, data, state, showBot, editBot, startBoard, ideas }: {
  t: Translate
  fmt: Formatters
  data: AutomationList
  state: Automations
  showBot: (id: string) => void
  /** Open a bot's page with the caret in its composer. */
  editBot: (id: string) => void
  /** Send the board starter to the conversation. */
  startBoard: () => void
  /** The idea gallery, below the bots and boards. */
  ideas: ReactNode
}) {
  const cards = useNarrowCards(data)
  if (data.definitions.length === 0) {
    return (
      <>
        <div className={css.empty}>
          <IconBotFaceLooping className={css.emptyIcon} />
          <h3 className={css.emptyTitle}>{t('empty')}</h3>
          <p className={css.emptyText}>{t('emptyDetail')}</p>
        </div>
        {ideas}
      </>
    )
  }
  return (
    <>
      <div className={css.list} ref={cards}>
        {data.definitions.map(task => (
          <BotCard key={task.id} t={t} fmt={fmt} task={task} data={data} state={state} showBot={showBot} editBot={editBot} />
        ))}
      </div>
      {data.boards !== undefined && data.definitions.length > 1 && (
        <>
          <div className={css.bar}>
            <h2 className={css.sectionTitle}>{t('boardsTitle')}</h2>
            <Button variant="ghost" size="sm" disabled={state.unavailable} onClick={startBoard}>{t('boardNew')}</Button>
          </div>
          {data.boards.length === 0 && <p className={css.triggerText}>{t('boardsDetail')}</p>}
          <div className={css.list}>
            {data.boards.map((board) => {
              const chain = (data.handoffs ?? []).filter(handoff => handoff.board === board.id)
              const names = board.members.map(member => data.definitions.find(task => task.id === member)?.name ?? t('triggerRemovedBot'))
              const budget = [
                board.budget.maxConcurrentRuns === undefined ? '' : t('boardBudgetRuns', { n: String(board.budget.maxConcurrentRuns) }),
                board.budget.maxTokensPerDay === undefined ? '' : t('boardBudgetTokens', { n: fmt.number(board.budget.maxTokensPerDay) }),
              ].filter(part => part !== '')
              return (
                <article className={css.card} key={board.id}>
                  <div className={css.details}>
                    <span className={css.title}>{board.name}</span>
                    <div className={css.triggerRow}>
                      <span className={css.triggerLabel}>{t('boardMembers')}</span>
                      <span className={css.triggerValue}>{names.join(', ')}</span>
                    </div>
                    <div className={css.triggerRow}>
                      <span className={css.triggerLabel}>{t('boardBudget')}</span>
                      <span className={css.triggerValue}>{budget.length === 0 ? t('boardBudgetNone') : budget.join(', ')}</span>
                    </div>
                  </div>
                  <h3 className={css.detailTitle}>{t('boardChain')}</h3>
                  {chain.length === 0 ? <p className={css.triggerText}>{t('boardChainEmpty')}</p> : (
                    <ul className={css.runList}>
                      {chain.map(handoff => (
                        <li className={css.run} key={handoff.id}>
                          <span className={css.runOpen} title={handoff.reason ?? handoff.task}>
                            <span className={css.runText}>
                              <span className={css.runTitle}>{`${handoff.fromName} → ${handoff.toName}`}</span>
                              <span className={css.runSubtitle}>
                                {`${t(HANDOFF_STATUS[handoff.status])} · ${fmt.date(handoff.createdAt)}`}
                                {handoff.tokens !== null && handoff.tokens > 0 ? ` · ${t('tokens', { n: fmt.number(handoff.tokens) })}` : ''}
                                {handoff.reason !== null && (handoff.status === 'refused' || handoff.status === 'released') ? ` · ${handoff.reason}` : ''}
                              </span>
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className={css.cardActions}>
                    <Tooltip label={t('boardRemove')} side="top" anchor="icon">
                      <span className={css.tip}>
                        <Button
                          variant="ghost" size="sm" className={`${css.action} ${css.iconAction}`} icon={<IconTrashOutline16 />}
                          aria-label={t('boardRemove')} disabled={state.unavailable}
                          onClick={() => { state.setPending({ kind: 'board-remove', id: board.id }) }}
                        />
                      </span>
                    </Tooltip>
                  </div>
                </article>
              )
            })}
          </div>
        </>
      )}
      {ideas}
    </>
  )
}
