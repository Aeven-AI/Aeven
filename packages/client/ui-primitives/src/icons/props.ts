/**
 * Shared props for the `IconLucide*` glyph family: the optional class and no
 * `size`, because each glyph draws only its own 24-unit viewBox. The CSS rule
 * at the use site sets the rendered width and height.
 */
export interface LucideGlyphProps {
  /** Extra class for layout placement; color rides currentColor. */
  className?: string | undefined
}

/** Shared props for every ic_ds_* icon component. */
export interface IconProps {
  /** Square edge in px; defaults to the glyph's own drawn size. */
  size?: number | undefined
  /** Extra class for layout placement; color rides currentColor.
   * (`| undefined` for exactOptionalPropertyTypes: callers forward their own optional prop.) */
  className?: string | undefined
}
