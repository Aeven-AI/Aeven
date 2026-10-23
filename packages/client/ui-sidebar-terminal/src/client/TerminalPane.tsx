/**
 * One Terminal surface: the shell a pill owns, rendered by xterm.js.
 *
 * The shell lives on the Host (api-terminal-controller) and outlives this
 * pane: switching sessions only detaches the view, closing the pill closes the
 * shell (index.ts). The pill carries the shell's title. A pill that must start
 * a shell with none remembered stops at the launch guide and asks.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { ClientTerminals, TerminalView, TerminalViewState } from '@aeven/api-terminal-controller/client'
import type { WebTerminalId } from '@aeven/api-terminal-controller/types'
import { Button, IconLucidePlus, IconTerminalMark } from '@aeven/client-ui-primitives'
import type { SidebarContentPaneProps } from '@aeven/client-ui-sidebar-select/client'
import type { TranslateNS } from '@aeven/client-ui-slots'
import type { ThemeSnapshot } from '@aeven/client-ui-theme/client'
import type { SessionId } from '@aeven/session/types'
import '@xterm/xterm/css/xterm.css'
import css from './terminal.module.css'
import { TerminalTheme } from './terminal-theme.ts'
import { observeTerminalCursor } from './terminal-cursor.ts'

/** The terminal's glyph size as a fraction of the reader's base: 13px at 16px. */
const TERMINAL_TYPE_RATIO = 13 / 16

/** The live theme, read by the screen to recolour itself. */
export interface ThemeSource {
  readonly getSnapshot: () => ThemeSnapshot
  readonly subscribe: (listener: () => void) => () => void
}

/** Which terminal pills are open, so the Host keeps their shells alive. */
export interface TerminalHolds {
  /**
   * Hold one pill's shell while its pane is mounted.
   * @param sessionId - the pill's session.
   * @param surfaceId - the pill.
   * @returns release of the hold.
   */
  hold(sessionId: SessionId, surfaceId: string): () => void
}

/** What the plugin hands every Terminal pane beyond the column's props. */
export interface TerminalPaneProps extends SidebarContentPaneProps {
  readonly t: TranslateNS<'sidebarTerminal'>
  readonly terminals: ClientTerminals
  readonly theme: ThemeSource
  readonly holds: TerminalHolds
  /**
   * Take the shell the model opened for this session's next new pill.
   * @param sessionId - the pill's session.
   * @returns that shell's Host identity, or undefined when the model opened none.
   */
  readonly adopt: (sessionId: SessionId) => WebTerminalId | undefined
}

/**
 * Render one Terminal surface.
 * @param props - the column's pane props plus the plugin's copy and services.
 * @returns the terminal element tree.
 */
export function TerminalPane({ sessionId, surfaceId, active, setTab, t, terminals, theme, holds, adopt }: TerminalPaneProps): ReactNode {
  const session = sessionId as SessionId
  // Bumped by "New terminal", which closes this pill's shell and binds a fresh one.
  const [generation, setGeneration] = useState(0)
  // A pill bound to no shell yet takes the one the model opened for it; a pill renewed with "New terminal" starts its own.
  const model = useMemo(() => terminals.view(session, surfaceId, surfaceId,
    generation === 0 && !terminals.bound(session, surfaceId) ? adopt(session) : undefined),
  [terminals, session, surfaceId, generation, adopt])
  useEffect(() => holds.hold(session, surfaceId), [holds, session, surfaceId])
  const state = useSyncExternalStore(listener => model.state.subscribe(listener), () => model.state.getSnapshot())
  const themeSnapshot = useSyncExternalStore(theme.subscribe, theme.getSnapshot)
  useEffect(() => model.mount(), [model])
  useEffect(() => {
    setTab(state.title === undefined ? undefined : { title: state.title })
  }, [setTab, state.title])
  useEffect(() => () => { setTab(undefined) }, [setTab])

  const shells = state.shells ?? []
  const renew = (): void => {
    terminals.close(session, surfaceId, surfaceId)
    setGeneration(value => value + 1)
  }
  const newTerminal = (
    <Button variant="primary" size="sm" icon={<IconLucidePlus />} onClick={renew}>{t('new')}</Button>
  )

  // Every shell this pane starts passes the guide: the shells are the pane's own
  // launcher rows, so starting a terminal reads like opening a Browser or Files
  // surface, and the pick decides this shell only.
  if (state.choosingShell === true) {
    return (
      <section className={css.root} data-sidebar-terminal="" data-choosing="">
        <div className={css.shells} role="group" aria-label={t('shell')}>
          {shells.length === 0
            ? <p className={css.shellNote} role="status">{t('shellLoading')}</p>
            : shells.map(shell => (
              <button
                key={shell.path}
                type="button"
                className={css.shell}
                title={shell.path}
                onClick={() => { model.chooseShell(shell.path) }}
              >
                <span className={css.shellGlyph}><IconTerminalMark /></span>
                <span className={css.shellLabel}>{shell.name}</span>
              </button>
            ))}
        </div>
      </section>
    )
  }

  if (state.issue === 'missingTerminal') {
    return (
      <section className={css.root} data-sidebar-terminal="">
        <div className={css.empty}>
          <p className={css.emptyMessage} role="alert">{t('missingTerminal')}</p>
          {newTerminal}
        </div>
      </section>
    )
  }
  const error = state.phase === 'disconnected' ? undefined : state.issue === undefined ? state.error ?? state.info?.error : t(state.issue)
  // Loading, starting and connecting pass in well under a second; the grey
  // pane and the screen's fade-in stand for them instead of a status line.
  let status: string | undefined
  if (state.phase === 'disconnected') status = t(state.phase)
  else if (state.info?.state === 'exited') status = t('exited', { code: String(state.info.exitCode ?? '—') })
  else if (state.info?.state === 'failed') status = t('unavailable')
  else if (state.phase === 'closed') status = t('closed')
  const ended = state.info?.state === 'exited' || state.phase === 'closed'
  const retry = !ended && (state.phase === 'failed' || state.phase === 'disconnected')
  const readOnly = state.phase === 'connected' && state.info?.state === 'running' && !state.writable
  return (
    <section className={css.root} data-sidebar-terminal="">
      {(status !== undefined || retry || readOnly) && (
        <div className={css.status} role="status">
          {status}
          {readOnly && <>{t('readonly')} <Button variant="outline" size="sm" onClick={() => { model.connect() }}>{t('control')}</Button></>}
          {retry && (state.info === undefined
            ? <Button variant="outline" size="sm" onClick={() => { void model.refresh() }}>{t(state.phase === 'disconnected' ? 'reconnect' : 'retry')}</Button>
            : <Button variant="outline" size="sm" onClick={() => { model.connect() }}>{t('reconnect')}</Button>)}
          {ended && newTerminal}
        </div>
      )}
      {state.info !== undefined && <TerminalScreen state={state} model={model} visible={active} label={t('title')} theme={themeSnapshot} />}
      {error !== undefined && <p className={css.error} role="alert">{t('failed', { message: error })}</p>}
    </section>
  )
}

/* oxlint-disable typescript/no-non-null-assertion -- React sets the DOM ref, then these effects initialize and use the emulator. */
function TerminalScreen({ state, model, visible, label, theme }: {
  state: TerminalViewState
  model: TerminalView
  visible: boolean
  label: string
  theme: ThemeSnapshot
}): ReactNode {
  const element = useRef<HTMLDivElement>(null)
  const terminal = useRef<Terminal>()
  const fit = useRef<FitAddon>()
  const colors = useRef<TerminalTheme>()
  /** The grid this pane's box fits: the widest grid the screen may draw. */
  const grid = useRef<Grid>()
  const lastRevision = useRef(0)
  const [ready, setReady] = useState(false)
  const current = useRef({ state, visible })
  current.current = { state, visible }

  /**
   * Fit the screen to this pane's box, remembering the grid it fits.
   * A box that cannot be measured yet — a hidden pill, an unknown environment,
   * cell metrics before the emulator's first refresh — reports false so the
   * caller tries again instead of leaving the shell's wider grid drawn.
   * @returns whether the pane's box could be measured.
   */
  const fitNow = useCallback((): boolean => {
    const xterm = terminal.current
    const addon = fit.current
    const node = element.current
    const shown = current.current
    if (!shown.visible || xterm === undefined || addon === undefined || node === null) return false
    const fitted = fitScreen(xterm, addon, node, shown.state, model)
    if (fitted === undefined) return false
    grid.current = fitted
    return true
  }, [model])

  useLayoutEffect(() => {
    const node = element.current!
    const xterm = new Terminal({
      minimumContrastRatio: 4.5,
      cursorBlink: true,
      // The emulator measures glyphs in whole pixels of its own, so its size is
      // derived from the reader's base rather than stated against it: 13px at the
      // 16px default, and the same fraction of any other base.
      fontSize: Math.round(theme.fontSize * TERMINAL_TYPE_RATIO),
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      scrollback: current.current.state.environment?.scrollback ?? 0,
    })
    const addon = new FitAddon()
    xterm.loadAddon(addon)
    xterm.open(node)
    const palette = new TerminalTheme(xterm)
    colors.current = palette
    const cursor = observeTerminalCursor(xterm, node, () => palette.cursor)
    xterm.textarea?.setAttribute('aria-label', label)
    terminal.current = xterm
    fit.current = addon
    lastRevision.current = 0
    const input = xterm.onData((data) => { model.write(data) })
    // A fresh emulator reports the cell metrics a fit needs only with its first
    // refresh, so the attempt made when this screen appears can precede a
    // measurable box: each render retries until one lands, the observer covers
    // every later size, and the deferred attempt covers a refresh already run.
    const settled = xterm.onRender(() => { if (grid.current === undefined) fitNow() })
    const deferred = requestAnimationFrame(() => { if (grid.current === undefined) fitNow() })
    const observer = new ResizeObserver(() => { grid.current = undefined; fitNow() })
    observer.observe(node)
    return () => {
      cancelAnimationFrame(deferred)
      observer.disconnect()
      settled.dispose()
      input.dispose()
      cursor.dispose()
      palette.dispose()
      xterm.dispose()
      terminal.current = undefined
      fit.current = undefined
      grid.current = undefined
    }
  }, [model, fitNow])

  useLayoutEffect(() => {
    const style = getComputedStyle(element.current!)
    colors.current!.update(style.backgroundColor, style.color)
  }, [theme, model])

  useLayoutEffect(() => {
    const xterm = terminal.current!
    const render = state.render
    if (render === undefined || render.revision <= lastRevision.current) return
    lastRevision.current = render.revision
    if (render.frame.type === 'snapshot') {
      xterm.reset()
      // The screen behind a snapshot carries the shell's own grid, which can be
      // wider than this pane; only the grid the box fits may be drawn, and the
      // shell's dimensions stand in until a fit has landed.
      const fitted = grid.current
      xterm.resize(fitted?.cols ?? render.frame.info.cols, fitted?.rows ?? render.frame.info.rows)
    }
    xterm.write(render.frame.type === 'snapshot' ? render.frame.screen : render.frame.data, () => {
      model.acknowledge(render.revision)
      setReady(true)
    })
  }, [state.render, model])

  useLayoutEffect(() => {
    terminal.current!.options.disableStdin = !state.writable
    // Every change that can move the box or unblock a fit fits again, so a pane
    // that lost input control keeps its own width instead of the shell's.
    fitNow()
  }, [visible, state.writable, state.environment, state.info?.cols, state.info?.rows, model, fitNow])
  useEffect(() => {
    terminal.current!.textarea?.setAttribute('aria-label', label)
  }, [label])
  useEffect(() => { if (visible && state.writable) terminal.current!.focus() }, [visible, state.writable])
  return <div className={css.screen} ref={element} data-ready={ready || undefined} />
}
/* oxlint-enable typescript/no-non-null-assertion */

/** The emulator's columns and rows, as the pane's box fits them. */
interface Grid {
  readonly cols: number
  readonly rows: number
}

/**
 * Fit the emulator to its box and tell the Host the size the shell should take.
 * @param xterm - the emulator.
 * @param fit - its fit addon.
 * @param node - the box the emulator fills.
 * @param state - the view state, for the Host's limits and input control.
 * @param model - the view that forwards the size.
 * @returns the grid the box fits, or undefined when it cannot be measured yet.
 */
function fitScreen(xterm: Terminal, fit: FitAddon, node: HTMLElement, state: TerminalViewState, model: TerminalView): Grid | undefined {
  const environment = state.environment
  if (environment === undefined || node.clientWidth === 0 || node.clientHeight === 0) return undefined
  const dimensions = fit.proposeDimensions()
  if (dimensions === undefined) return undefined
  const cols = Math.min(dimensions.cols, environment.maxCols)
  const rows = Math.min(dimensions.rows, environment.maxRows)
  if (cols < 2 || rows < 1) return undefined
  if (xterm.cols !== cols || xterm.rows !== rows) xterm.resize(cols, rows)
  // Only the view holding input control resizes the shell; a pane watching
  // another attachment's shell still wraps its output at this pane's width.
  if (state.writable) model.resize(cols, rows)
  return { cols, rows }
}
