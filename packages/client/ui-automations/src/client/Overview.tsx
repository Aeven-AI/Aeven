/** The bot overview at /bots: one card per bot, then the boards with their starter tile, then the ideas. */
import type { ReactNode } from 'react'
import {
  Button, IconBotFaceLooping, IconChevronRightOutline14, IconLucideCheck, IconLucideClock, IconLucideMinus, IconLucideX,
  IconTrashOutline16, Spinner, Tooltip,
} from '@aeven/client-ui-primitives'
import type { Formatters, Translate } from './format.ts'
import { HANDOFF_STATUS } from './format.ts'
import { IconSquareKanban } from './icons.tsx'
import type { AutomationList, Board, HandoffRecord, Task } from './model.ts'
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

/** Most handoffs a board card lists, newest first. */
const BOARD_HANDOFFS = 5

/**
 * Neutral status glyph for a handoff, in the run rows' trailing circle.
 * @param status - handoff status.
 * @returns the glyph.
 */
function handoffIcon(status: HandoffRecord['status']): ReactNode {
  switch (status) {
    case 'open': return <IconLucideClock />
    case 'claimed': return <Spinner />
    case 'done': return <IconLucideCheck />
    case 'failed': return <IconLucideX />
    case 'released':
    case 'refused': return <IconLucideMinus />
  }
}

/**
 * One board's card, laid out like a bot card: its name with its bots under it, the facts grid, its latest handoffs as
 * run rows, and the actions row.
 * @param props - the board, the list it came from, and the shared operations.
 * @returns the card.
 */
function BoardCard({ t, fmt, board, data, state }: {
  t: Translate
  fmt: Formatters
  board: Board
  data: AutomationList
  state: Automations
}) {
  const chain = (data.handoffs ?? []).filter(handoff => handoff.board === board.id)
  const names = board.members.map(member => data.definitions.find(task => task.id === member)?.name ?? t('triggerRemovedBot'))
  const budget = [
    board.budget.maxConcurrentRuns === undefined ? '' : t('boardBudgetRuns', { n: String(board.budget.maxConcurrentRuns) }),
    board.budget.maxTokensPerDay === undefined ? '' : t('boardBudgetTokens', { n: fmt.number(board.budget.maxTokensPerDay) }),
  ].filter(part => part !== '')
  return (
    <article className={css.card}>
      <div className={css.boardSummary}>
        <span className={css.heading}>
          <span className={css.title}>{board.name}</span>
          <span className={css.schedule}>{names.join(' · ')}</span>
        </span>
        <span className={css.facts}>
          <span className={css.fact}>
            <span className={css.factLabel}>{t('boardChain')}</span>
            <span className={css.factValue}>
              {chain.length === 0 ? t('boardChainEmpty') : fmt.number(chain.length)}
            </span>
          </span>
          <span className={css.fact}>
            <span className={css.factLabel}>{t('boardBudget')}</span>
            <span className={css.factValue}>{budget.length === 0 ? t('boardBudgetNone') : budget.join(', ')}</span>
          </span>
        </span>
      </div>
      {chain.length > 0 && (
        <ul className={`${css.runList} ${css.boardHandoffs}`}>
          {chain.slice(0, BOARD_HANDOFFS).map(handoff => (
            <li className={css.run} key={handoff.id} title={handoff.reason ?? handoff.task}>
              <span className={css.runText}>
                <span className={css.runTitle}>{`${handoff.fromName} → ${handoff.toName}`}</span>
                <span className={css.runSubtitle}>
                  {`${t(HANDOFF_STATUS[handoff.status])} · ${fmt.date(handoff.createdAt)}`}
                  {handoff.tokens !== null && handoff.tokens > 0 ? ` · ${t('tokens', { n: fmt.number(handoff.tokens) })}` : ''}
                  {handoff.reason !== null && (handoff.status === 'refused' || handoff.status === 'released') ? ` · ${handoff.reason}` : ''}
                </span>
              </span>
              <span className={css.runIcon} aria-label={t(HANDOFF_STATUS[handoff.status])}>{handoffIcon(handoff.status)}</span>
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
  const boardCards = useNarrowCards(data)
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
          <h2 className={css.sectionTitle}>{t('boardsTitle')}</h2>
          {data.boards.length > 0 && (
            <div className={css.list} ref={boardCards}>
              {data.boards.map(board => (
                <BoardCard key={board.id} t={t} fmt={fmt} board={board} data={data} state={state} />
              ))}
            </div>
          )}
          <button type="button" className={`${css.forYou} ${css.boardStarter}`} disabled={state.unavailable} onClick={startBoard}>
            <span className={css.templateIcon}><IconSquareKanban /></span>
            <span className={css.templateText}>
              <span className={css.templateTitle}>{t('boardNew')}</span>
              <span className={css.templateDescription}>{t('boardsDetail')}</span>
            </span>
          </button>
        </>
      )}
      {ideas}
    </>
  )
}
