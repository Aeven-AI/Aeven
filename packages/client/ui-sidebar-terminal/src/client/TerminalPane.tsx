/**
 * One Terminal surface: the shell a pill owns, rendered by xterm.js.
 *
 * The shell lives on the Host (api-terminal-controller) and outlives this
 * pane: switching sessions only detaches the view, closing the pill closes the
 * shell (index.ts). The pill carries the shell's title.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { ClientTerminals, TerminalView, TerminalViewState } from '@aeven/api-terminal-controller/client'
import { Button, IconLucidePlus } from '@aeven/client-ui-primitives'
import type { SidebarContentPaneProps } from '@aeven/client-ui-sidebar-select/client'
import type { TranslateNS } from '@aeven/client-ui-slots'
import type { ThemeSnapshot } from '@aeven/client-ui-theme/client'
import type { SessionId } from '@aeven/session/types'
import '@xterm/xterm/css/xterm.css'
import css from './terminal.module.css'
import { TerminalTheme } from './terminal-theme.ts'
import { observeTerminalCursor } from './terminal-cursor.ts'

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
}

/**
 * Render one Terminal surface.
 * @param props - the column's pane props plus the plugin's copy and services.
 * @returns the terminal element tree.
 */
export function TerminalPane({ sessionId, surfaceId, active, setTab, t, terminals, theme, holds }: TerminalPaneProps): ReactNode {
  const session = sessionId as SessionId
  // Bumped by "New terminal", which closes this pill's shell and binds a fresh one.
  const [generation, setGeneration] = useState(0)
  const model = useMemo(() => terminals.view(session, surfaceId, surfaceId), [terminals, session, surfaceId, generation])
  useEffect(() => holds.hold(session, surfaceId), [holds, session, surfaceId])
  const state = useSyncExternalStore(listener => model.state.subscribe(listener), () => model.state.getSnapshot())
  const themeSnapshot = useSyncExternalStore(theme.subscribe, theme.getSnapshot)
  useEffect(() => model.mount(), [model])
  useEffect(() => {
    setTab(state.title === undefined ? undefined : { title: state.title })
  }, [setTab, state.title])
  useEffect(() => () => { setTab(undefined) }, [setTab])

  const renew = (): void => {
    terminals.close(session, surfaceId, surfaceId)
    setGeneration(value => value + 1)
  }
  const newTerminal = (
    <Button variant="primary" size="sm" icon={<IconLucidePlus />} onClick={renew}>{t('new')}</Button>
  )

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
  const lastRevision = useRef(0)
  const [ready, setReady] = useState(false)
  const current = useRef({ state, visible })
  current.current = { state, visible }

  useLayoutEffect(() => {
    const node = element.current!
    const xterm = new Terminal({
      minimumContrastRatio: 4.5,
      cursorBlink: true,
      fontSize: 13,
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
    const measure = (): void => {
      if (!current.current.visible || !current.current.state.writable || node.clientWidth === 0 || node.clientHeight === 0) return
      fitScreen(xterm, addon, current.current.state, model)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => {
      observer.disconnect()
      input.dispose()
      cursor.dispose()
      palette.dispose()
      xterm.dispose()
      terminal.current = undefined
      fit.current = undefined
    }
  }, [model])

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
      xterm.resize(render.frame.info.cols, render.frame.info.rows)
    }
    xterm.write(render.frame.type === 'snapshot' ? render.frame.screen : render.frame.data, () => {
      model.acknowledge(render.revision)
      setReady(true)
    })
  }, [state.render, model])

  useLayoutEffect(() => {
    const xterm = terminal.current!
    xterm.options.disableStdin = !state.writable
    if (visible && state.writable && element.current?.clientWidth && element.current.clientHeight) {
      fitScreen(xterm, fit.current!, state, model)
    } else if (state.info !== undefined && !state.writable) xterm.resize(state.info.cols, state.info.rows)
  }, [visible, state.writable, state.info?.cols, state.info?.rows, model])
  useEffect(() => {
    terminal.current!.textarea?.setAttribute('aria-label', label)
  }, [label])
  useEffect(() => { if (visible && state.writable) terminal.current!.focus() }, [visible, state.writable])
  return <div className={css.screen} ref={element} data-ready={ready || undefined} />
}
/* oxlint-enable typescript/no-non-null-assertion */

/**
 * Fit the emulator to its box and tell the Host the new size.
 * @param xterm - the emulator.
 * @param fit - its fit addon.
 * @param state - the view state, for the Host's size limits.
 * @param model - the view that forwards the size.
 */
function fitScreen(xterm: Terminal, fit: FitAddon, state: TerminalViewState, model: TerminalView): void {
  const dimensions = fit.proposeDimensions()
  const environment = state.environment
  if (dimensions === undefined || environment === undefined) return
  const cols = Math.min(dimensions.cols, environment.maxCols)
  const rows = Math.min(dimensions.rows, environment.maxRows)
  if (cols < 2 || rows < 1) return
  xterm.resize(cols, rows)
  model.resize(cols, rows)
}
