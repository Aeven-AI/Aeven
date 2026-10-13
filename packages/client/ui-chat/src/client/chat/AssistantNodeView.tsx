import { memo, useCallback, useMemo } from 'react'
import type { ChatNodeViewProps, TurnTailOwnerProps } from '../contract/slots.ts'
import { AssistantMarkdown } from './AssistantMarkdown.tsx'

/** Streaming, settled, and interrupted Assistant states share one keyed renderer instance. */
export const AssistantNodeView = memo(function AssistantNodeView({
  node, useTurnData, turnProcess, cwd, openFile, renderMessageImages, fileMentions,
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
