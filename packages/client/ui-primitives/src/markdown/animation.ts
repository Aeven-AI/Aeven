/** Word fade-in preference shared by every Markdown engine instance and flow-row summary below one provider. */
import { createContext, useContext } from 'react'

/**
 * Whether streamed text fades in word by word. Absent a provider, text fades;
 * a host binds its user preference by rendering this context's provider.
 */
export const TextAnimationContext = createContext(true)

/**
 * Read the word fade-in preference that governs the enclosing view.
 * @returns whether newly streamed words fade in.
 */
export function useTextAnimation(): boolean {
  return useContext(TextAnimationContext)
}
