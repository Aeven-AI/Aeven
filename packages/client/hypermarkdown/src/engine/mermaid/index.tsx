import React, { Component } from 'react'

import { defaultUi } from '../config.ts'
import type { Emitter } from '../runtime.ts'
import type { UiConfig } from '../config.ts'
import type {
  DiagramPlugin,
  DiagramResult,
} from '../plugin-types.ts'

import { portalFullscreen } from '../fullscreen-portal.tsx'
import Header from './header.tsx'
import PanZoom from './pan-zoom.tsx'
import { peek, render, watchScroll } from './cache.ts'
import { canRender } from './renderable.ts'

export interface MermaidDiagramProps {
  chart: string
  stream?: boolean | string | undefined
  renderer?: unknown
  diagram?: DiagramPlugin | undefined
  events?: Emitter | undefined
  ui?: UiConfig | undefined
  scrollDown?: (() => void) | undefined
}

interface MermaidDiagramState {
  data: DiagramResult | null
  fullscreen: boolean
  /**
   * The engine could not load, or could not draw this source. Nothing further
   * is coming, so the cover is dropped at once rather than fading: a fade
   * reads as a diagram arriving, and none will.
   */
  failed: boolean
}

class MermaidDiagram extends Component<
  MermaidDiagramProps,
  MermaidDiagramState
> {
  private readonly wrapperRef = React.createRef<HTMLDivElement>()
  private userScroll = false
  private readonly scrollMargin = 100
  private currentScrollHeight = 0
  private mounted = false
  private renderObserver: IntersectionObserver | undefined
  private visibilityObserver: IntersectionObserver | undefined
  private scrollRoot: Element | null = null
  private nearViewport = typeof IntersectionObserver === 'undefined'
  private slotHeight: number | undefined

  constructor(props: MermaidDiagramProps) {
    super(props)

    this.state = {
      data: peek(props.chart, props.diagram),
      fullscreen: false,
      failed: false,
    }

    this.toggleFullScreen = this.toggleFullScreen.bind(this)

    this.scrollDown = this.scrollDown.bind(this)
    this.scrollDownListener = this.scrollDownListener.bind(this)
  }

  override componentDidMount() {
    const vm = this
    vm.mounted = true
    if (vm.state.data) {
      vm.nearViewport = true
      return
    }
    vm.watchViewport()
    vm.renderMermaidDiagram()
  }

  /** Preload within half a scrollport; animate only visible placeholders. */
  watchViewport() {
    const vm = this
    const wrapper = vm.wrapperRef.current
    if (vm.nearViewport || !wrapper) return

    for (let parent = wrapper.parentElement; parent; parent = parent.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) {
        vm.scrollRoot = parent
        break
      }
    }
    const root = vm.scrollRoot
    watchScroll(root ?? window)
    const height = root?.clientHeight ?? window.innerHeight
    vm.renderObserver = new IntersectionObserver(
      (entries) => {
        vm.nearViewport = entries.some(entry => entry.isIntersecting)
        if (vm.nearViewport) vm.renderMermaidDiagram()
      },
      { root, rootMargin: `${Math.round(height * 0.5)}px 0px` },
    )
    vm.visibilityObserver = new IntersectionObserver(
      (entries) => {
        wrapper.toggleAttribute('data-visible', entries.some(entry => entry.isIntersecting))
      },
      { root },
    )
    vm.renderObserver.observe(wrapper)
    vm.visibilityObserver.observe(wrapper)

    // Import while the first diagram is still offscreen; load() shares its promise.
    const diagram = vm.props.diagram
    void diagram?.load().catch(() => {
      if (vm.props.diagram === diagram) vm.fail()
    })
  }

  /** Release both observers after drawing or unmounting. */
  unwatchViewport() {
    this.renderObserver?.disconnect()
    this.visibilityObserver?.disconnect()
    this.renderObserver = undefined
    this.visibilityObserver = undefined
    this.wrapperRef.current?.removeAttribute('data-visible')
  }

  override componentDidUpdate(prevProps: Readonly<MermaidDiagramProps>) {
    const vm = this

    if (vm.state.fullscreen) {
      vm.scrollDown()
    }

    if (prevProps.chart !== vm.props.chart || prevProps.diagram !== vm.props.diagram) {
      // A rewritten source is a fresh attempt: whatever failed before was
      // about the old text, so the cover waits on this one again.
      if (vm.state.failed) {
        vm.setState({ failed: false })
      }
      vm.renderMermaidDiagram()
    }
  }

  toggleFullScreen(fullscreen: boolean) {
    const vm = this
    if (fullscreen && vm.wrapperRef.current) {
      vm.slotHeight = vm.wrapperRef.current.getBoundingClientRect().height
    }
    vm.setState({ fullscreen: fullscreen }, () => {
      const wrapper = vm.wrapperRef.current

      if (vm.state.fullscreen) {
        wrapper?.addEventListener('scroll', vm.scrollDownListener)
      } else {
        wrapper?.removeEventListener('scroll', vm.scrollDownListener)
      }
    })
  }

  renderMermaidDiagram() {
    const vm = this
    const props = vm.props

    const chart = props.chart

    const diagram = props.diagram

    if (chart === '' || !diagram) {
      return
    }

    // Too far from the scrollport to be worth drawing. The observer calls back
    // here once it comes near.
    if (!vm.nearViewport) {
      return
    }

    // Mid-stream the source can be too unfinished to lay out, in a way the
    // engine reports by drawing a broken diagram rather than by failing. Keep
    // the frame already on screen and wait for the next delta.
    if (!canRender(chart)) {
      return
    }

    const cached = peek(chart, diagram)
    if (cached) {
      vm.setState({ data: cached, failed: false })
      vm.unwatchViewport()
      return
    }

    render(chart, diagram, () => {
      if (!vm.mounted || vm.props.chart !== chart || vm.props.diagram !== diagram) {
        return Infinity
      }
      const wrapper = vm.wrapperRef.current
      /* v8 ignore next -- a mounted diagram always renders its wrapper; the unmount case is answered above, and the ref cannot clear between a commit and this callback. */
      if (!wrapper) return Infinity
      const rect = wrapper.getBoundingClientRect()
      const root = vm.scrollRoot?.getBoundingClientRect()
      const gap = Math.max(0, (root?.top ?? 0) - rect.bottom,
        rect.top - (root?.bottom ?? window.innerHeight))
      const limit = vm.scrollRoot?.clientHeight ?? window.innerHeight
      return gap > limit ? Infinity : gap
    }).then((data) => {
      if (data && vm.mounted && vm.props.chart === chart && vm.props.diagram === diagram) {
        vm.unwatchViewport()
        vm.setState({ data, failed: false }, () => props.scrollDown?.())
      }
    }).catch(() => {
      if (vm.props.chart === chart && vm.props.diagram === diagram) vm.fail()
    })
  }

  /** Record that nothing is coming, so the cover stops waiting for a drawing. */
  fail() {
    const vm = this
    if (vm.mounted && !vm.state.failed) {
      vm.unwatchViewport()
      vm.nearViewport = true
      vm.setState({ failed: true })
    }
  }

  scrollDown() {
    let wrapper

    const vm = this
    wrapper = vm.wrapperRef.current

    if (wrapper && ! vm.userScroll) {
      if (vm.currentScrollHeight !== wrapper.scrollHeight) {
        wrapper.scrollTo({
          top: wrapper.scrollHeight,
          behavior: 'instant',
        })

        vm.currentScrollHeight = wrapper.scrollHeight
      }
    }
  }

  scrollDownListener() {
    let scrollTop
    let scrollHeight
    let clientHeight

    const vm = this
    const wrapper = vm.wrapperRef.current

    /* v8 ignore next 3 -- the listener is only attached to a mounted wrapper, so the ref it reads is the element the event came from. */
    if (!wrapper) {
      return
    }

    scrollTop = wrapper.scrollTop
    scrollHeight = wrapper.scrollHeight
    clientHeight = wrapper.clientHeight

    if (scrollTop + clientHeight <= scrollHeight - vm.scrollMargin) {
      vm.userScroll = true
    } else {
      vm.userScroll = false
    }
  }

  override componentWillUnmount() {
    const vm = this
    vm.mounted = false
    vm.unwatchViewport()
    vm.wrapperRef.current?.removeEventListener('scroll', vm.scrollDownListener)
  }

  override render() {
    let svg

    let stream
    let fullscreen

    const vm = this

    const props = vm.props
    const state = vm.state
    const ui = props.ui ?? defaultUi

    const data = peek(props.chart, props.diagram) ?? state.data
    svg = data?.svg ?? ''

    if (props.stream !== true && props.stream !== 'true') {
      stream = ''
    } else {
      stream = ' stream-active'
    }

    if (!state.fullscreen) {
      fullscreen = ''
    } else {
      fullscreen = ' fullscreen'
    }

    // The box is sized before the engine has drawn anything, so a diagram
    // occupies its final height from the first paint and the page never jumps
    // when the SVG lands. The cover is up from that first paint and comes off
    // once a drawing replaces it; a failure takes it off too, since no drawing
    // is coming.
    const drawn = data !== null ? ' drawn' : ''
    const failed = state.failed ? ' failed' : ''

    const tree = (
      <div
        ref={vm.wrapperRef}
        className={'mermaid-wrapper' + stream + fullscreen + drawn + failed}
      >
        <div className="mermaid-container">
          <Header
            events={props.events}
            ui={props.ui}
            stream={props.stream}
            chart={props.chart}
            wrapperRef={vm.wrapperRef}
            fullscreen={state.fullscreen}
            failed={state.failed}
            toggleFullScreen={vm.toggleFullScreen}
          />
          <div className="mermaid-content">
            <div className="mermaid-scroll no-scrollbar">
              <PanZoom
                enabled={ui.controls.diagram.panZoom && !state.failed}
                fullscreen={state.fullscreen}
                svg={svg}
                ui={props.ui}
              />
              {/*
                Covers the reserved box while the engine draws. It is up from
                the first paint and stays mounted once the diagram arrives, so
                the cover can fade out rather than vanish; `drawn` on the
                wrapper is what takes it off.
              */}
              <div className="mermaid-loader" aria-hidden="true">
                <span className="mermaid-loader-mark">
                  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path
                      d="M16 16L19 19M18 12H22M8 8L5 5M16 8L19 5M8 16L5 19M2 12H6M12 2V6M12 18V22"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    )

    if (state.fullscreen) {
      return portalFullscreen(
        tree,
        'mermaid-wrapper' + stream + drawn + failed,
        vm.slotHeight,
      )
    }

    return tree
  }
}

export default MermaidDiagram
