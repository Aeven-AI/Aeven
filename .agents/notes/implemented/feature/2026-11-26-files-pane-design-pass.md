# Agent Note: Files pane design pass

Status: implemented

English | [中文](2026-11-26-files-pane-design-pass.zh.md)

## Problem

Issue #810 found the right sidebar's Files pane ([`@aeven/client-ui-sidebar-files`](../../../../packages/client/ui-sidebar-files/README.md)) inconsistent once a file was open. A 4px gap split the file from the docked tree, and the HTML preview, which has no side padding, ran into that gap while the text view kept 24px. The dock's width was fixed. A second bar under the file bar repeated the file's extension beside the preview and copy controls, and the file bar and toolbar carried back, forward, and collapse-all controls whose effect readers could not predict. Icon buttons showed only native `title` tooltips.

## Decision

- **Split spacing.** The split has no gap. Beside the docked tree the file's bar and text body keep 16px on the right, and the rendered page stops 16px short of the tree, so neither the bar's controls nor the tree move when the view toggles.
- **Resizable dock.** A zero-width strip on that 16px line drags the dock's width, and Left and Right arrow keys step it by 16px. The width is remembered per session and surface with the rest of the explorer's state. `DOCK_FLOOR` (240px) and `FILE_FLOOR` (380px) in `FilesPane.tsx` bound both the drag and the CSS width, and their sum is the pane width from which the tree docks. The strip shows the conversation width handle's 1px rule on hover, focus, and drag.
- **One file bar.** The extension and copy bar is removed. The HTML view toggle sits in the file bar and shows the view a press switches to: lucide `tv-minimal-play` from the source, `code` from the rendered page. Close leads the bar with its glyph on the Files tab glyph above.
- **Removed controls.** Back, forward, and the surface's file history behind them, and collapse-all, are removed; folders still collapse one at a time.
- **Tooltips.** Every icon button in the pane uses the shared `Tooltip` primitive in place of a native `title`.
- **Loading.** A loading folder, search, file, or page render shows the shared `Spinner` at its default size in place of loading text, with that text as the status's accessible label.

## Alternatives considered

**Padding the dock by 16px beside the rendered page** was rejected: the tree's contents shifted whenever the view toggled. **Widening the dock by 16px instead** kept the tree still but moved the file bar's controls. **A drag handle centred on the tree's edge** was rejected because its hit area overlapped the tree's search field and placed the rule off the preview's edge. **Keeping the file history without its buttons** was rejected because nothing else read it.

## Consequences

A dragged dock width resets on reload, as the open folders do. The pane offers no copy-file control; Download and Open with remain. A file opened from the tree no longer returns to the previous file except by opening it again.
