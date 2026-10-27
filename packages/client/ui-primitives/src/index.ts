/**
 * Cordis-free React primitives styled only through `--dsw-*` tokens.
 */

export { StateDot } from './StateDot.tsx'
export type { StateDotState } from './StateDot.tsx'
export { DisclosureRow } from './DisclosureRow.tsx'
export type { DisclosureRowProps } from './DisclosureRow.tsx'
export { TextShimmer } from './TextShimmer.tsx'
export { ImageLightbox } from './ImageLightbox.tsx'
export type { ImageLightboxLabels, LightboxImage } from './ImageLightbox.tsx'
export type { TextShimmerProps } from './TextShimmer.tsx'
export { Button } from './Button.tsx'
export type { ButtonVariant } from './Button.tsx'
export { Pill } from './Pill.tsx'
export { SectionHeader } from './SectionHeader.tsx'
export { ProviderRow, ProviderRowButton, ProviderRowList } from './ProviderRow.tsx'
export type { ProviderRowButtonProps, ProviderRowProps, ProviderRowStatus } from './ProviderRow.tsx'
export { HeroShell } from './HeroShell.tsx'
export type { HeroShellProps } from './HeroShell.tsx'
export { greetingKeyOf, heroGreeting, readerDisplayName, useHeroGreeting } from './hero-greeting.ts'
export type { HeroCopyKey, HeroGreetingKey, HeroTranslate } from './hero-greeting.ts'
export { Spinner } from './Spinner.tsx'
export { LoadingBlock } from './LoadingBlock.tsx'
export { FailMark } from './FailMark.tsx'
export {
  ActivityCard, ActivityCode, ActivityDetails, ActivityItem, ActivityLink, ActivityMenu, ActivityMessage, ActivityNote,
  ActivityPill,
  ActivityRowButton, ActivitySection,
} from './ActivityMenu.tsx'
export type {
  ActivityCardProps, ActivityFact, ActivityItemProps, ActivityMenuProps, ActivityRowButtonProps, ActivitySectionProps,
  ActivityState,
} from './ActivityMenu.tsx'
export { Input } from './Input.tsx'
export { Menu } from './Menu.tsx'
export type { MenuEntry, MenuItem, MenuSeparator, MenuLabel } from './Menu.tsx'
export { useAnchoredMaxHeight } from './useAnchoredMaxHeight.ts'
export { useAnchoredPosition } from './useAnchoredPosition.ts'
export type { AnchoredPositionOptions } from './useAnchoredPosition.ts'
export { useDismissOnOutsidePointer, useDismissOnEscape } from './useDismissOnOutsidePointer.ts'
export { HoverCard } from './HoverCard.tsx'
export { POINTER_GRACE_MS, usePointerGrace } from './pointer-grace.ts'
export type { PointerGrace } from './pointer-grace.ts'
export { Modal } from './Modal.tsx'
export { VideoPlayer, videoPlayerLabels } from './VideoPlayer.tsx'
export type { VideoPlayerLabelKey, VideoPlayerLabels, VideoPlayerProps } from './VideoPlayer.tsx'
export { OnboardingSurface } from './OnboardingSurface.tsx'
export { RiskConfirmation } from './RiskConfirmation.tsx'
export type { RiskConfirmationProps } from './RiskConfirmation.tsx'
export { ConnectionIndicator } from './ConnectionIndicator.tsx'
export type { ConnectionIndicatorState } from './ConnectionIndicator.tsx'
export { AevenMark, AEVEN_MARK_VIEWBOX } from './AevenMark.tsx'
export { BrandWordmark } from './BrandWordmark.tsx'
export type { BrandWordmarkProps } from './BrandWordmark.tsx'
export { ReferenceIcon } from './ReferenceIcon.tsx'
export { extensionOf, fileGlyph, fileKindOf } from './file-kind.tsx'
export { classifyFileType, fileExtension, FileTypeIcon } from './FileTypeIcon.tsx'
export type { CodeFileType, FileType, FileTypeIconProps, FileTypeKind, FileTypeProjectContext } from './FileTypeIcon.tsx'
export type { FileKind } from './file-kind.tsx'
export type { ReferenceIconKind, ReferenceIconProps } from './ReferenceIcon.tsx'
export { projectUserText } from './user-text.tsx'
export { Tooltip } from './Tooltip.tsx'
export type { TooltipSide } from './Tooltip.tsx'
export { Toast } from './Toast.tsx'
export { writeClipboard } from './clipboard.ts'
export { externalWindow } from './external-window.ts'
export { formatDuration } from './duration.ts'
export type { DurationKey, DurationTranslate } from './duration.ts'
export { relativeTime } from './relative-time.ts'
export { rankByName } from './rank-by-name.ts'
export type { RelativeTime, RelativeTimeUnit } from './relative-time.ts'
export { JsonTree } from './JsonTree.tsx'
export type { JsonTreeProps, JsonTreeLabels } from './JsonTree.tsx'
export { BlockHeader, CopyIconButton } from './BlockHeader.tsx'
export type { BlockHeaderCopy, BlockHeaderProps } from './BlockHeader.tsx'
export { TerminalBlock, DEFAULT_TERMINAL_MAX_LINES } from './TerminalBlock.tsx'
export type { TerminalBlockProps, TerminalBlockLabels } from './TerminalBlock.tsx'
export { ReadBlock, DEFAULT_READ_MAX_LINES } from './ReadBlock.tsx'
export type { ReadBlockProps, ReadBlockLine, ReadBlockLabels } from './ReadBlock.tsx'
export { DiffBlock, DEFAULT_DIFF_MAX_LINES, diffTotals } from './DiffBlock.tsx'
export type { DiffBlockProps, DiffHunk, DiffBlockLabels } from './DiffBlock.tsx'
export { SearchBlock, DEFAULT_SEARCH_MAX_LINES } from './SearchBlock.tsx'
export type {
  SearchBlockProps, SearchMatchesBlockProps, SearchPathsBlockProps, SearchFileGroup, SearchBlockLineMatch,
  SearchBlockLabels,
} from './SearchBlock.tsx'
export { WebBlock } from './WebBlock.tsx'
export type {
  WebBlockProps, WebSearchBlockProps, WebFetchBlockProps, WebSourceView, WebBlockLabels,
} from './WebBlock.tsx'
export { CodeBlock } from './markdown/CodeBlock.tsx'
export type { CodeBlockProps } from './markdown/CodeBlock.tsx'
export { JsonBlock } from './markdown/JsonBlock.tsx'
export { MarkdownText, reasoningSource } from './markdown/MarkdownText.tsx'
export { TextAnimationContext, useTextAnimation } from './markdown/animation.ts'
export type {
  MarkdownCodeLabels,
  MarkdownFileMentions,
  MarkdownLabels,
  MarkdownMessageLabels,
  MarkdownReasoningLabels,
  MarkdownTextProps,
  MarkdownVideoLabels,
} from './markdown/MarkdownText.tsx'
export { extractMarkdownPlainText } from './markdown/plain-text.ts'
export type { MarkdownPlainTextMode, MarkdownPlainTextOptions } from './markdown/plain-text.ts'
export * from './icons/index.tsx'

export { MfaForm } from './MfaForm.tsx'
export type { MfaAnswer, MfaFormProps, MfaKey, MfaMode } from './MfaForm.tsx'
