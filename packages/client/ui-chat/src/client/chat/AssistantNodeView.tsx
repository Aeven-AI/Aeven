import { memo, useCallback, useMemo } from 'react'
import type { ChatNodeViewProps, TurnTailOwnerProps } from '../contract/slots.ts'
import { AssistantMarkdown } from './AssistantMarkdown.tsx'

/** A file of the Host's content-addressed attachment store (`attachments/v1/objects/<xx>/<sha256>`). */
const ATTACHMENT_OBJECT_PATH = /\/attachments\/v1\/objects\/[0-9a-f]{2}\/([0-9a-f]{64})$/

/** Streaming, settled, and interrupted Assistant states share one keyed renderer instance. */
export const AssistantNodeView = memo(function AssistantNodeView({
  node, useTurnData, turnProcess, cwd, openFile, renderMessageImages, storedImageUrl, fileMentions,
  scrollDown, onFullscreenChange, t,
}: ChatNodeViewProps<'assistant-step'>) {
  const data = node.data
  const turn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  const generated = useTurnData('generated-images')
  const imageVisible = useCallback((source: string): boolean => {
    if (generated === undefined) return true
    let decoded = source
    try { decoded = decodeURI(source) } catch {
      // Malformed escapes retain the authored source for exact comparison.
    }
    if (generated.sources.has(decoded)) return false
    if (cwd !== undefined) {
      const prefix = `${cwd.replace(/\/$/, '')}/`
      if (decoded.startsWith(prefix) && generated.sources.has(decoded.slice(prefix.length))) return false
    }
    const segments = decoded.split(/[/?#]/)
    return !segments.some(segment => generated.attachmentIds.has(segment) || generated.attachmentIds.has(segment.replace(/^image:/, '')))
  }, [cwd, generated])
  const read = useTurnData('read-images')
  // An authored image of a file this Turn read with read_image shows the copy
  // stored then: the file itself may be gone, or on another device's disk. A
  // path into the Host's attachment store names a stored image by its hash.
  const imageUrl = useCallback((source: string): string | undefined => {
    if (read === undefined || storedImageUrl === undefined) return undefined
    let decoded = source
    try { decoded = decodeURI(source) } catch {
      // Malformed escapes retain the authored source for exact comparison.
    }
    const objectHash = ATTACHMENT_OBJECT_PATH.exec(decoded)?.[1]
    const stored = read.byPath.get(decoded)
      ?? (cwd === undefined ? undefined : read.byPath.get(`${cwd.replace(/\/$/, '')}/${decoded}`))
      ?? (objectHash === undefined ? undefined : read.byAttachment.get(`sha256:${objectHash}`))
    return stored === undefined ? undefined : storedImageUrl(stored)
  }, [cwd, read, storedImageUrl])
  const blocks = useMemo(() => generated === undefined ? data.blocks
    : data.blocks.filter(block => block.kind !== 'image' || !generated.attachmentIds.has(String(block.attachment.attachmentId))),
  [data.blocks, generated])
  const tail = useTurnData('turn-tail')
  const owner = useMemo<TurnTailOwnerProps | undefined>(() => {
    if (turn?.status !== 'closed' || data.finalNode === undefined) return undefined
    if (tail?.closing?.finalNode.seq !== data.finalNode.seq) return undefined
    return { turn, seq: data.finalNode.seq, cwd, openFile }
  }, [cwd, data.finalNode, openFile, tail, turn])
  const mentions = useMemo(
    () => owner === undefined ? undefined : fileMentions(owner),
    [fileMentions, owner],
  )
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
      scrollDown={scrollDown}
      onFullscreenChange={onFullscreenChange}
      t={t}
    />
  )
})
