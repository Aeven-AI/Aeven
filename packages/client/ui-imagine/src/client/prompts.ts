/**
 * The starter prompts on Imagine's start page, in display order, and the aspect ratios their popup offers.
 *
 * Each entry names its dictionary keys: the title (`prompt.<id>.title`) labels the card and the popup, the
 * description (`prompt.<id>.description`) is the popup's one-line summary, and the text (`prompt.<id>.text`) is the
 * prompt the popup sends. An entry with an `image` shows that file from the web app's `imagine-prompts/` assets, and
 * one with a `before` shows the pair as the retouch's own before and after.
 *
 * `instagram-original` is the one entry that carries no text of its own: it invents a scene per open from the pools
 * in `scenes.ts`, dropped into the fixed craft the dictionary holds. Every other entry sends its own text verbatim.
 *
 * A ratio carries the pixel size the message states: the Aeven models take a `WIDTHxHEIGHT` size and refuse an
 * aspect-ratio field, so the size the reader picks is what the prompt asks the model for. `auto` states none and
 * leaves the frame to the model and the supplied photo.
 */
import type { TranslateNS } from '@aeven/client-ui-slots'
import { variationAt } from './scenes.ts'
import type { ImagineVariation } from './scenes.ts'
import type {} from './locales.ts'

/** The ratios a video starter offers, with the frame each asks for. */
export const IMAGINE_VIDEO_RATIOS: readonly [ImagineRatio, ...ImagineRatio[]] = [
  { id: 'wide', size: '16:9' },
  { id: 'story', size: '9:16' },
  { id: 'square', size: '1:1' },
]

/** One aspect ratio the popup offers. */
export interface ImagineRatio {
  /** Ratio id, also its dictionary key suffix (`dialog.aspect.<id>`). */
  readonly id: ImagineRatioId
  /** Pixel size the sent prompt states, absent for `auto`. */
  readonly size?: string
}

/** The ratios the popup offers, in display order. */
export const IMAGINE_RATIOS: readonly [ImagineRatio, ...ImagineRatio[]] = [
  { id: 'auto' },
  // 2K-class sizes: the largest tier either Aeven image model renders, scaled
  // up from Instagram's own export sizes so the downscale keeps the detail.
  { id: 'square', size: '2048x2048' },
  { id: 'portrait', size: '1638x2048' },
  { id: 'story', size: '1152x2048' },
  { id: 'wide', size: '2730x1536' },
]

/** One offered ratio's id. */
export type ImagineRatioId = 'auto' | 'square' | 'portrait' | 'story' | 'wide'

/** What every starter prompt carries. */
interface ImaginePromptBase {
  /** Example image file under `imagine-prompts/`, absent while no asset ships. */
  readonly image?: string
  /** Example clip under `imagine-prompts/`, which plays in place of the still. */
  readonly clip?: string
  /** Ratio the popup opens on; defaults to the first offered. */
  readonly ratio?: ImagineRatioId
  /** Ratios this prompt offers; defaults to every ratio. */
  readonly ratios?: readonly ImagineRatioId[]
  /** Whether this prompt asks for a moving shot, which states a video size. */
  readonly video?: true
}

/** A starter prompt that sends the text its dictionary holds. */
export interface ImagineFixedPrompt extends ImaginePromptBase {
  /** Prompt id, naming its dictionary keys. */
  readonly id: ImagineFixedPromptId
  /** Matching original, shown as the before half of a retouch pair. */
  readonly before?: string
  /** Whether the prompt edits a photo the reader supplies. */
  readonly needsPhoto?: boolean
}

/** The starter prompt that invents its scene per open instead of sending fixed text. */
export interface ImagineVariedPrompt extends ImaginePromptBase {
  readonly id: 'instagram-original'
}

/** One starter prompt. */
export type ImaginePrompt = ImagineFixedPrompt | ImagineVariedPrompt

/** One starter prompt id. */
export type ImaginePromptId = ImaginePrompt['id']

/** One starter prompt id that sends its own dictionary text. */
export type ImagineFixedPromptId =
  | 'aerial-view'
  | 'instagram-retouch'
  | '80s-flashback' | 'caricature' | 'sketch' | 'stickers' | 'photo-booth' | 'y2k-digicam' | 'anime'
  | 'makeup' | 'hair' | 'enhance' | 'night-flash'
  | 'video-linen' | 'video-rain' | 'video-turn' | 'video-coast'
  | 'watercolor' | 'product' | 'poster' | 'claymation'
  | 'neon' | 'pixel' | 'isometric' | 'oil' | 'blueprint' | 'logo'

/** The starter prompts, in display order. */
export const IMAGINE_PROMPTS: readonly ImaginePrompt[] = [
  {
    id: 'instagram-original',
    image: 'instagram-original.jpg',
    ratio: 'portrait',
  },
  {
    id: 'instagram-retouch',
    image: 'instagram-retouch.jpg',
    before: 'instagram-retouch-before.jpg',
    needsPhoto: true,
    ratio: 'portrait',
  },
  {
    id: 'aerial-view',
    image: 'aerial-view.jpg',
    before: 'aerial-view-before.jpg',
    needsPhoto: true,
    ratio: 'portrait',
  },
  { id: '80s-flashback', image: '80s-flashback.jpg', needsPhoto: true, ratio: 'portrait' },
  { id: 'caricature', image: 'caricature.jpg', needsPhoto: true, ratio: 'portrait' },
  { id: 'sketch', image: 'sketch.jpg', needsPhoto: true, ratio: 'portrait' },
  { id: 'stickers', image: 'stickers.jpg', ratio: 'portrait' },
  { id: 'photo-booth', image: 'photo-booth.jpg', ratio: 'portrait' },
  { id: 'y2k-digicam', image: 'y2k-digicam.jpg', ratio: 'portrait' },
  { id: 'anime', image: 'anime.jpg', ratio: 'portrait' },
  { id: 'watercolor', image: 'watercolor.jpg', ratio: 'portrait' },
  { id: 'product', image: 'product.jpg', ratio: 'portrait' },
  { id: 'poster', image: 'poster.jpg', ratio: 'portrait' },
  { id: 'claymation', image: 'claymation.jpg', ratio: 'portrait' },
  { id: 'neon', image: 'neon.jpg', ratio: 'portrait' },
  { id: 'pixel', image: 'pixel.jpg', ratio: 'portrait' },
  { id: 'isometric', image: 'isometric.jpg', ratio: 'portrait' },
  { id: 'oil', image: 'oil.jpg', ratio: 'portrait' },
  { id: 'blueprint', image: 'blueprint.jpg', ratio: 'portrait' },
  { id: 'logo', image: 'logo.jpg', ratio: 'portrait' },
  { id: 'makeup', image: 'makeup.jpg', needsPhoto: true, ratio: 'story', ratios: ['story'] },
  { id: 'hair', image: 'hair.jpg', needsPhoto: true, ratio: 'portrait' },
  { id: 'enhance', image: 'enhance.jpg', needsPhoto: true, ratio: 'portrait' },
  { id: 'night-flash', image: 'night-flash.jpg', ratio: 'portrait' },
  { id: 'video-turn', clip: 'golden-turn.mp4', video: true, ratio: 'wide' },
  { id: 'video-rain', clip: 'rain-bokeh.mp4', video: true, ratio: 'wide' },
  { id: 'video-coast', clip: 'coastline.mp4', video: true, ratio: 'wide' },
  { id: 'video-linen', clip: 'linen.mp4', video: true, ratio: 'wide' },
]

/** The translator a starter prompt's own copy resolves through. */
type PromptTranslate = TranslateNS<'imagine'>

/**
 * The ratios one prompt offers, resolved against the two defaults.
 * @param prompt - the starter prompt.
 * @returns the offered ratios, each resolving to a shipped ratio.
 */
export function promptRatios(prompt: ImaginePrompt): readonly ImagineRatio[] {
  // A video starter states a frame the video model takes, not a pixel size the
  // image models take, so the two choices never mix.
  if (prompt.video === true) return IMAGINE_VIDEO_RATIOS
  if (prompt.ratios === undefined) return IMAGINE_RATIOS
  return IMAGINE_RATIOS.filter(ratio => prompt.ratios?.includes(ratio.id) === true)
}

/**
 * The ratio one prompt opens on.
 * @param prompt - the starter prompt.
 * @returns the named ratio, or the first offered one.
 */
export function promptDefaultRatio(prompt: ImaginePrompt): ImagineRatio {
  const offered = promptRatios(prompt)
  return offered.find(ratio => ratio.id === prompt.ratio) ?? offered[0] ?? IMAGINE_RATIOS[0]
}

/**
 * Whether one prompt invents its scene per open, and so carries the reroll control.
 * @param prompt - the starter prompt.
 * @returns whether the prompt composes from the scene and look pools.
 */
export function promptVaries(prompt: ImaginePrompt): prompt is ImagineVariedPrompt {
  return prompt.id === 'instagram-original'
}

/**
 * The message one prompt sends: its own prompt text — or, for the prompt that invents its scene, the scene, the
 * fixed craft, the grade, and the exclusions — then the photo clause a photo-editing prompt needs, then the size
 * line the chosen ratio adds. Every part reaches the model as the reader's message, so the size the reader picks is
 * the size the call asks for.
 * @param prompt - the starter prompt.
 * @param ratio - the chosen ratio.
 * @param t - the Imagine translator.
 * @param variation - the scene and look a varied prompt composes with; ignored by every other prompt.
 * @returns the draft text, parts separated by a blank line.
 */
export function promptDraft(
  prompt: ImaginePrompt,
  ratio: ImagineRatio,
  t: PromptTranslate,
  variation?: ImagineVariation,
): string {
  const body = promptVaries(prompt) ? composeOriginal(variation ?? variationAt(0, 0), t) : t(`prompt.${prompt.id}.text`)
  const parts = [body]
  if (!promptVaries(prompt) && prompt.needsPhoto === true) parts.push(t('dialog.photoClause'))
  if (ratio.size !== undefined) {
    parts.push(prompt.video === true
      ? t('dialog.videoSizeLine', { size: ratio.size })
      : t('dialog.sizeLine', { size: ratio.size }))
  }
  return parts.join('\n\n')
}

/**
 * The body one create prompt sends: the scene first, because these models weigh the opening words most, then the
 * fixed craft, then the grade, then the exclusions.
 * @param variation - the scene and look this open drew.
 * @param t - the Imagine translator.
 * @returns the composed body.
 */
export function composeOriginal(variation: ImagineVariation, t: PromptTranslate): string {
  return [
    t(`create.scene.${variation.scene}`),
    t('create.craft'),
    t('create.lookLine', { look: t(`create.look.${variation.look}`) }),
    t('create.exclude'),
  ].join('\n\n')
}

/**
 * The URL of one shipped example image.
 * @param file - the file name under `imagine-prompts/`.
 * @returns the image URL, resolved against the page.
 */
export function promptImageUrl(file: string): string {
  return new URL(`imagine-prompts/${file}`, document.baseURI).href
}

/**
 * The URL of one shipped example clip.
 * @param file - the file name under `imagine-prompts/`.
 * @returns the clip URL, resolved against the page.
 */
export function promptClipUrl(file: string): string {
  return new URL(`imagine-prompts/${file}`, document.baseURI).href
}
