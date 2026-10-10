// @vitest-environment jsdom
/**
 * createLayoutStore unit account: init shape, the action write set (clamp
 * inside actions), and the durable sidebar field (details and the narrow pair
 * stay per-page). Uses the test-sanctioned path: factory self-call +
 * .create() gives the real engine instance (same create path as production).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createLayoutStore } from '@aeven/client-ui-layout/src/client/stores.ts'
import {
  DETAILS_DEFAULT, DETAILS_MAX, DETAILS_MIN, RIGHTBAR_DEFAULT, RIGHTBAR_MIN,
  RIGHTBAR_MIN_BREAKPOINT, RIGHTBAR_MIN_WIDE,
  SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN,
} from '@aeven/client-ui-layout/src/client/columns.ts'

const PERSIST_KEY = 'avn.layout.panels'

beforeEach(() => { localStorage.clear() })

describe('createLayoutStore', () => {
  it('initializes the sidebar at its default width, details closed, wide viewport assumed', () => {
    const { store } = createLayoutStore().create()
    expect(store.getSnapshot()).toEqual({
      sidebar: SIDEBAR_DEFAULT, details: 0, narrow: false, narrowExpanded: false, fullscreen: false,
      rightbar: {},
    })
  })

  it('each create() is an independent instance (factory is not a singleton)', () => {
    const a = createLayoutStore().create()
    const b = createLayoutStore().create()
    a.actions.setSidebar(400)
    expect(b.store.getSnapshot().sidebar).toBe(SIDEBAR_DEFAULT)
  })

  it('setSidebar/setDetails clamp into the contract ranges', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setSidebar(1)
    expect(store.getSnapshot().sidebar).toBe(SIDEBAR_MIN)
    actions.setSidebar(9999)
    expect(store.getSnapshot().sidebar).toBe(SIDEBAR_MAX)
    actions.setDetails(1)
    expect(store.getSnapshot().details).toBe(DETAILS_MIN)
    actions.setDetails(9999)
    expect(store.getSnapshot().details).toBe(DETAILS_MAX)
  })

  it('toggleSidebar flips closed <-> contract default (drag width forgotten)', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setSidebar(400)
    actions.toggleSidebar()
    expect(store.getSnapshot().sidebar).toBe(0)
    actions.toggleSidebar()
    expect(store.getSnapshot().sidebar).toBe(SIDEBAR_DEFAULT)
  })

  it('narrow toggleSidebar flips only the re-expand override; the width preference survives', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setSidebar(400)
    actions.setNarrow(true)
    actions.toggleSidebar()
    expect(store.getSnapshot()).toEqual({
      sidebar: 400, details: 0, narrow: true, narrowExpanded: true, fullscreen: false,
      rightbar: {},
    })
    actions.toggleSidebar()
    expect(store.getSnapshot().narrowExpanded).toBe(false)
    expect(store.getSnapshot().sidebar).toBe(400)
  })

  it('crossing the breakpoint drops the override; a same-value setNarrow keeps it', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setNarrow(true)
    actions.toggleSidebar()
    expect(store.getSnapshot().narrowExpanded).toBe(true)
    actions.setNarrow(true)
    expect(store.getSnapshot().narrowExpanded).toBe(true)
    actions.setNarrow(false)
    expect(store.getSnapshot()).toMatchObject({ narrow: false, narrowExpanded: false })
    actions.setNarrow(true)
    expect(store.getSnapshot().narrowExpanded).toBe(false)
  })

  it('openDetails uses the contract default, preserves an open width, and closeDetails zeroes', () => {
    const { store, actions } = createLayoutStore().create()
    actions.openDetails()
    expect(store.getSnapshot().details).toBe(DETAILS_DEFAULT)
    actions.setDetails(500)
    actions.openDetails()
    expect(store.getSnapshot().details).toBe(500)
    actions.closeDetails()
    expect(store.getSnapshot().details).toBe(0)
  })

  it('persists the sidebar width alone; a reload restores it and nothing else', () => {
    const first = createLayoutStore().create()
    first.actions.setSidebar(400)
    first.actions.openDetails()
    first.actions.setDetails(500)
    first.actions.setNarrow(true)
    first.actions.toggleSidebar()
    expect(JSON.parse(localStorage.getItem(PERSIST_KEY) ?? 'null')).toEqual({ sidebar: 400 })

    const second = createLayoutStore().create()
    expect(second.store.getSnapshot()).toEqual({
      sidebar: 400,
      details: 0,
      narrow: false,
      narrowExpanded: false,
      fullscreen: false,
      rightbar: {},
    })
  })

  it('a closed sidebar survives the reload as closed', () => {
    createLayoutStore().create().actions.toggleSidebar()
    expect(createLayoutStore().create().store.getSnapshot().sidebar).toBe(0)
  })

  it('ignores a stored width that is not a number', () => {
    localStorage.setItem(PERSIST_KEY, JSON.stringify({ sidebar: 'wide' }))
    expect(createLayoutStore().create().store.getSnapshot().sidebar).toBe(SIDEBAR_DEFAULT)
  })
})

describe('the right sidebar is one surface per session', () => {
  const FRAME = 1600

  it('opens at the default fraction of the frame', () => {
    const { store, actions } = createLayoutStore().create()
    actions.toggleRightbar('s1', FRAME)
    expect(store.getSnapshot().rightbar['s1']).toEqual({ shown: true })
    expect(store.getSnapshot().rightbarWidth).toBe(RIGHTBAR_DEFAULT)
  })

  it('keeps each session open or closed as its reader left it', () => {
    const { store, actions } = createLayoutStore().create()
    actions.toggleRightbar('s1', FRAME)
    actions.toggleRightbar('s2', FRAME)
    actions.toggleRightbar('s2', FRAME)

    const { rightbar } = store.getSnapshot()
    expect(rightbar['s1']?.shown).toBe(true)
    expect(rightbar['s2']?.shown).toBe(false)
  })

  it('carries a dragged width to every other session', () => {
    const { store, actions } = createLayoutStore().create()
    actions.toggleRightbar('s1', FRAME)
    actions.setRightbar(500, FRAME)
    // A session that has never been opened still opens at the reader's width:
    // how wide the panel is belongs to the window, not to what is being read.
    actions.toggleRightbar('s2', FRAME)
    expect(store.getSnapshot().rightbarWidth).toBe(500)
  })

  it('closing keeps the width, so reopening returns to it', () => {
    const { store, actions } = createLayoutStore().create()
    actions.toggleRightbar('s1', FRAME)
    actions.setRightbar(480, FRAME)
    actions.toggleRightbar('s1', FRAME)
    expect(store.getSnapshot().rightbar['s1']?.shown).toBe(false)
    expect(store.getSnapshot().rightbarWidth).toBe(480)

    actions.toggleRightbar('s1', FRAME)
    expect(store.getSnapshot().rightbar['s1']?.shown).toBe(true)
    expect(store.getSnapshot().rightbarWidth).toBe(480)
  })

  it('re-clamps a width remembered from a wider frame', () => {
    const { store, actions } = createLayoutStore().create()
    actions.toggleRightbar('s1', FRAME)
    actions.setRightbar(1000, FRAME)
    actions.toggleRightbar('s1', FRAME)

    // 800 * 0.7 = 560 is the ceiling in the narrower frame.
    actions.toggleRightbar('s1', 800)
    expect(store.getSnapshot().rightbarWidth).toBe(560)
  })

  it('never opens below the floor, however narrow the frame', () => {
    const { store, actions } = createLayoutStore().create()
    actions.toggleRightbar('s1', 200)
    expect(store.getSnapshot().rightbarWidth).toBe(RIGHTBAR_MIN)
  })

  it('toggles the named session alone', () => {
    const { store, actions } = createLayoutStore().create()
    actions.toggleRightbar('s1', FRAME)
    expect(store.getSnapshot().rightbar['s1']?.shown).toBe(true)

    actions.toggleRightbar('s1', FRAME)
    expect(store.getSnapshot().rightbar['s1']?.shown).toBe(false)
    expect(store.getSnapshot().rightbar['s2']).toBeUndefined()
  })

  it('a drag cannot close the panel it resizes', () => {
    const { store, actions } = createLayoutStore().create()
    actions.toggleRightbar('s1', FRAME)
    actions.setRightbar(0, FRAME)
    expect(store.getSnapshot().rightbar['s1']?.shown).toBe(true)
    expect(store.getSnapshot().rightbarWidth).toBe(RIGHTBAR_MIN_WIDE)
  })

  it('takes the smaller floor on a frame below the breakpoint', () => {
    const { store, actions } = createLayoutStore().create()
    actions.toggleRightbar('s1', FRAME)
    actions.setRightbar(0, FRAME)
    expect(store.getSnapshot().rightbarWidth).toBe(RIGHTBAR_MIN_WIDE)

    actions.setRightbar(0, RIGHTBAR_MIN_BREAKPOINT - 1)
    expect(store.getSnapshot().rightbarWidth).toBe(RIGHTBAR_MIN)
  })

  it('restores which sessions were open, and the shared width, across a reload', () => {
    const first = createLayoutStore().create()
    first.actions.toggleRightbar('s1', FRAME)
    first.actions.setRightbar(460, FRAME)

    const reloaded = createLayoutStore().create().store.getSnapshot()
    expect(reloaded.rightbar['s1']?.shown).toBe(true)
    expect(reloaded.rightbarWidth).toBe(460)
  })
})
