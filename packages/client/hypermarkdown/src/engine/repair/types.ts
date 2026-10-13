/**
 * A delimiter a repair has left open: the token its caller should append, and
 * the offset of the unclosed occurrence the closer belongs to.
 */
export interface PendingToken {
  token: string
  close: boolean
  index: number
}

/**
 * What one inline token pass found: the text as it stands after the pass, plus
 * the pending closer it is asking for when the token was left open.
 */
export interface InlineTokenResult extends PendingToken {
  text: string
}
