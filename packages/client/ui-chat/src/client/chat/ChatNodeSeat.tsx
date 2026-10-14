import type { PendingSubmission } from '@aeven/api-session-controller/client'
import { memo, useCallback, useMemo } from 'react'
import { JsonBlock } from '@aeven/client-ui-primitives'
import type { ConversationLocationDataStore, ConversationTurnDataMap } from '@aeven/client-ui-conversation/client'
import type { ChatNodeOwnerProps, ChatViewSlotProps } from '../contract/slots.ts'
import type { ChatNode } from '../contract/chat-nodes.ts'
import { TURN_PROCESS_INDEPENDENT_KINDS } from '../contract/turn-process.ts'
import { hasAssistantReplyContent } from '../contract/assistant-content.ts'
import { storedTurnProcessEntry } from '../stores.ts'
import { useSearchableHidden } from './searchable-hidden.ts'
import { hasGeneratedImageCall } from '../contract/generated-images.ts'
import { useTurnDataValue } from './use-turn-data.ts'
import css from './ChatView.module.css'

interface ChatNodeSeatProps extends ChatNodeOwnerProps {
  readonly submission?: PendingSubmission | undefined
  readonly nodeKey: string
  readonly highlightedNodeKey: string | null
  readonly useChatNode: ChatViewSlotProps['useChatNode']
  readonly useChatNodeProcess: ChatViewSlotProps['useChatNodeProcess']
  readonly historyIncomplete: boolean
  readonly extendedTranscript: boolean
  readonly useStore: ChatViewSlotProps['useStore']
  readonly actions: ChatViewSlotProps['actions']
  readonly renderSlot: ChatViewSlotProps['renderSlot']
  readonly t: ChatViewSlotProps['t']
}

type RoutedChatNodeOwner = {
  [Kind in ChatNode['kind']]: ChatNodeOwnerProps & { readonly node: ChatNode<Kind> }
}[ChatNode['kind']]

function turnDataOf(node: ChatNode | undefined): ConversationLocationDataStore<ConversationTurnDataMap> | undefined {
  const location = node?.location
  return location?.kind === 'turn' || location?.kind === 'step' ? location.turn.data : undefined
}

/**
 * Whether a node renders as a one-line work row (a tool call, a command, or a
 * step that holds only reasoning) rather than prose.
 * @param node - routed Chat node.
 * @returns whether the node takes the compact work-row gap.
 */
function isWorkRow(node: ChatNode): boolean {
  return node.kind === 'tool-call' || node.kind === 'command'
    || (node.kind === 'assistant-step' && !hasAssistantReplyContent(node.data.blocks))
}

function turnOf(node: ChatNode | undefined): number | undefined {
  const location = node?.location
  return location?.kind === 'turn' || location?.kind === 'step' ? location.turn.turn : undefined
}

/** Subscribe, apply Turn-process visibility, and dispatch one stable Context key. */
export const ChatNodeSeat = memo(function ChatNodeSeat({
  nodeKey, submission, highlightedNodeKey, useChatNode, useChatNodeProcess, historyIncomplete, extendedTranscript,
  selectedCallId, cwd, openFile, forkAt, editMessage,
  renderMessageImages, fileMentions, scrollDown, onFullscreenChange, useStore, actions, renderSlot, t,
}: ChatNodeSeatProps) {
  const durableNode = useChatNode(nodeKey)
  const node = useMemo(() => durableNode ?? (submission === undefined ? undefined : {
    key: nodeKey, id: submission.requestId, target: 'chat', kind: 'user',
    anchorSeq: 0, location: { kind: 'session' }, visibility: 'visible',
    data: {
      kind: 'user', seq: 0, time: submission.time,
      content: submission.text === '' ? [] : [{ type: 'text', text: submission.text }],
      source: { kind: 'user', rpcId: submission.requestId },
    },
  } satisfies ChatNode<'user'>), [durableNode, submission, nodeKey])
  const routedNode = node as ChatNode | undefined
  const turn = turnOf(routedNode)
  const processPresentation = useChatNodeProcess(nodeKey)
  const processSpec = processPresentation?.spec
  const storedEntry = useStore(state => processSpec === undefined
    ? undefined
    : storedTurnProcessEntry(state, processSpec.turn))
  const processEntry = processSpec !== undefined
    && storedEntry !== undefined
    && (storedEntry.answerStep === null || storedEntry.answerStep === processSpec.answerStep)
    ? storedEntry
    : undefined
  const processOpen = processEntry !== undefined
  const setOpen = useCallback((open: boolean) => {
    if (processSpec !== undefined) {
      actions.setTurnProcessOpen(
        processSpec.turn, processPresentation?.turnClosed ? processSpec.answerStep : null, open,
      )
    }
  }, [actions, processPresentation?.turnClosed, processSpec])
  const processWindowReady = processSpec !== undefined
    && processPresentation !== undefined
    && !extendedTranscript
    && processPresentation.turn === processSpec.turn
    && (!processPresentation.turnClosed || processSpec.answerAnchorSeq !== null)
    && (!historyIncomplete || processPresentation.turnStarted)
  const processMember = routedNode !== undefined
    && processWindowReady
    && !TURN_PROCESS_INDEPENDENT_KINDS.has(routedNode.kind)
    && routedNode.anchorSeq >= processSpec.processStartSeq
    && (processSpec.answerAnchorSeq === null || routedNode.anchorSeq < processSpec.answerAnchorSeq)
    && !(!processPresentation.turnClosed && routedNode.kind === 'assistant-step'
      && hasAssistantReplyContent(routedNode.data.blocks))
  const processAnswer = routedNode !== undefined
    && processWindowReady
    && routedNode.kind === 'assistant-step'
    && routedNode.data.step === processSpec.answerStep
  const ownsDisclosure = routedNode?.kind === 'turn-process' || processAnswer
  const liveProcess = processSpec !== undefined
    && processPresentation !== undefined
    && processPresentation.turn === processSpec.turn
    && !processPresentation.turnClosed
  // An open Turn is always openable: its rows and the reasoning it streams wait
  // behind the control, and only the closed Turn's projection knows which of
  // them it keeps. A closed Turn is openable when it holds process rows or its
  // Answer Step's reasoning.
  const holdsProcess = processPresentation?.hasExternalProcess === true
    || processSpec?.inlineReasoning === true
  const openable = liveProcess || holdsProcess
  const foldable = processWindowReady
    && (processMember || ownsDisclosure || !processPresentation.turnClosed)
  const liveHeader = liveProcess && routedNode?.kind === 'turn-process'
  const turnProcess = useMemo(() => processSpec === undefined
    ? undefined
    : {
      spec: processSpec,
      foldable: foldable || liveHeader,
      openable,
      holdsProcess,
      open: processOpen,
      setOpen,
    }, [
    foldable, holdsProcess, liveHeader, openable, processOpen, processSpec, setOpen,
  ])
  const controllerInactive = routedNode?.kind === 'turn-process'
    && !foldable
    && !liveHeader
  const compactAnswer = processAnswer
    && foldable
    && processPresentation.compactAnswer
    && !processOpen
  const generatedImages = useTurnDataValue(turnDataOf(routedNode), 'generated-images')
  const imageLane = routedNode?.kind === 'tool-call' && hasGeneratedImageCall(routedNode.data.root, generatedImages)
  const processHidden = controllerInactive || (foldable && processMember && !processOpen && !imageLane)
  const revealProcess = useCallback(() => {
    if (processMember) setOpen(true)
  }, [processMember, setOpen])
  const wrapperRef = useSearchableHidden(processHidden, revealProcess)
  const owner = useMemo<ChatNodeOwnerProps | null>(() => node === undefined
    ? null
    : {
      submission: durableNode === undefined ? submission : undefined,
      selectedCallId,
      cwd,
      openFile,
      forkAt,
      editMessage,
      renderMessageImages,
      generatedImages,
      fileMentions,
      scrollDown,
      onFullscreenChange,
      extendedTranscript,
      turnProcess,
    }, [
    node, durableNode, submission, selectedCallId, cwd, openFile, forkAt, editMessage,
    renderMessageImages, generatedImages, fileMentions, scrollDown, onFullscreenChange, extendedTranscript, turnProcess,
  ])
  if (routedNode === undefined || owner === null) return null
  const turnData = turnDataOf(routedNode)
  // Runtime dispatch owns the correlation: every Node's discriminant is the
  // keyed-slot entry passed alongside that same Node. TypeScript does not
  // distribute an object containing a union into a union of objects itself.
  const routedOwner = { ...owner, node: routedNode } as RoutedChatNodeOwner
  return (
    <div
      ref={wrapperRef}
      className={css.flowItem}
      data-chat-anchor-key={routedNode.key}
      data-chat-flow-key={routedNode.key}
      data-chat-flow-kind={routedNode.kind}
      data-chat-turn={turn}
      data-search-match={highlightedNodeKey === nodeKey || undefined}
      data-turn-process-member={processMember || undefined}
      data-turn-process-hidden={processHidden || undefined}
      data-turn-process-answer={compactAnswer || undefined}
      data-chat-work-row={(!imageLane && isWorkRow(routedNode)) || undefined}
      data-turn-process-answer-step={(processAnswer && foldable) || undefined}
    >
      {renderSlot('conversation.chat.node', routedOwner, {
        entryKey: routedNode.kind,
        hookContext: turnData,
        fallback: (
          <JsonBlock
            label={t('message.unknownSurface', { type: routedNode.kind })}
            payload={routedNode.data}
            truncatedLabel={total => t('json.truncated', { total })}
          />
        ),
      })}
    </div>
  )
})
