import {
  cloneElement,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type ReactElement,
  type Ref,
} from 'react'

import type { Instance, Placement, Props } from 'tippy.js'

import { pointerMovedRecently, watchPointerIntent } from './pointer-intent.ts'

/** The callable tippy default export, however a resolver hands it over. */
type TippyFactory = (reference: Element, props: Partial<Props>) => Instance

export interface TooltipProps {
  content?: string | undefined
  placement?: Placement | undefined
  trigger?: string | undefined
  touch?: boolean | undefined
  arrow?: boolean | undefined
  /**
   * The box the bubble is placed against, when it is not the trigger's own
   * (the icon of a padded control). Read on every placement update; the
   * trigger stays the element that shows and hides the bubble.
   */
  placementRect?: ((reference: Element) => DOMRect) | undefined
  /**
   * Space the bubble keeps from the viewport edge it is clamped against,
   * resolved once when the tooltip is created. Returning undefined leaves
   * tippy's own gutter in place.
   */
  overflowPadding?: (() => number | undefined) | undefined
  /**
   * Element the bubble is clamped inside, flush with its edges, instead of the
   * viewport less `overflowPadding`; resolved once when the tooltip is created.
   * Returning null keeps the viewport clamp.
   */
  overflowBoundary?: ((reference: Element) => Element | null) | undefined
  children?: ReactElement<{ ref?: Ref<Element> }> | undefined
}

export interface TooltipHandle {
  show(): void
  hide(): void
}

/** Tippy's arrow padding (3px) plus half its 16px arrow: the closest the arrow's centre gets to the bubble's edge. */
const ARROW_REACH = 11
/** Tippy's default gap between reference and bubble. */
const ARROW_DISTANCE = 10

let factory: TippyFactory | null = null
let pending: Promise<TippyFactory | null> | null = null

/**
 * Find the callable tippy export inside whatever a resolver returns.
 *
 * tippy.js@6 publishes `main` (CommonJS) and `module` (ESM) and no `exports`
 * map, so the callable sits at a different depth per resolver: a bundler takes
 * the ESM build and the namespace's `default` is the function, while Node
 * takes the CommonJS build and wraps `module.exports` as that `default` — so
 * the function is one level further down, at `default.default`. Descend until
 * something is callable rather than guessing a depth.
 * @param module - the imported namespace, whatever its shape.
 * @returns the tippy factory, or null when no callable is reachable.
 */
function resolveFactory(module: unknown): TippyFactory | null {
  let candidate = module

  // ESM default, CommonJS `default.default`, and the bare namespace between.
  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof candidate === 'function') {
      return candidate as TippyFactory
    }
    if (typeof candidate !== 'object' || candidate === null) {
      return null
    }
    candidate = (candidate as { default?: unknown }).default
  }

  return null
}

/**
 * Load tippy.js on the first tooltip, once per module.
 *
 * tippy is optional and never imported at module load: a consumer that
 * installs it gets rich tooltips, and one that does not still renders every
 * toolbar with the native `title` the trigger already carries.
 * @returns the tippy factory, or null when the package is absent or exports no callable.
 */
function loadTippy(): Promise<TippyFactory | null> {
  if (factory) {
    return Promise.resolve(factory)
  }

  if (!pending) {
    pending = import('tippy.js')
      .then((module) => {
        factory = resolveFactory(module)
        if (!factory) {
          // Reachable but unusable: do not retry an import that resolved.
          return null
        }
        return factory
      })
      .catch(() => {
        // Absent or unloadable. Let a later tooltip retry; titles carry the
        // text until one succeeds.
        pending = null
        return null
      })
  }

  return pending
}

/**
 * React adapter for tippy.js, matching the imperative show/hide surface the
 * renderer's toolbars use for their "copied" confirmations. It attaches the
 * reference through props, as required by React 19, instead of reading the
 * removed ReactElement.ref getter.
 *
 * Without tippy the imperative handle is inert and the trigger keeps its
 * native `title`, so every control stays named.
 */
const Tooltip = forwardRef<TooltipHandle, TooltipProps>(
  function Tooltip(props, ref) {
    const {
      content, placement, trigger, touch, arrow, placementRect, overflowPadding, overflowBoundary, children,
    } = props

    const manual = trigger === 'manual'
    const instanceRef = useRef<Instance | null>(null)
    const referenceRef = useRef<Element | null>(null)
    // tippy arrives a microtask late, so creation reads the current props
    // rather than the ones captured when the effect was scheduled.
    const latest = useRef({
      content, placement, touch, arrow, manual, trigger, placementRect, overflowPadding, overflowBoundary,
    })
    latest.current = {
      content, placement, touch, arrow, manual, trigger, placementRect, overflowPadding, overflowBoundary,
    }

    // The anchor may carry a ref of its own; it keeps receiving the element.
    const childRef = (children as { ref?: Ref<Element> } | undefined)?.ref
    const setReference = useCallback((element: Element | null) => {
      referenceRef.current = element
      if (typeof childRef === 'function') childRef(element)
      else if (childRef != null) (childRef as { current: Element | null }).current = element
    }, [childRef])

    useEffect(() => {
      const reference = referenceRef.current

      if (!reference) {
        return
      }

      watchPointerIntent()

      let disposed = false
      let unintended = false

      // An enter the content made is ignored, so the reader's first real move
      // over the control is what opens it; tippy itself listens only for enter.
      const onMove = (event: Event) => {
        const instance = instanceRef.current
        if (!instance || latest.current.manual || instance.state.isVisible) return
        if (!pointerMovedRecently(event.timeStamp)) return
        unintended = false
        instance.show()
      }
      reference.addEventListener('mousemove', onMove)

      void loadTippy().then((create) => {
        if (disposed || !create) {
          return
        }

        const current = latest.current
        const boundary = current.overflowBoundary?.(reference) ?? null
        const overflowPadding = boundary === null ? current.overflowPadding?.() : 0

        instanceRef.current = create(reference, {
          content: current.content ?? '',
          placement: current.placement ?? 'top',
          touch: current.touch ?? true,
          arrow: current.arrow ?? true,
          trigger: current.manual
            ? 'manual'
            : (current.trigger ?? 'mouseenter'),
          appendTo: () => document.body,
          zIndex: 99999,
          getReferenceClientRect: () => latest.current.placementRect?.(reference)
            ?? reference.getBoundingClientRect(),
          // Popper appends these to tippy's own modifiers, so the host's gutter
          // replaces tippy's 5px one on the axis the bubble is clamped against,
          // and a host boundary replaces the viewport clamp flush with its
          // edges. A host with neither keeps tippy's.
          popperOptions: overflowPadding === undefined ? {} : {
            modifiers: [{
              name: 'preventOverflow',
              options: boundary === null ? { padding: overflowPadding } : { padding: overflowPadding, boundary },
            }],
          },
          // An edge-aligned bubble (`-start`/`-end`) keeps its arrow at least
          // ARROW_REACH from its own edge; slide the bubble outward just enough
          // that the arrow can sit on the centre of a narrow reference.
          offset: ({ placement: current, reference: box }) => {
            const shortfall = Math.max(0, ARROW_REACH - box.width / 2)
            const skidding = current.endsWith('-start') ? -shortfall
              : current.endsWith('-end') ? shortfall : 0
            return [skidding, ARROW_DISTANCE]
          },
          // Set by an enter the reader did not make; cancels the show it schedules.
          // Streaming content moving under a resting pointer fires enters with
          // no pointer movement; only a hover the reader made opens the bubble.
          // Imperative show() (the manual "copied" confirmation) is no trigger.
          onTrigger: (_instance, event) => {
            unintended = event.type === 'mouseenter' && !pointerMovedRecently(event.timeStamp)
          },
          onUntrigger: () => {
            unintended = false
          },
          onShow: () => {
            if (!unintended) return undefined
            unintended = false
            return false
          },
        })
      })

      return () => {
        disposed = true
        reference.removeEventListener('mousemove', onMove)
        instanceRef.current?.destroy()
        instanceRef.current = null
      }
    }, [])

    useEffect(() => {
      instanceRef.current?.setProps({
        content: content ?? '',
        placement: placement ?? 'top',
        touch: touch ?? true,
        arrow: arrow ?? true,
        trigger: manual ? 'manual' : (trigger ?? 'mouseenter'),
      })
    }, [arrow, content, manual, placement, touch, trigger])

    useImperativeHandle(
      ref,
      () => ({
        show() {
          instanceRef.current?.show()
        },
        hide() {
          instanceRef.current?.hide()
        },
      }),
      [],
    )

    if (!children) {
      return null
    }

    return cloneElement(children, { ref: setReference })
  },
)

Tooltip.displayName = 'Tooltip'

export default Tooltip
