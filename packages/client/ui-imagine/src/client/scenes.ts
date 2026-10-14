/**
 * The pools the Imagine create prompt draws from. A scene is a complete brief — one subject, one action, one place,
 * caught at a decisive moment — so any pick composes into a coherent picture; the look only names the colour and
 * finish the whole frame gets. Both pools hold ids, never copy: each id names its dictionary keys
 * (`create.scene.<id>`, `create.look.<id>`), and the fixed craft the two are dropped into lives at `create.craft`,
 * `create.lookLine`, and `create.exclude`.
 *
 * Every scene is chosen for vividness and presence: a bright, colour-rich place or a person caught mid-action, lit
 * with intent. Quiet, grey or washed-out subjects do not belong here — the pool spans people, fashion, nightlife,
 * travel, landscape, sport, food and still life, and all of it is saturated and glossy.
 */

/** The scenes a create prompt can invent, in walk order. */
export const IMAGINE_SCENES = [
  'studio-colour-block',
  'studio-gaze',
  'street-stride',
  'rooftop-gold',
  'neon-rain',
  'disco-mirror',
  'surf-gold',
  'kitchen-flame',
  'coast-aerial',
  'terrace-view',
  'old-town-sun',
  'lake-mirror',
  'desert-dusk',
  'alpine-exposed',
  'dessert-glow',
  'flowers-flash',
] as const

/** One scene id. */
export type ImagineSceneId = typeof IMAGINE_SCENES[number]

/** The colour and finish a create prompt can take, in walk order. */
export const IMAGINE_LOOKS = [
  'sunlit-bold',
  'candy-flash',
  'glossy-pop',
  'rich-film',
  'neon-electric',
  'azure-clean',
] as const

/** One look id. */
export type ImagineLookId = typeof IMAGINE_LOOKS[number]

/** One composed variation. */
export interface ImagineVariation {
  /** The scene the frame shows. */
  readonly scene: ImagineSceneId
  /** The colour and finish the whole frame takes. */
  readonly look: ImagineLookId
}

/**
 * The variation one open or reroll shows.
 *
 * The popup draws `roll` once when it opens and passes step 0, then one more step per reroll, so consecutive picks
 * never repeat a scene and both pools are walked rather than resampled. Pools of different lengths cycle together,
 * so the pairs keep changing after the shorter pool wraps.
 * @param roll - one random value in [0, 1) drawn when the popup opened.
 * @param step - 0 on open, one more per reroll.
 * @returns the scene and look to compose with.
 */
export function variationAt(roll: number, step: number): ImagineVariation {
  const at = (length: number): number => (Math.floor(roll * length) + step) % length
  return {
    /* v8 ignore next -- the wrap keeps the index inside a non-empty pool, so the fallback arm cannot run */
    scene: IMAGINE_SCENES[at(IMAGINE_SCENES.length)] ?? IMAGINE_SCENES[0],
    /* v8 ignore next -- the wrap keeps the index inside a non-empty pool, so the fallback arm cannot run */
    look: IMAGINE_LOOKS[at(IMAGINE_LOOKS.length)] ?? IMAGINE_LOOKS[0],
  }
}
