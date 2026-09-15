import React, { Component } from 'react'

import { defaultUi } from '../config.ts'
import type { Emitter } from '../runtime.ts'
import type { UiConfig } from '../config.ts'
import type {
  DiagramEngine,
  DiagramPlugin,
  DiagramResult,
} from '../plugin-types.ts'

import Header from './header.tsx'
import PanZoom from './pan-zoom.tsx'
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
  private readonly mermaidSandboxes = new Set<HTMLDivElement>()
  private userScroll = false
  private readonly scrollMargin = 100
  private currentScrollHeight = 0
  private mounted = false

  constructor(props: MermaidDiagramProps) {
    super(props)

    this.state = {
      data: null,
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
    vm.renderMermaidDiagram()
  }

  override componentDidUpdate(prevProps: Readonly<MermaidDiagramProps>) {
    const vm = this

    if (vm.state.fullscreen) {
      vm.scrollDown()
    }

    if (prevProps.chart !== vm.props.chart) {
      // A rewritten source is a fresh attempt: whatever failed before was
      // about the old text, so the cover waits on this one again.
      if (vm.state.failed) {
        vm.setState({ failed: false })
      }
      vm.renderMermaidDiagram()
    }
  }

  toggleFullScreen(fullscreen: boolean) {
    let wrapper

    const vm = this
    vm.setState({ fullscreen: fullscreen }, () => {
      wrapper = vm.wrapperRef.current

      if (!wrapper) {
        return
      }

      if (vm.state.fullscreen) {
        wrapper.addEventListener('scroll', vm.scrollDownListener)
      } else {
        wrapper.removeEventListener('scroll', vm.scrollDownListener)
      }
    })
  }

  renderSandbox(): HTMLDivElement | null {
    let sandbox

    const vm = this

    if (typeof document === 'undefined') {
      return null
    } else {
      sandbox = document.createElement('div')
      sandbox.className = 'mermaid-render-sandbox'
      sandbox.setAttribute('aria-hidden', 'true')

      document.body.appendChild(sandbox)
      vm.mermaidSandboxes.add(sandbox)

      return sandbox
    }
  }

  removeSandbox(sandbox?: HTMLDivElement | null) {
    let targets: HTMLDivElement[]

    const vm = this

    targets = []

    if (sandbox && vm.mermaidSandboxes?.has(sandbox)) {
      targets = [sandbox]
    } else if (!sandbox && vm.mermaidSandboxes) {
      targets = Array.from(vm.mermaidSandboxes)
    }

    targets.forEach((element) => {
      if (!element) {
        return
      }

      element.textContent = ''
      if (element.parentNode) {
        element.parentNode.removeChild(element)
      }

      vm.mermaidSandboxes.delete(element)
    })
  }

  renderMermaidDiagram() {
    let sandbox: HTMLDivElement | null

    const vm = this
    const props = vm.props

    const chart = props.chart

    const diagram = props.diagram

    if (chart === '' || !diagram) {
      return
    }

    // Mid-stream the source can be too unfinished to lay out, in a way the
    // engine reports by drawing a broken diagram rather than by failing. Keep
    // the frame already on screen and wait for the next delta.
    if (!canRender(chart)) {
      return
    }

    sandbox = vm.renderSandbox()

    // Already loaded: render on this tick, so a second diagram does not wait a
    // microtask behind a promise that is already settled.
    const engine = diagram.loaded()

    if (engine) {
      renderMermaidDiagram(engine, sandbox)
    } else {
      diagram
        .load()
        .then((loaded) => {
          renderMermaidDiagram(loaded, sandbox)
        })
        .catch(() => {
          vm.removeSandbox(sandbox)
          vm.fail()
        })
    }

    function renderMermaidDiagram(
      mermaid: DiagramEngine,
      renderSandboxRef: HTMLDivElement | null,
    ) {
      const hash = chart.split('').reduce((acc, char) => {
        return ((acc << 5) - acc + char.charCodeAt(0)) | 0
      }, 0)

      const uniqueId = `mermaid-${Math.abs(hash)}-${Date.now()}-${Math.random()
        .toString(36)
        .substring(2, 9)}`

      mermaid
        .render(uniqueId, chart, renderSandboxRef || undefined)
        .then((data) => {
          vm.removeSandbox(renderSandboxRef)

          if (vm.mounted) {
            vm.setState({ data: data }, () => {
              props.scrollDown?.()
            })
          }
        })
        .catch(() => {
          vm.removeSandbox(renderSandboxRef)
          vm.fail()
        })
    }
  }

  /** Record that nothing is coming, so the cover stops waiting for a drawing. */
  fail() {
    const vm = this
    if (vm.mounted && !vm.state.failed) {
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
    if (vm.wrapperRef?.current) {
      vm.wrapperRef.current.removeEventListener(
        'scroll',
        vm.scrollDownListener,
      )
    }

    vm.removeSandbox()
  }

  override render() {
    let svg

    let stream
    let fullscreen

    const vm = this

    const props = vm.props
    const state = vm.state
    const ui = props.ui ?? defaultUi

    svg = state.data?.svg ?? ''

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
    // when the SVG lands. Until then the pending flag shows the placeholder;
    // a failure ends the wait, since no drawing is coming.
    const pending = state.data === null && !state.failed ? ' pending' : ''
    const failed = state.failed ? ' failed' : ''

    return (
      <div
        ref={vm.wrapperRef}
        className={'mermaid-wrapper' + stream + fullscreen + pending + failed}
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
                Covers the reserved box while the engine draws. It stays
                mounted once the diagram arrives so the cover can fade out
                rather than vanish; `pending` on the wrapper drives both its
                opacity and whether it takes pointer events.
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
  }
}

export default MermaidDiagram
