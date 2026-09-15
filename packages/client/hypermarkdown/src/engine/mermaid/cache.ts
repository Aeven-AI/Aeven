/** Cached SVGs and a nearest-first queue for Mermaid's DOM-dependent layout. */

import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { DiagramPlugin, DiagramResult } from '../plugin-types.ts'

interface Entry {
  data: DiagramResult | null
  promise: Promise<DiagramResult | null>
  distances: Array<() => number>
}

interface Drawing {
  distance: () => number
  run: (needed: boolean) => Promise<void>
}

let rendered = new WeakMap<DiagramPlugin, Map<string, Entry>>()
const queue = new Set<Drawing>()
let running = false
let scrolling = false
let scrollIdle: ReturnType<typeof setTimeout> | undefined
const idleWaiters: Array<() => void> = []
const observedRoots = new WeakSet<EventTarget>()

/**
 * Read completed markup without waiting for a promise or an observer callback.
 * @param chart - Diagram source.
 * @param diagram - The configured diagram plugin.
 * @returns The completed SVG, or null while it is absent or pending.
 */
export function peek(chart: string, diagram?: DiagramPlugin): DiagramResult | null {
  return diagram ? rendered.get(diagram)?.get(chart)?.data ?? null : null
}

/**
 * Share one render per source and plugin. Layout runs between browser tasks;
 * queued sources with no current consumer are discarded before reaching Mermaid.
 * @param chart - Diagram source.
 * @param diagram - The configured diagram plugin.
 * @param distance - Distance from the scrollport; Infinity for an obsolete request.
 * @returns SVG markup, or null when every consumer has dropped the request.
 */
export function render(
  chart: string,
  diagram: DiagramPlugin,
  distance: () => number,
): Promise<DiagramResult | null> {
  let cache = rendered.get(diagram)
  if (!cache) {
    cache = new Map()
    rendered.set(diagram, cache)
  }
  const existing = cache.get(chart)
  if (existing) {
    if (!existing.data) existing.distances.push(distance)
    return existing.promise
  }

  const entries = cache
  const entry: Entry = {
    data: null,
    distances: [distance],
    promise: new Promise((resolve, reject) => {
      queue.add({
        distance: () => Math.min(...entry.distances.map(read => read())),
        async run(needed) {
          entry.distances = []
          if (!needed) {
            entries.delete(chart)
            resolve(null)
            return
          }
          const sandbox = document.createElement('div')
          sandbox.className = 'mermaid-render-sandbox'
          sandbox.setAttribute('aria-hidden', 'true')
          document.body.appendChild(sandbox)
          try {
            const engine = diagram.loaded() ?? await diagram.load()
            const result = await engine.render(`mermaid-${randomUUID()}`, chart, sandbox)
            entry.data = { svg: result.svg }
            resolve(entry.data)
          } catch (error: unknown) {
            entries.delete(chart)
            reject(error)
          } finally {
            // An in-flight layout owns its sandbox even if its first consumer unmounts.
            sandbox.remove()
            entry.distances = []
          }
        },
      })
    }),
  }
  cache.set(chart, entry)
  void drain()
  return entry.promise
}

/**
 * One listener per scrollport. Drain waits until the port is still so a fling
 * through a long transcript does not start Mermaid layouts on the same frames
 * the reader is scrolling.
 * @param root - The overflow box IntersectionObserver uses, or `window`.
 */
export function watchScroll(root: EventTarget): void {
  if (observedRoots.has(root)) return
  observedRoots.add(root)
  root.addEventListener('scroll', onScroll, { passive: true })
}

function onScroll(): void {
  scrolling = true
  if (scrollIdle !== undefined) clearTimeout(scrollIdle)
  scrollIdle = setTimeout(() => {
    scrolling = false
    const waiting = idleWaiters.splice(0)
    waiting.forEach(resume => resume())
  }, 120)
}

function whenScrollIdle(): Promise<void> {
  if (!scrolling) return Promise.resolve()
  return new Promise(resolve => idleWaiters.push(resolve))
}

function yieldForLayout(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => resolve(), { timeout: 80 })
      return
    }
    setTimeout(resolve, 0)
  })
}

/** Mermaid's promise queue does not yield a browser task between layouts. */
async function drain(): Promise<void> {
  if (running) return
  running = true
  try {
    while (queue.size > 0) {
      await yieldForLayout()
      await whenScrollIdle()
      const next = [...queue]
        .map(drawing => ({ drawing, distance: drawing.distance() }))
        .sort((left, right) => left.distance - right.distance)[0]!
      queue.delete(next.drawing)
      await next.drawing.run(Number.isFinite(next.distance))
    }
  } finally {
    running = false
  }
}

/** Drop reusable markup; in-flight operations still settle for their consumers. */
export function clear(): void {
  rendered = new WeakMap()
}
