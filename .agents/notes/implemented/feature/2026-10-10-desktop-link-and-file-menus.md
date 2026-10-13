# Agent Note: The desktop window opens links through the client, and the client describes its own right-click menus

Status: implemented

English | [中文](2026-10-10-desktop-link-and-file-menus.zh.md)

## Problem

In the desktop window, a click on a link in a reply did nothing. The markdown engine renders every ordinary link as `<a target="_blank">`, so the click arrived on Chromium's window-open path, and the shell denied every window the page asked for; the navigation guard stopped the in-place arm the same way. Nothing in the client routed a transcript link anywhere, and the shell's right-click menu offered only Copy Link, so a reader had no way to reach a link's destination at all.

The other half was missing rather than broken. A produced file named in a reply — and the row of the produced-files card — is clickable, but its only action was "open in the desktop's default application". A reader who wanted the file revealed in the file manager, opened in a particular editor, or to take its path away had nowhere to go, and the window's own right-click menu could not help: Electron's `context-menu` event carries a link and an image, not "which of this application's elements the pointer is on".

## Decision

**One policy owns where a link lands, and it lives in the client.** `installLinkHandling` (ui-sidebar-browser `src/client/links.ts`) is installed only where the desktop shell provides its bridges; served over HTTP a tab opens the link itself, which is what a browser already does. Its three destinations are the session's browser pane in the right sidebar, the Chromium the agent's DevTools tools drive (`remote.browserChromium`), and the operating system's default browser. The system-browser destination prefers the driven Chromium, because the reader of an agent harness wants the agent to see the page it was shown, and falls back to the shell's `openExternal` when no Chromium answers.

**The shell reports addresses instead of opening them.** `openContentAddress` (`apps/desktop/src/external-links.ts`) is what the window's open handler and its navigation guard call. A page that subscribed through `links.onOpen` receives the address and performs the open itself; any other page — the shell's own windows, a Host served by another build, and every non-`http(s)` scheme — keeps the operating-system handoff. The subscription itself is the signal (`DESKTOP_IPC.linksListen`, sent once by the preload), so the fallback needs no timeout and no acknowledgement.

**The app page describes its own right-click menus, and the shell draws them.** `contextMenu.show(rows)` (`DESKTOP_IPC.appMenuShow`) pops a native menu built from validated rows and settles on the id of the row the reader chose, or null when the menu was dismissed. `appMenuRows` (`apps/desktop/src/app-menu.ts`) refuses a list that is empty, oversized, malformed, carrying a repeated id, or separated by a separator with nothing to separate. The renderer suppresses the platform's own menu on the elements it answers for, which is what keeps exactly one menu up: Electron emits its `context-menu` event only for clicks the page does not prevent (measured against Electron 44 in a probe, since the platform's documentation does not state it).

**Two surfaces use the menu, and each builds its own.** A right-click on a link that leaves the application offers the three destinations above plus Copy Link (ui-sidebar-browser); a right-click on a produced file offers the desktop's own handler for it, the file manager, and the file's relative and absolute paths (ui-deliverables `src/client/file-menu.ts`). Both build rows from their own typed dictionary, so the copy stays locale-owned, and both are absent — no interception, no menu — where no desktop shell is present. `MarkdownFileMentions.resolve` gained an optional `menu` for the prose side; the produced-files row wires the same handler as an `openFileMenu` injection.

**A produced file's absolute path is resolved where the row already knows the workspace root.** `resolveWorkspacePath(cwd, path)` turns the authored spelling into the Host path the handoffs take, exactly as the row's own opener does, and the application list is queried for that file when the menu is opened rather than cached: the desktop's handlers change while the application runs.

## Alternatives considered

**Let the shell own the whole link policy and call `shell.openExternal` itself.** This was the first cut, and it is smaller: one function, two call sites, no channel back into the page. It loses the driven Chromium, which is the browser a reader of this application actually has in front of them, and it would put a second copy of "where links open" in the shell beside the client's sidebar browser. The address is now reported to the page, which owns the choice.

**Route the click from the markdown engine's anchor.** `link.tsx` could `preventDefault` and call a bridge directly. It would cover assistant prose and nothing else — links in tool cards, settings, the docs pane, and the media lightbox all render through other code — and it would put desktop-shell knowledge into the rendering engine that treats its source as untrusted. The document-level listener in the browser plugin covers every anchor in the window with one rule.

**Keep the shell's `Link` row and add the file menu from the renderer.** The shell's `context-menu` handler already builds a template from `ContextMenuParams`, so Copy Link could stay there. Two menus would then be up at once for a file right-click: the shell's own handler fires for any click the page does not prevent, and the renderer cannot prevent it in time to stop a menu the shell has already decided to show. One owner for the menu is what makes the row set complete.

**Draw the menu in the renderer, as an HTML menu.** A web app can do this anywhere, and it needs no IPC. It renders inside the window and behaves like a page element, not like the rest of the desktop: no native keyboard navigation, no native dismissal, and a menu that scales with the page zoom. The shell draws the menu; only the rows come from the page.

**Offer the whole application list for a file, as the Files sidebar does.** The attachment's menu names exactly one application. A submenu of every handler on the desktop is the Files sidebar's job, where the reader is browsing the workspace inside them; in a reply it would put a list of editors between the reader and the file they clicked.

## Consequences

Links in the desktop window now open in a browser, and a right-click on one offers the two browsers this application has beside Copy Link. Produced files gained a right-click menu without gaining a list of applications no reply asked for.

The shell can no longer be the only party that knows where an address went: with the page listening, a click in the window is opened by the client, so a Host served by a build that never subscribes keeps the older behaviour instead of losing the click. The row contract is the price: a menu is now a small wire format (`DesktopMenuItem`) with validation on the shell side, and both client surfaces restate it structurally rather than importing the shell's type, since a client package cannot import the desktop application.

Copy Link writes through the client's own `writeClipboard`, which the code-block and read-block controls already use; it prefers the async Clipboard API and falls back to `execCommand`. The shell's own menu keeps its main-process clipboard write for the pages that do not describe menus (guests, and the shell's own windows).

## Testing

`apps/desktop/tests/app-menu.spec.ts` pins the row validation: what is kept, and each refusal (empty, oversized, malformed, repeated id, dangling separator). `ui-sidebar-browser/tests/links.client.spec.ts` covers which right-clicks the client answers for, the three rows and where each leads, the shell's report landing in the system-browser destination, dismissal, disposal, and a shell that refuses the menu. `ui-deliverables/tests/file-menu.client.spec.ts` covers the rows, the Host handoffs, both path spellings, the application query failing, a refused handoff, and the bridge being read only where a desktop shell exists. `ui-primitives/tests/markdown.client.spec.tsx` and `ui-deliverables/tests/produced-files.client.spec.tsx` cover the mention and row wiring, including that no menu is intercepted where none is offered.

The right-click suppression this rests on was measured, not assumed: a probe under Electron 44 dispatched a right-click at a `preventDefault`ing element, a plain element, and an anchor, and the main process received `context-menu` for the last two only.
