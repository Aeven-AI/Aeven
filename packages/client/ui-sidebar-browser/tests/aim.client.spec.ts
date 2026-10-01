// The aiming rule, pinned: a control is aimed at the centre of its box, the address field at the
// start of its text, and both carry the overlay's tip offset. Aiming a control at its left edge is
// the defect this spec exists to keep out, so every case states the distance from the left edge.

import { describe, expect, it } from 'vitest'
import { centreOf, leftOf, type AimBox } from '../src/client/aim.ts'

/** The pane's own layer, which the aiming arithmetic is expressed against. */
const panel: AimBox = { x: 40, y: 90, width: 700, height: 800 }
/** One button, 80 wide and 30 tall, 100 px right of the pane's left edge. */
const button: AimBox = { x: 140, y: 190, width: 80, height: 30 }
/** The overlay centres the pointer's box on the point it is given; the tip is that box's corner. */
const TIP = 12

describe('aiming a control', () => {
  it('takes the centre of the box on both axes', () => {
    expect(centreOf(button, panel, TIP)).toEqual({ x: 140 - 40 + 40 + TIP, y: 190 - 90 + 15 + TIP })
  })

  it('aims half the box away from the left edge, which is what a control must not take', () => {
    const point = centreOf(button, panel, TIP)
    const leftEdge = leftOf(button, panel, 0, TIP)
    expect(point.x - leftEdge.x).toBe(button.width / 2)
    // The reported defect: a 32 px control aimed at its left edge sat 16 px left of its centre.
    const narrow: AimBox = { ...button, width: 32 }
    expect(leftOf(narrow, panel, 0, TIP).x - centreOf(narrow, panel, TIP).x).toBe(-16)
  })

  it('moves with half of a width change and not at all with the left edge', () => {
    const grown: AimBox = { ...button, width: button.width + 40 }
    expect(centreOf(grown, panel, TIP).x - centreOf(button, panel, TIP).x).toBe(20)
    expect(leftOf(grown, panel, 0, TIP).x).toBe(leftOf(button, panel, 0, TIP).x)
  })

  it('carries the tip offset on both axes, so the drawn tip lands on the point', () => {
    const bare = centreOf(button, panel, 0)
    const aimed = centreOf(button, panel, TIP)
    expect(aimed.x - bare.x).toBe(TIP)
    expect(aimed.y - bare.y).toBe(TIP)
  })
})

describe('aiming the address field', () => {
  it('takes the left edge plus the text inset, at the field’s vertical centre', () => {
    const field: AimBox = { x: 60, y: 100, width: 500, height: 34 }
    expect(leftOf(field, panel, 14, TIP)).toEqual({ x: 60 - 40 + 14 + TIP, y: 100 - 90 + 17 + TIP })
  })

  it('keeps the field’s own left edge as the origin, not its centre', () => {
    const field: AimBox = { x: 60, y: 100, width: 500, height: 34 }
    const textStart = leftOf(field, panel, 14, TIP)
    const fieldCentre = centreOf(field, panel, TIP)
    expect(fieldCentre.x - textStart.x).toBe(field.width / 2 - 14)
  })
})
