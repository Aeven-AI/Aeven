---
description: "Produced-files and clickable file references for the Web GUI: the deliverables row a finished turn ends with, and inline-code links in the closing prose; for users and maintainers of the deliverables experience."
kind: "package-reference"
---

# @aeven/client-ui-deliverables

English | [中文](README.zh.md)

## Summary

This package renders the deliverables row a finished turn ends with — the files the mutation tools created or modified — and links matching inline-code references in the closing prose, so a mentioned file opens in the Host. The vocabulary comes from the mutation tools' own `locations`, never from the closing prose — a produced file is listed whether or not the model remembered to name it. The shipped Web patch is the only composition that loads this package; removing its cordis.yml entry removes the guidance, row, and prose links together.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin alongside `ui-conversation`; a finished turn then ends with the produced-files row between the closing message's body and its action footer. New-file pills and edited-file rows preview the selected file in the Files sidebar through `sidebarFiles.open`, handing it the file's stored copy when the result recorded one, so a media file another device wrote plays there; a non-text file without a sidebar viewer opens in the default app when the page is loopback and the Host can open paths, and otherwise downloads its stored copy through `/api/attachment-file` when the result recorded one, such as a conversation another device of the account runs, and through `sidebarFiles.fileUrl` when it did not. A produced video or audio file also plays in place above the tables, from its stored copy when one is recorded and from `sidebarFiles.fileUrl` otherwise; a file neither source can serve keeps only its row. A produced image is drawn above the tables the way a generated image is: through the conversation's image renderer (`renderImages` of the turn-tail owner) in a 3:2 or 2:3 frame, a lone landscape image across the column and a lone portrait in two thirds of it, from the full image reference of the copy any tool result of the Turn shared. An image whose reference the Turn does not carry shows from its stored copy's URL, and one neither source serves returns to its row. The `produced-images` Turn data index this plugin publishes names the images a Turn's commands declared, so once the Turn closed a reply that shows one of them through its stored copy leaves it to the tail. A file the closing message mentions opens the way its row does: the Files sidebar with its stored copy first. On the desktop, a file whose path is missing on this Host downloads its stored copy instead of opening the refusal dialog, and a prose link naming only the tail of exactly one produced path, such as its basename, opens that produced path. A Turn whose commands declared `output_files` lists only those outputs, so a resume's `cv.json` or a deck's `deck.json` stays out of the row and the prose links. Inline mentions use the Host opener, with relative paths resolved against the session cwd, except that a page which is not loopback downloads a file's stored copy when the result recorded one; when the row first appears, it queries `session.canOpenWorkspacePath()`, and an omitted-file **Show in folder** action opens the session workspace only when the page is loopback and that query succeeds with `true`.

### The row

Created and edited files use the same table layout, with four rows shown before the fold. Created files have a separate table without added/deleted line counts; edited files retain per-file and total counts. Each row shows the file icon and path, and opens or focuses the file in the sidebar when supported.

### Inline-code links

The closing prose carries the same vocabulary: an inline-code token resolves by exact path, or by being exactly the basename of exactly one produced path — a basename two paths share stays inert rather than guessing, so a mention can never open the wrong file. A resolved mention keeps its code chip and takes the markdown sheet's link language, with the full path as its title.

A Markdown link whose destination is a path, in any assistant step and to any file, opens the way a produced file does: the Files sidebar previews it, the Host opens it when the page is loopback and can open paths, and otherwise the browser downloads it through `sidebarFiles.fileUrl`. Paths inside the session cwd resolve relative to it. A path naming a file the step's Turn produced with a stored copy opens from that copy, as its pill does, so a conversation another device ran still opens it on a page whose Host cannot read that device's folders. A destination of the shape `attachments/<xx>/<sha256>`, which models write after a tool shares a file, downloads that stored copy through `/api/attachment-file`.

On the desktop, that chip and the row's chips also answer a right-click: the menu the Electron shell draws offers the desktop's own handler for the file, the file manager, and the file's relative and absolute paths, with the handler list queried for that file as the menu opens. Served over HTTP no menu is intercepted, so the platform's own right-click menu stands.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Node half registers the static `ui:deliverable-file-references` system-prompt section asking the model to mention primary files from successful creation or modification calls and to write those and any other changed-file references as Markdown inline code. The browser half registers `ProducedFiles` into the chat view's `conversation.chat.turnTail` hole. `deliverablesDefinition` folds each Turn's successful first-party mutation calls into `DeliverablesTurnData` from the validated raw arguments of `write`, `edit`, and mutating `str_replace_editor` commands. Reads, deletes, unsupported tools, malformed calls, and failed results contribute nothing. A new mutation tool needs an explicit Client contribution before it joins the list. The package also provides the `chatFileMentions` service the chat view consults per closing message for mentions and per Session for path links; composing the plugin out removes both surfaces and leaves the view's empty chain at zero cost. Tool results may also contribute verified `producedFiles` metadata with each path and its creation status; `bash` records it for declared outputs of any format. The Client does not infer files from shell output or assistant prose. A Turn whose `turn/start` the loaded history window lacks has no `deliverablesDefinition` data, so the row and the prose links read that Turn's files from the Host's `turnDeliverables` projection (`@aeven/session-turn-outline`), which folds the whole log with the same readers.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the deliverables surface is not enough. They move from the row to the turn-tail hole and the decisions behind the vocabulary.

- [ui-conversation](../ui-conversation/README.md) — declares the `conversation.chat.turnTail` hole and renders the closing prose.
- [Workspace file links](../../../.agents/notes/implemented/feature/2026-07-31-web-workspace-file-links.md) — the decision behind the produced-files row and the Host open path.
- [Inline file mentions](../../../.agents/notes/implemented/feature/2026-08-07-web-inline-file-mentions.md) — the decision behind clickable mentions in the closing prose.
- [Client package map](../README.md) — adjacent browser UI packages.

-----

<a id="model-experience"></a>
## Model Experience

### Clickable file-reference guidance

#### What the model sees

One fixed paragraph instructs the model to name primary files from successful creation or modification calls in its final response and to format those and any other changed-file references as exact-path or unique-basename Markdown inline code, such as `out/report.html`.

#### Token effect

One fixed prompt paragraph whenever this package is loaded; no tool schema, tool result, or per-Turn context is added.

#### KV Cache effect

The section is static at first-party order 9000 for the lifetime of the package mount, so it remains in the reusable prompt prefix and does not change across Turns.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the current deliverables vocabulary. They are current package constraints, not a general file-linking comparison or a task backlog.

- **Mention matching is exact path or unique basename only** — a suffix mention stays inert; widening the matcher is deferred until a real closing-message shape needs it.
- **Files created indirectly by terminal commands remain outside the matching vocabulary** — naming such a file in inline code does not make it clickable unless a successful mutation location also records that path.
- **Native folder handoff targets the Host desktop** — a browser reached through a non-loopback authority omits the action, as does a deployment reporting no native opener; SSH forwarding that makes a remote Host look loopback-local must set the Session Controller's `nativeOpen: false`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The prompt section, slot, dictionary, event definition, and optional service registrations are effect-owned with disposal proven by their plugin specs; this package owns no mutable state.
