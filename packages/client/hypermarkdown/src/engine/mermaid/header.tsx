import React, { Component, type MouseEvent, type RefObject } from 'react'

import * as runtime from '../runtime.ts'
import type { Emitter } from '../runtime.ts'
import { defaultUi } from '../config.ts'
import type { UiConfig } from '../config.ts'
import Tooltip, { type TooltipHandle } from '../tooltip.tsx'

interface HeaderProps {
  /** This renderer's own bus, so blocks report only to the renderer that made them. */
  events?: Emitter | undefined
  ui?: UiConfig | undefined
  stream?: boolean | string | undefined
  chart: string
  fullscreen: boolean
  /**
   * The engine could not draw this source. The toolbar drops its controls:
   * there is no drawing to copy, and nothing to open full screen.
   */
  failed?: boolean | undefined
  wrapperRef: RefObject<HTMLDivElement | null>
  toggleFullScreen(fullscreen: boolean): void
}

class Header extends Component<HeaderProps> {
  private tippyCopyTimeout: ReturnType<typeof setTimeout> | undefined
  private readonly headerRef = React.createRef<HTMLDivElement>()
  private readonly tippyFullScreenRef = React.createRef<TooltipHandle>()
  private readonly tippyCopyContentRef = React.createRef<TooltipHandle>()
  private stickyHeader: runtime.StickyHeaderWatch | undefined

  constructor(props: HeaderProps) {
    super(props)

    this.copyContent = this.copyContent.bind(this)
    this.toggleFullScreen = this.toggleFullScreen.bind(this)
    this.updateHeaderScrollClass = this.updateHeaderScrollClass.bind(this)
  }

  override componentDidMount() {
    const vm = this
    vm.stickyHeader = runtime.watchStickyHeader(
      () => vm.props.wrapperRef.current,
      () => vm.headerRef.current,
      () =>  vm.props.fullscreen,
    )
  }

  override shouldComponentUpdate(nextProps: HeaderProps) {
    const vm = this

    if (checkProps()) {
      return true
    } else {
      return false
    }

    function checkProps() {
      // `chart` is deliberately absent: the toolbar draws nothing from the
      // diagram source — its title is fixed, and the copy and fullscreen
      // controls read the current props when clicked. Comparing it would
      // redraw the toolbar on every delta of a streaming diagram to produce
      // exactly the same markup.
      if (
        vm.props.stream !== nextProps.stream ||
        vm.props.fullscreen !== nextProps.fullscreen ||
        vm.props.failed !== nextProps.failed
      ) {
        return true
      } else {
        return false
      }
    }
  }

  copyContent(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()

    const vm = this
    const props = vm.props

    if (props.chart) {
      navigator.clipboard
        .writeText(props.chart)
        .then(() => {
          showTippyCopy()
        })
        .catch((err) => {
          console.log(err)
        })
    }

    function showTippyCopy() {
      vm.tippyCopyContentRef?.current?.show()

      clearTimeout(vm.tippyCopyTimeout)
      vm.tippyCopyTimeout = setTimeout(() => {
        vm.tippyCopyContentRef?.current?.hide()
      }, 600)
    }
  }

  toggleFullScreen(event: MouseEvent<HTMLButtonElement>) {
    let fullscreen

    event.preventDefault()
    event.stopPropagation()

    const vm = this
    const props = vm.props

    fullscreen = ! props.fullscreen
    props.toggleFullScreen(fullscreen)
    props.events?.dispatchObjectEvent('fullscreen:change', fullscreen)
  }

  updateHeaderScrollClass() {
    this.stickyHeader?.update()
  }

  override componentWillUnmount() {
    const vm = this
    vm.stickyHeader?.stop()
  }

  override render() {
    let title
    let tippyCopyTxt
    let iconFullScreen
    let labelFullScreen

    const vm = this
    const props = vm.props

    const ui = props.ui ?? defaultUi
    const { translations, icons } = ui
    // A failed diagram keeps its title and separator, so the block still reads
    // as a diagram's place, but offers no action against a drawing that is not
    // there.
    const controls = vm.props.failed === true
      ? { ...ui.controls.diagram, copy: false, fullscreen: false }
      : ui.controls.diagram

    title = translations.diagram

    tippyCopyTxt = translations.codeCopied
    if (props.stream === true || props.stream === 'true') {
      tippyCopyTxt = translations.codePartiallyCopied
    }

    // The one button reads as two states: the icon and its name change
    // together, so the tooltip never says "Full screen" over a minimize icon.
    if (props.fullscreen) {
      iconFullScreen = icons.minimize
      labelFullScreen = translations.exitFullScreen
    } else {
      iconFullScreen = icons.maximize
      labelFullScreen = translations.fullScreen
    }

    return (
      <div ref={vm.headerRef} className="mermaid-header">
        <div className="mermaid-header-content">
          <span className="mermaid-title-container">
            <span className="mermaid-title">{title}</span>
          </span>
          <span className="mermaid-spacer" />
          <span className="mermaid-button-container">
            {!controls.copy ? null : (
              <Tooltip
                ref={vm.tippyCopyContentRef}
                arrow={false}
                trigger={'manual'}
                placement={'top'}
                content={tippyCopyTxt}
              >
                <span className="tippy-button">
                  <Tooltip
                    placement={'top'}
                    content={translations.copy}
                    touch={false}
                    trigger={'mouseenter'}
                  >
                    <button
                      type="button"
                      className="mermaid-icon-button first"
                      aria-label={translations.copy}
                      onClick={vm.copyContent}
                    >
                      <span className="button-content">
                        <span
                          className="button-icon"
                          dangerouslySetInnerHTML={{
                            __html: icons.copy,
                          }}
                        ></span>
                      </span>
                    </button>
                  </Tooltip>
                </span>
              </Tooltip>
            )}
            {!controls.fullscreen ? null : (
              <Tooltip
                ref={vm.tippyFullScreenRef}
                placement={'top-end'}
                touch={false}
                trigger={'mouseenter'}
                content={labelFullScreen}
              >
                <button
                  type="button"
                  className="mermaid-icon-button last"
                  aria-label={labelFullScreen}
                  onClick={vm.toggleFullScreen}
                >
                  <span className="button-content">
                    <span
                      className="button-icon"
                      dangerouslySetInnerHTML={{
                        __html: iconFullScreen,
                      }}
                    ></span>
                  </span>
                </button>
              </Tooltip>
            )}
          </span>
        </div>
        <div className="mermaid-header-background">
          <div className="mermaid-header-fade" />
          <div className="mermaid-header-blur" />
        </div>
      </div>
    )
  }
}

export default Header
