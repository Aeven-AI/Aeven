import { patterns } from '../patterns.ts'

/**
 * Whether a buffer holds nothing but footnote definitions.
 *
 * Blank lines and continuation lines belong to the definition above them, so
 * the whole buffer passes once one definition has been seen; anything else ends
 * the check. A definition-only buffer parses to no visible output, which lets
 * the caller skip rendering it entirely.
 * @param md - the markdown buffer to inspect.
 * @returns true when every non-blank line is a footnote definition or a
 *   continuation of one, and at least one definition was seen.
 */
export function definitionsOnly(md: string): boolean {
  let i
  let line
  let lines
  let sawDefinition

  lines = md.split(patterns.lineSplitRegex)
  sawDefinition = false

  for (i = 0; i < lines.length; i++) {
    line = lines[i]!

    if (line.trim() === '') {
      continue
    }

    if (patterns.footnoteDefinitionRegex.test(line)) {
      sawDefinition = true
      continue
    }

    if (

      sawDefinition &&
      patterns.footnoteContinuationRegex.test(line)
    ) {
      continue
    }

    return false
  }

  return sawDefinition
}
