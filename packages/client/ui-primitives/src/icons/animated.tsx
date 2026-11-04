/**
 * Sidebar glyphs that come alive while the row carrying them is hovered or
 * focused: the New Session plus turns over, the Bots face glances about and
 * blinks, and the Imagine sun sets behind its island and rises again. The same
 * Bots face also ships as a self-running loop, for the Bots page's empty state.
 *
 * Each glyph draws the artwork of its static counterpart in `./index.tsx`;
 * only the parts that travel carry a class, and `./AnimatedGlyphs.module.css`
 * owns the timing and the trigger. The trigger reads the row, not the glyph, so
 * a use site gives the motion its reach simply by being a link or a button; a
 * looping glyph ignores the row entirely and is never idle.
 */
import css from './AnimatedGlyphs.module.css'
import type { IconProps, LucideGlyphProps } from './props.ts'

/** lucide `message-circle-plus` with the plus free to turn: the New Session row. */
export const IconChatPlusAnimated = ({ className }: LucideGlyphProps) => (
  <svg
    aria-hidden="true"
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M21.008 16.342a2 2 0 0 0-.094 1.167l1.065 3.29a1 1 0 0 1-1.236 1.168l-3.413-.998a2 2 0 0 0-1.099.092 10 10 0 1 1 4.777-4.719" />
    <g className={css.plus}>
      <path d="M8 12h8" />
      <path d="M12 8v8" />
    </g>
  </svg>
)

/** The Bots face artwork, with the class on its eyes deciding what they do. */
function BotFace({ size = 16, className, eyesClassName }: IconProps & { eyesClassName: string | undefined }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="8" cy="8" r="6.375" stroke="currentColor" strokeWidth="1.25" />
      <path
        className={eyesClassName}
        fill="currentColor"
        fillRule="evenodd"
        d="m7.642 4.422.179.013.172.045.162.075.141.108.114.135.092.152.08.159.077.16.078.16.076.16.076.16.073.162.072.163.07.163.067.164.065.166.047.172.008.177-.036.175-.08.16-.117.136-.148.102-.167.065-.178.026-.177-.014-.17-.052-.156-.087-.133-.118-.106-.142-.082-.157-.07-.163-.068-.165-.07-.163-.072-.162-.073-.162-.074-.161-.076-.16-.078-.161-.083-.157-.08-.158-.064-.166-.023-.176.029-.176.08-.16.121-.132.153-.093.171-.055zM11.324 4.422l.15.011.145.038.136.063.118.09.096.114.077.128.067.133.065.134.066.135.063.134.064.135.062.136.06.137.059.137.056.137.055.14.039.144.007.149-.03.147-.067.134-.099.115-.124.085-.14.055-.15.022-.149-.012-.142-.044-.131-.073-.112-.099-.089-.119-.069-.132-.059-.137-.057-.139-.059-.137-.06-.136-.061-.136-.063-.135-.063-.134-.066-.136-.07-.131-.067-.133-.054-.14-.019-.147.024-.148.068-.135.101-.111.129-.078.143-.046z"
      />
    </svg>
  )
}

/** The Bots face: a dial with two eyes that glance and blink while their row is hovered. */
export const IconBotFaceAnimated = (props: IconProps) => <BotFace {...props} eyesClassName={css.eyes} />

/**
 * The same face glancing and blinking on its own, about once every four seconds:
 * the Bots page's empty state, which no pointer has to reach to come alive.
 */
export const IconBotFaceLooping = (props: IconProps) => <BotFace {...props} eyesClassName={css.eyesLoop} />

/** lucide `images` whose sun sets behind the island and rises again: the Imagine row. */
export const IconStackedImagesAnimated = ({ className }: LucideGlyphProps) => (
  <svg
    aria-hidden="true"
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M4 8a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2" />
    <rect x="8" y="2" width="14" height="14" rx="2" />
    <path d="m22 11-1.296-1.296a2.4 2.4 0 0 0-3.408 0L11 16" />
    <circle className={css.sun} cx="13" cy="7" r="1" fill="currentColor" />
  </svg>
)
