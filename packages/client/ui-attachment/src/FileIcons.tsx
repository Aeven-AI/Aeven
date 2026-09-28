/** File-type, status, and control icons of the upload tray. */

/** Icon family chosen from a file's extension and media type. */
export type FileIconKind = 'pdf' | 'doc' | 'sheet' | 'slides' | 'code'

const DOC_EXTENSIONS = new Set(['txt', 'rtf', 'doc', 'docx', 'md', 'markdown', 'odt', 'rtfd', 'pages', 'epub'])
const SHEET_EXTENSIONS = new Set(['xls', 'xlsx', 'xlsm', 'csv', 'tsv', 'ods', 'numbers'])
const SLIDES_EXTENSIONS = new Set(['ppt', 'pptx', 'key', 'odp', 'potx'])

/**
 * Choose the icon family for one file: extension first, then media type.
 * @param name - display name.
 * @param mediaType - browser-declared media type, possibly empty.
 * @returns the icon family.
 */
export function fileIconKind(name: string, mediaType: string): FileIconKind {
  const dot = name.lastIndexOf('.')
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
  if (extension === 'pdf') return 'pdf'
  if (DOC_EXTENSIONS.has(extension)) return 'doc'
  if (SHEET_EXTENSIONS.has(extension)) return 'sheet'
  if (SLIDES_EXTENSIONS.has(extension)) return 'slides'
  const type = mediaType.toLowerCase()
  if (type === 'application/pdf') return 'pdf'
  if (type.startsWith('text/plain') || type === 'application/rtf' || type === 'text/rtf' || type === 'text/markdown'
    || type === 'application/msword' || type === 'application/vnd.oasis.opendocument.text'
    || type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'doc'
  if (type === 'application/vnd.ms-excel' || type === 'text/csv' || type === 'application/vnd.oasis.opendocument.spreadsheet'
    || type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'sheet'
  if (type === 'application/vnd.ms-powerpoint' || type === 'application/vnd.oasis.opendocument.presentation'
    || type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return 'slides'
  return 'code'
}

const OUTLINE = {
  xmlns: 'http://www.w3.org/2000/svg',
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const

/**
 * Outline icon for one file family.
 * @param props.kind - icon family.
 * @returns the SVG icon.
 */
export function FileTypeIcon({ kind }: { kind: FileIconKind }) {
  switch (kind) {
    case 'pdf':
      return (
        <svg {...OUTLINE}>
          <g fill="none">
            <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
            <path d="M14 2v4a2 2 0 0 0 2 2h4" />
          </g>
          <g fill="currentColor" stroke="none">
            <path d="M7.776 17.036c.33 0 .564-.21.564-.57v-.762h.726c.858 0 1.44-.564 1.44-1.524 0-.984-.804-1.452-1.476-1.452H7.746c-.282 0-.54.24-.54.552v3.186c0 .36.234.57.57.57m.564-2.34v-.966h.468c.294 0 .516.156.516.492 0 .312-.228.474-.534.474zM11.172 17h1.242c1.014 0 2.004-.738 2.004-2.19 0-1.212-.882-2.082-2.016-2.082h-1.23a.556.556 0 0 0-.54.552v3.168c0 .312.258.552.54.552m.594-1.05v-2.172h.492c.558 0 .948.366.948 1.062 0 .702-.396 1.11-.996 1.11zM15.174 17.036c.33 0 .564-.21.564-.57v-1.104h.816c.318 0 .54-.198.54-.534 0-.33-.222-.522-.54-.522h-.816v-.528h.93c.318 0 .54-.186.54-.522 0-.318-.222-.528-.54-.528h-1.524c-.288 0-.54.24-.54.546v3.192c0 .36.234.57.57.57" />
          </g>
        </svg>
      )
    case 'doc':
      return (
        <svg {...OUTLINE}>
          <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
          <path d="M14 2v4a2 2 0 0 0 2 2h4" />
          <path d="M10 9H8" />
          <path d="M16 13H8" />
          <path d="M16 17H8" />
        </svg>
      )
    case 'sheet':
      return (
        <svg {...OUTLINE}>
          <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
          <path d="M14 2v4a2 2 0 0 0 2 2h4" />
          <path d="M8 13h2" />
          <path d="M14 13h2" />
          <path d="M8 17h2" />
          <path d="M14 17h2" />
        </svg>
      )
    case 'slides':
      return (
        <svg {...OUTLINE}>
          <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
          <path d="M14 2v4a2 2 0 0 0 2 2h4" />
          <path d="m16 13-3.5 3.5-2-2L8 17" />
        </svg>
      )
    case 'code':
      return (
        <svg {...OUTLINE}>
          <path d="M10 12.5 8 15l2 2.5" />
          <path d="m14 12.5 2 2.5-2 2.5" />
          <path d="M14 2v4a2 2 0 0 0 2 2h4" />
          <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
        </svg>
      )
  }
}

/** Warning triangle shown on a failed upload. */
export const UploadErrorIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 16 16" aria-hidden>
    <path d="M7.938 2.016A.13.13 0 0 1 8.002 2a.13.13 0 0 1 .063.016.15.15 0 0 1 .054.057l6.857 11.667c.036.06.035.124.002.183a.2.2 0 0 1-.054.06.1.1 0 0 1-.066.017H1.146a.1.1 0 0 1-.066-.017.2.2 0 0 1-.054-.06.18.18 0 0 1 .002-.183L7.884 2.073a.15.15 0 0 1 .054-.057m1.044-.45a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767z" />
    <path d="M7.002 12a1 1 0 1 1 2 0 1 1 0 0 1-2 0M7.1 5.995a.905.905 0 1 1 1.8 0l-.35 3.507a.552.552 0 0 1-1.1 0z" />
  </svg>
)

/** Spinner shown while a tile uploads or its thumbnail loads. */
export const UploadSpinnerIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path d="M16 16L19 19M18 12H22M8 8L5 5M16 8L19 5M8 16L5 19M2 12H6M12 2V6M12 18V22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/** Close mark of the remove control. */
export const UploadRemoveIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M11.9997 10.5865L16.9495 5.63672L18.3637 7.05093L13.4139 12.0007L18.3637 16.9504L16.9495 18.3646L11.9997 13.4149L7.04996 18.3646L5.63574 16.9504L10.5855 12.0007L5.63574 7.05093L7.04996 5.63672L11.9997 10.5865Z" />
  </svg>
)
