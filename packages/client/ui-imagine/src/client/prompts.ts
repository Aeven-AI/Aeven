/**
 * The starter prompts on Imagine's start page, in display order. Each names its dictionary keys
 * (`prompt.<id>.title`, `prompt.<id>.text`); a prompt with an `image` shows that file from the web app's
 * `imagine-prompts/` assets, and one without shows a plain card.
 */
export const IMAGINE_PROMPTS: readonly { readonly id: ImaginePromptId; readonly image?: string }[] = [
  { id: 'watercolor' },
  { id: 'product' },
  { id: 'anime' },
  { id: 'stickers' },
  { id: 'poster' },
  { id: 'claymation' },
  { id: 'neon' },
  { id: 'pixel' },
  { id: 'isometric' },
  { id: 'oil' },
  { id: 'blueprint' },
  { id: 'logo' },
]

/** One starter prompt id. */
export type ImaginePromptId =
  | 'watercolor' | 'product' | 'anime' | 'stickers' | 'poster' | 'claymation'
  | 'neon' | 'pixel' | 'isometric' | 'oil' | 'blueprint' | 'logo'

/**
 * The URL of one shipped example image.
 * @param file - the file name under `imagine-prompts/`.
 * @returns the image URL, resolved against the page.
 */
export function promptImageUrl(file: string): string {
  return new URL(`imagine-prompts/${file}`, document.baseURI).href
}
