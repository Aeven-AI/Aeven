/** Root/subcall Tool composition with one keyed atomic dispatch path. */
import { memo, useCallback, useMemo, type ReactNode } from 'react'
import type { GeneratedImages, ToolCallBlock } from '@aeven/client-ui-chat/client'
import type { ToolCallOwnerProps, ToolTreeProps } from '../contract/slots.ts'
import { GenericToolCard } from './toolviews/GenericToolCard.tsx'
import css from './ToolCallTree.module.css'

/** Resolve a Tool call's wire name from either lifecycle form. */
function callName(node: ToolCallBlock): string {
  return 'kind' in node ? node.call?.name ?? '' : node.name
}

/** One atomic call dispatched through the Tool-owned keyed slot. */
const ToolCall = memo(function ToolCall({
  renderSlot, callId, toolName, block, openFile, selected, cwd, home, inspectCall,
  renderMessageImages, generatedImages, collapsed, t, children,
}: Pick<ToolTreeProps, 'renderSlot' | 'openFile' | 'cwd' | 'inspectCall' | 'renderMessageImages' | 't'> & {
  callId: string
  toolName: string
  block: ToolCallBlock
  selected: boolean
  home?: string | undefined
  generatedImages?: GeneratedImages | undefined
  collapsed: boolean
  children?: ReactNode
}) {
  const imageBranch = useMemo(() => {
    const calls = [block]
    for (const call of calls) {
      if (generatedImages?.callIds.has(call.callId)) return true
      calls.push(...call.subCalls)
    }
    return false
  }, [block, generatedImages?.callIds])
  const owner: ToolCallOwnerProps = useMemo(() => ({
    callId,
    toolName,
    block,
    openFile,
    cwd,
    home,
    inspect: () => { inspectCall(callId) },
    renderImages: renderMessageImages,
    generatedImageIds: generatedImages?.attachmentIds,
  }), [callId, toolName, block, openFile, cwd, home, inspectCall, renderMessageImages, generatedImages])
  return (
    <div
      className={css.callRow}
      hidden={collapsed && !imageBranch}
      data-chat-anchor-key={`call:${callId}`}
      data-chat-call-id={callId}
      data-selected={selected || undefined}
    >
      <div hidden={collapsed && !generatedImages?.callIds.has(callId)}>
        {renderSlot('tool.call.toolview', owner, {
          entryKey: toolName,
          fallback: <GenericToolCard {...owner} t={t} />,
        })}
      </div>
      {children}
    </div>
  )
})

const ToolCallBranch = memo(function ToolCallBranch({
  renderSlot, block, selectedCallId, cwd, home, openFile, inspectCall, renderMessageImages, generatedImages, collapsed, t,
}: Pick<ToolTreeProps,
  'renderSlot' | 'selectedCallId' | 'cwd' | 'openFile' | 'inspectCall' | 'renderMessageImages' | 't'
> & {
  block: ToolCallBlock
  home?: string | undefined
  generatedImages?: GeneratedImages | undefined
  collapsed: boolean
}) {
  return (
    <ToolCall
      renderSlot={renderSlot}
      callId={block.callId}
      toolName={callName(block)}
      block={block}
      openFile={openFile}
      selected={block.callId === selectedCallId}
      cwd={cwd}
      home={home}
      inspectCall={inspectCall}
      renderMessageImages={renderMessageImages}
      generatedImages={generatedImages}
      collapsed={collapsed}
      t={t}
    >
      {block.subCalls.length > 0 ? (
        <div className={css.subCalls} data-subcalls data-collapsed={collapsed || undefined}>
          {block.subCalls.map(child => (
            <ToolCallBranch
              key={child.callId}
              renderSlot={renderSlot}
              block={child}
              selectedCallId={selectedCallId}
              cwd={cwd}
              home={home}
              openFile={openFile}
              inspectCall={inspectCall}
              renderMessageImages={renderMessageImages}
              generatedImages={generatedImages}
              collapsed={collapsed}
              t={t}
            />
          ))}
        </div>
      ) : null}
    </ToolCall>
  )
})

/**
 * Render one root Tool call and its recursive children through the same
 * atomic keyed dispatch.
 * @param props - whole-Tool owner data and the Tool-owned child-slot share.
 * @returns the Tool call tree.
 */
export function ToolCallTree({
  renderSlot, node, selectedCallId, cwd, openFile, inspectCall, renderMessageImages, generatedImages, turnProcess, useHostInfo, t,
}: ToolTreeProps) {
  const home = useHostInfo(info => info.home)
  const block = node.data.root
  const turn = node.location.kind === 'turn' || node.location.kind === 'step' ? node.location.turn.turn : undefined
  const renderToolImages = useCallback<ToolTreeProps['renderMessageImages']>(
    owner => renderMessageImages({ ...owner, turn }), [renderMessageImages, turn],
  )
  return (
    <ToolCallBranch
      renderSlot={renderSlot}
      block={block}
      selectedCallId={selectedCallId}
      cwd={cwd}
      home={home}
      openFile={openFile}
      inspectCall={inspectCall}
      renderMessageImages={renderToolImages}
      generatedImages={generatedImages}
      collapsed={turnProcess?.foldable === true && !turnProcess.open}
      t={t}
    />
  )
}
