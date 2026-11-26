/**
 * An artifact's own address: its conversation, `/c/<uuid>`, with the file and its stored copy named after `#`.
 * Opened on its own, such as in a new tab, the conversation loads from the address and the Artifacts plugin
 * opens the named file in the right sidebar.
 */
import type { Artifact } from '@aeven/host-artifacts/types'

/** The address part that names the file an artifact link opens, read once and then cleared. */
const FILE_PARAM = 'file'
/** The address part that names that file's stored copy. */
const COPY_PARAM = 'copy'

/**
 * A conversation's address, as `/c/<uuid>`: the Host mints chat ids as `session-<uuid>`, which the address
 * spells without the prefix, and a bare id takes the `agent-` marker.
 * @param sessionId - the conversation's id.
 * @returns its absolute path.
 */
function conversationPath(sessionId: string): string {
  return sessionId.startsWith('session-') ? `/c/${sessionId.slice('session-'.length)}` : `/c/agent-${sessionId}`
}

/**
 * The address that opens one artifact: its conversation, with the file and its stored copy named after `#`.
 * @param artifact - the artifact.
 * @returns the absolute path with its fragment.
 */
export function artifactHref(artifact: Artifact): string {
  const fragment = new URLSearchParams({ [FILE_PARAM]: artifact.path })
  if (artifact.attachmentId !== undefined) fragment.set(COPY_PARAM, artifact.attachmentId)
  return `${conversationPath(artifact.sessionId)}#${fragment.toString()}`
}

/**
 * The conversation and file an artifact link names, from an address.
 * @param pathname - the address's path.
 * @param hash - the address's fragment, with its `#`.
 * @returns the conversation's id, the file's path and its stored copy, or undefined when the address names no artifact.
 */
export function linkedArtifact(pathname: string, hash: string):
  { sessionId: Artifact['sessionId']; path: string; attachmentId?: string } | undefined {
  const fragment = new URLSearchParams(hash.replace(/^#/u, ''))
  const path = fragment.get(FILE_PARAM)
  const match = /^\/c\/(agent-)?([0-9a-f-]{36})$/iu.exec(pathname)
  if (path === null || path === '' || match === null) return undefined
  const sessionId = (match[1] === undefined ? `session-${match[2] ?? ''}` : match[2] ?? '') as Artifact['sessionId']
  const attachmentId = fragment.get(COPY_PARAM)
  return { sessionId, path, ...attachmentId === null ? {} : { attachmentId } }
}
