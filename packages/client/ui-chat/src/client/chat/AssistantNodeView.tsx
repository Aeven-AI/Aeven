import { memo, useCallback, useMemo } from 'react'
import type { ChatNodeViewProps, TurnTailOwnerProps } from '../contract/slots.ts'
import { AssistantMarkdown } from './AssistantMarkdown.tsx'
import { assistantImageUrl } from './workspace-images.ts'

/** A file of the Host's content-addressed attachment store (`attachments/v1/objects/<xx>/<sha256>`). */
const ATTACHMENT_OBJECT_PATH = /\/attachments\/v1\/objects\/[0-9a-f]{2}\/([0-9a-f]{64})$/

/** Streaming, settled, and interrupted Assistant states share one keyed renderer instance. */
export const AssistantNodeView = memo(function AssistantNodeView({
  node, sessionId, useTurnData, turnProcess, cwd, openFile, renderMessageImages, storedImageUrl, fileMentions,
  fileLinks, scrollDown, onFullscreenChange, t,
}: ChatNodeViewProps<'assistant-step'>) {
  const data = node.data
  const turn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  const generated = useTurnData('generated-images')
  const read = useTurnData('read-images')
  // The closed Turn's tail draws its produced images; a reply showing one of them through the copy
  // `reply-images/stored` recorded of the path it wrote leaves it there, but only a copy the tail can draw.
  const produced = useTurnData('produced-images')
  const tailImages = turn?.status === 'closed' ? produced : undefined
  const imageVisible = useCallback((source: string): boolean => {
    if (generated === undefined && tailImages === undefined) return true
    let decoded = source
    try { decoded = decodeURI(source) } catch {
      // Malformed escapes retain the authored source for exact comparison.
    }
    const relative = cwd === undefined || !decoded.startsWith(`${cwd.replace(/\/$/, '')}/`)
      ? undefined
      : decoded.slice(cwd.replace(/\/$/, '').length + 1)
    if (tailImages !== undefined) {
      // The tail draws a produced image from the copy a tool result of the Turn shared; only then does the reply leave it.
      const stored = read?.byPath.get(decoded)
      const drawn = stored !== undefined && read?.byAttachment.has(String(stored.attachmentId)) === true
      if (drawn && tailImages.attachmentIds.has(String(stored.attachmentId))) return false
    }
    if (generated === undefined) return true
    if (generated.sources.has(decoded)) return false
    if (relative !== undefined && generated.sources.has(relative)) return false
    const segments = decoded.split(/[/?#]/)
    return !segments.some(segment => generated.attachmentIds.has(segment) || generated.attachmentIds.has(segment.replace(/^image:/, '')))
  }, [cwd, generated, read, tailImages])
  // An authored image of a file this Turn read with read_image shows the copy
  // stored then: the file itself may be gone, or on another device's disk. A
  // path into the Host's attachment store names a stored image by its hash.
  // Every other local source loads through the Session's workspace route: a
  // Host serving several accounts mounts no `/api/file` to read it by path.
  const imageUrl = useCallback((source: string): string | undefined => assistantImageUrl(source, {
    sessionId,
    cwd,
    ...(read === undefined || storedImageUrl === undefined ? {} : {
      stored: (decoded: string) => {
        const objectHash = ATTACHMENT_OBJECT_PATH.exec(decoded)?.[1]
        const stored = read.byPath.get(decoded)
          ?? (cwd === undefined ? undefined : read.byPath.get(`${cwd.replace(/\/$/, '')}/${decoded}`))
          ?? (objectHash === undefined ? undefined : read.byAttachment.get(`sha256:${objectHash}`))
        return stored === undefined ? undefined : storedImageUrl(stored)
      },
    }),
  }), [cwd, read, sessionId, storedImageUrl])
  const blocks = useMemo(() => generated === undefined ? data.blocks
    : data.blocks.filter(block => block.kind !== 'image' || !generated.attachmentIds.has(String(block.attachment.attachmentId))),
  [data.blocks, generated])
  const tail = useTurnData('turn-tail')
  const owner = useMemo<TurnTailOwnerProps | undefined>(() => {
    if (turn?.status !== 'closed' || data.finalNode === undefined) return undefined
    if (tail?.closing?.finalNode.seq !== data.finalNode.seq) return undefined
    return { turn, seq: data.finalNode.seq, cwd, openFile, renderImages: renderMessageImages }
  }, [cwd, data.finalNode, openFile, renderMessageImages, tail, turn])
  const mentions = useMemo(
    () => owner === undefined ? undefined : fileMentions(owner),
    [fileMentions, owner],
  )
  // Every step resolves path links, not only the closing one: a reply that names a file it made earlier
  // still links to it.
  const links = useMemo(() => fileLinks({ cwd, openFile, turn }), [cwd, fileLinks, openFile, turn])
  const reasoningHidden = turnProcess !== undefined
    && turnProcess.foldable
    && ((turn?.status === 'open')
      || (turnProcess.spec.answerStep === data.step && turnProcess.spec.inlineReasoning))
    && !turnProcess.open
  const revealProcess = useCallback(() => { turnProcess?.setOpen(true) }, [turnProcess])
  return (
    <AssistantMarkdown
      blocks={blocks}
      imageVisible={imageVisible}
      imageUrl={imageUrl}
      streaming={data.status === 'running'}
      interrupted={data.status === 'interrupted'}
      renderMessageImages={renderMessageImages}
      reasoningHidden={reasoningHidden}
      revealProcess={revealProcess}
      mentions={mentions}
      links={links}
      scrollDown={scrollDown}
      onFullscreenChange={onFullscreenChange}
      t={t}
    />
  )
})
