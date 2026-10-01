/**
 * Where the pointer's tip goes for the target an action names, in the pane's own coordinates.
 *
 * The rule is by target kind and it is deliberately two functions rather than one with a flag:
 * a button or a link is aimed at the centre of its box, and the address field alone is aimed at the
 * left edge plus an inset, because what it holds is text that begins there. Aiming a control at its
 * left edge puts the arrow beside the thing it presses — measured at −16 px for a 32 px control —
 * which is why the two cases are separate exports a reader can see at the call site.
 *
 * Both add the overlay's tip offset: the overlay centres the pointer's box on the point it is given,
 * while the drawn arrow's tip is that box's top-left corner, so the point has to be moved along both
 * axes for the tip to land where the pane aimed.
 */

/** A rectangle in the coordinates it was measured in. */
export interface AimBox {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** A point in the pane's own coordinates, which is what the overlay takes. */
export interface AimPoint {
  readonly x: number
  readonly y: number
}

/**
 * The centre of a control or link, on both axes.
 * @param box - the element's box.
 * @param panel - the box the overlay draws in.
 * @param tipInset - {@link CURSOR_TIP_OFFSET_PX}`-style compensation for the overlay's half-box.
 * @returns the point the pointer's tip takes.
 */
export function centreOf(box: AimBox, panel: AimBox, tipInset: number): AimPoint {
  return {
    x: box.x - panel.x + box.width / 2 + tipInset,
    y: box.y - panel.y + box.height / 2 + tipInset,
  }
}

/**
 * The start of the text an address field holds, at the field's vertical centre.
 * @param box - the field's box.
 * @param panel - the box the overlay draws in.
 * @param textInset - how far inside the field's left edge its text begins.
 * @param tipInset - {@link CURSOR_TIP_OFFSET_PX}`-style compensation for the overlay's half-box.
 * @returns the point the pointer's tip takes.
 */
export function leftOf(box: AimBox, panel: AimBox, textInset: number, tipInset: number): AimPoint {
  return {
    x: box.x - panel.x + textInset + tipInset,
    y: box.y - panel.y + box.height / 2 + tipInset,
  }
}
