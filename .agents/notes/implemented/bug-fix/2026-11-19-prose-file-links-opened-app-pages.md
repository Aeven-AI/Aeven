# Agent Note: file links in replies opened 404 pages

Status: implemented

English | [中文](2026-11-19-prose-file-links-opened-app-pages.zh.md)

## Problem

A user of the hosted Host clicked a motivation letter the assistant linked in its reply and got chat.aeven.io's 404 page. The reply held `[letter.pdf](Applications/<company>/letter.pdf)`, a workspace-relative path to a file that existed. The engine's `a` component renders every destination unchanged with `target="_blank"`, so the browser resolved the path against the app origin and requested `https://chat.aeven.io/Applications/<company>/letter.pdf`, which nginx logged as a 404. The same session held 15 more links of the shape `[cv.pdf](../attachments/86/<sha256>)`, which the model builds from the `attachmentId` a sharing tool returns; they resolve to `/attachments/…`, which the origin also answers with 404. Only inline-code mentions of files the closing Turn produced were clickable, and `LINK_SAFETY` let relative link destinations through on the premise of a local single-user tool.

## Decision

- `MarkdownText` claims every link whose destination has no scheme, is not protocol-relative, and is not a `#` fragment: the caller's `fileLinks` resolver supplies its URL and opener, and without a resolver or a match the link renders as its text. Web links and footnote jumps stay with the engine's own `MarkdownLink`, which `@aeven/client-hypermarkdown` now exports.
- `ui-deliverables` provides the resolver through `chatFileMentions.forLinks(owner, sessionId)`, and `AssistantNodeView` asks for it in every Assistant step, not only the closing one, since a reply often names a file an earlier Turn made. A path opens like a produced-file pill (`openProducedFile` in `file-links.ts`, now shared by both): sidebar preview, then the Host's opener on a loopback page that can open paths, then a download through `/api/workspace-file`. An `attachments/<xx>/<sha256>` destination downloads that stored copy through `/api/attachment-file`.
- `ui-chat`'s `openFile` resolves a relative path against the workspace root `workspaceFiles.list(sessionId, '')` reports when the session list row has no `cwd`. A chat outside any project has no `cwd` on its row but runs in `~/.aeven/chats`, and the Host's opener resolved the bare path against its own process directory, so the desktop failed with `The file …/.desktop-build/development/project/link-test/letter.pdf does not exist`.
- `tool-bash` records undeclared documents. In a live test the model wrote `letter.html` with the file tools and printed it to `Motivation_Letter.pdf` with headless Chrome without listing `output_files`, so the created-files block showed the HTML and not the PDF. When a foreground command declares no `output_files` but names an extension from `detectOutputExtensions`, the tool lists the workspace before and after the command and records every new or changed file whose extension the command names as a declared output; the block then shows the PDF in place of the HTML. Watching every configured type instead also recorded the `page-1.png` previews a model rendered with `pdftoppm -png` to inspect its PDF and then deleted.
- A click always runs the opener instead of following `href`: in the desktop shell a new-tab request for an `avn-app:` URL goes to the system browser, which cannot load it. The anchor's `href` stays the file URL so copying the link works.

## Alternatives considered

- **Tell the model not to write links to files.** Rejected: the sharing tool's result already says not to repeat shared files in the reply, and the model wrote these links anyway.
- **Resolve only the closing Turn's produced files, as mentions do.** Rejected: the letter was made two Turns before the reply that linked it, so that rule would have left it inert.
- **Open the stored copy in the sidebar.** Deferred: an attachment link names no path whose extension picks a viewer, and the file pills under the reply already preview shared files.

## Consequences

A Markdown surface that renders app-authored relative links and wants them clickable must pass `fileLinks` or write absolute URLs; without one the link reads as text. A path the Host cannot serve downloads as the route's 404 body instead of showing the app's 404 page.
