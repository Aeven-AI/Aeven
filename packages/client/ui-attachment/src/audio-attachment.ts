/** Sound attachments: which files the trays play in place instead of showing as file tiles. */

/** Extensions of sound files a browser plays, for an upload whose browser declared no media type. */
const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac'])

/**
 * Whether one attachment is a sound file the trays play in place.
 * @param name - display name including its extension, or undefined.
 * @param mediaType - browser-declared or stored media type, possibly empty.
 * @returns true for a sound file.
 */
export function isAudioAttachment(name: string | undefined, mediaType: string | undefined): boolean {
  if ((mediaType ?? '').trim().toLowerCase().startsWith('audio/')) return true
  const lower = (name ?? '').toLowerCase()
  const dot = lower.lastIndexOf('.')
  return dot > 0 && AUDIO_EXTENSIONS.has(lower.slice(dot + 1))
}
