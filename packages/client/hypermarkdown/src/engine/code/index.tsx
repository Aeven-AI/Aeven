import React, { PureComponent, type ReactElement, type ReactNode } from 'react'

import type { Emitter } from '../runtime.ts'
import { cssLength, defaultUi } from '../config.ts'
import type { UiConfig } from '../config.ts'
import { portalFullscreen } from '../fullscreen-portal.tsx'

import Header, { PROSE_LANGUAGE } from './header.tsx'
import LineNumber from './line-numbers.tsx'

interface CodeElementProps {
  className?: string
  children?: ReactNode
}

export interface CodeBlockProps {
  children?: ReactElement<CodeElementProps>
  preChildren?: ReactNode
  stream?: boolean | undefined
  streaming?: boolean | undefined
  animation?: boolean | undefined
  renderer?: unknown
  events?: Emitter | undefined
  ui?: UiConfig | undefined
  scrollDown?: unknown
  /**
   * Line total from the code cache. It is passed in both phases: the settled
   * tree holds the same lines, and withdrawing the tally at the settle is what
   * made the gutter rebuild every entry it had.
   */
  lineCount?: number | undefined
}

interface CodeBlockState {
  fullscreen: boolean
  finalStream: boolean
}

class MarkdownCode extends PureComponent<CodeBlockProps, CodeBlockState> {
  private userScroll = false
  private readonly scrollMargin = 100
  private currentScrollHeight = 0
  private readonly codeRef = React.createRef<HTMLDivElement>()
  private readonly wrapperRef = React.createRef<HTMLDivElement>()
  private slotHeight: number | undefined
  /** Whether the settle has been decided; kept apart from what it produced. */
  private settled = false
  private settledChildren: ReactNode | undefined
  private settleTimeout: ReturnType<typeof setTimeout> | undefined

  constructor(props: CodeBlockProps) {
    super(props)

    this.state = {
      fullscreen: false,
      finalStream: false,
    }

    this.toggleFullScreen = this.toggleFullScreen.bind(this)

    this.scrollDown = this.scrollDown.bind(this)
    this.scrollDownListener = this.scrollDownListener.bind(this)
  }

  override componentDidMount() {
    this.scheduleSettledChildren()
  }

  override componentDidUpdate(
    prevProps: Readonly<CodeBlockProps>,
    _prevState: Readonly<CodeBlockState>,
  ) {
    const vm = this

    if (vm.state.fullscreen) {
      vm.scrollDown()
    }

    if (
      prevProps.stream !== vm.props.stream ||
      prevProps.animation !== vm.props.animation ||
      prevProps.preChildren !== vm.props.preChildren
    ) {
      clearTimeout(vm.settleTimeout)
      vm.settleTimeout = undefined
      vm.settled = false
      vm.settledChildren = undefined
      vm.scheduleSettledChildren()
    }
  }

  language() {
    let match
    let className

    let language

    const vm = this
    const { children } = vm.props

    language = 'Code'

    if (!children) {
      return language
    } else {
      if (!children.props.className) {
        return language
      } else {
        className = children.props.className // e.g., "language-javascript"
        match = /language-(\w+)/.exec(className)

        if (!match) {
          return language
        } else {
          /* v8 ignore next -- `(\w+)` captures at least one character whenever it matches, so the left side is never null; the fallback answers the `string | undefined` its index type carries. */
          language = match[1] ?? language
          return language
        }
      }
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
    const wrapper = vm.wrapperRef.current

    clearTimeout(vm.settleTimeout)
    wrapper?.removeEventListener('scroll', vm.scrollDownListener)
  }

  override render() {
    let children
    let stream
    let fullscreen

    const vm = this
    const props = vm.props
    const state = vm.state

    const ui = props.ui ?? defaultUi
    const maxHeight = cssLength(ui.codeBlockMaxHeight)

    const language = vm.language()
    const proseClass = language === PROSE_LANGUAGE ? ' message' : ''

    if (props.stream !== true) {
      stream = ''
    } else {
      stream = ' stream-active'
    }

    if (!state.fullscreen) {
      fullscreen = ''
    } else {
      fullscreen = ' fullscreen'
    }

    // The settle is the final render, so the gutter stops animating with it —
    // while it is still streaming, and during the wait before the settled tree
    // is adopted, the entries keep fading in as their lines arrive.
    const lineAnimation =  vm.settled ? false : props.animation

    children = props.children

    // The flag is the decision, the content is only the payload: a settle that
    // came back with nothing to adopt must leave the cached tree on screen
    // rather than blank the block.
    if (vm.settled && vm.settledChildren) {
      children = vm.settledChildren
    }

    const tree = (
      <div
        ref={vm.wrapperRef}
        className={'codeblock-wrapper' + proseClass + stream + fullscreen}
        style={
          maxHeight === undefined ||  state.fullscreen
            ? undefined
            : { maxHeight }
        }
      >
        <div className="code-container">
          <Header
            events={props.events}
            ui={props.ui}
            stream={props.stream}
            language={language}
            codeRef={vm.codeRef}
            wrapperRef={vm.wrapperRef}
            fullscreen={state.fullscreen}
            toggleFullScreen={vm.toggleFullScreen}
          />

          <div className="codeblock-pre-code-content">
            <pre>
              {!ui.lineNumbers || proseClass ? null : (
                <LineNumber
                  codeRef={vm.codeRef}
                  animation={lineAnimation}
                  lineCount={props.lineCount}
                />
              )}

              <div ref={vm.codeRef} className="code-content no-scrollbar">
                {children}
              </div>
            </pre>
          </div>
        </div>
      </div>
    )

    if (state.fullscreen) {
      return portalFullscreen(
        tree,
        'codeblock-wrapper' + proseClass + stream,
        vm.slotHeight,
      )
    }

    return tree
  }

  private scheduleSettledChildren(): void {
    let delay

    const vm = this
    const props = vm.props

    if (
      props.stream === true ||

      vm.settled ||
      vm.settleTimeout !== undefined
    ) {
      return
    }

    delay = props.animation === true ? 1000 : 0

    if (delay === 0) {
      vm.applySettledChildren()
      return
    }

    vm.settleTimeout = setTimeout(() => {
      vm.settleTimeout = undefined
      vm.applySettledChildren()
    }, delay)
  }

  /**
   * Adopt the settled tree, once. The flag — not the children — is what stops
   * a second pass, so a settle that produced nothing to adopt cannot put the
   * block back on the timer or leave the guard re-evaluating on every render.
   */
  private applySettledChildren(): void {
    const vm = this

    vm.settled = true
    vm.settledChildren = vm.props.preChildren
    vm.setState({ finalStream: true })
  }
}

export default MarkdownCode
