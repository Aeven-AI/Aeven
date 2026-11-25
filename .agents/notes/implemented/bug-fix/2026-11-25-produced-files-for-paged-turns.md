# Agent Note: long turns lost their created-files block, and HTML previews could not run ES modules

Status: implemented

English | [中文](2026-11-25-produced-files-for-paged-turns.zh.md)

## Problem

On 2026-11-25 the conversation `session-45df5e4a…` built a three.js page in `~/Documents/Aeven/vase-reassembly`. The whole conversation is one turn: one `turn/start` at seq 5, `turn/end` at seq 213306, 25 human messages spliced in while it ran, and a 7 MB log. The desktop window that watched the run showed the created-files block; the same conversation opened on chat.aeven.io, on localhost:3080, or in a reloaded desktop window showed none. The follow snapshot carries the last 50 messages, so the client held the turn's closing message without its `turn/start`. The client `deliverables` Definition starts from `turn/start`, so the turn had no produced-file data until every older page was scrolled in.

The same run surfaced two more faults. Its deliverable, `porcelain-reassembly.html`, was written by `node build.mjs`: the command declared no `output_files`, the `output_files` description named PDF, DOCX, spreadsheets, and images but no built page, and undeclared-output detection watches no HTML. The Files pane preview of `index.html` drew no scene: it inlined classic scripts only, so the page's import map and its `./src/*.js` module graph could not load in a frame with an opaque origin, and the preview was built from the text view's capped page.

## Decision

- `@aeven/session-turn-outline` registers a second unit, `turnDeliverables`: every turn's produced files folded from the whole log, per turn by path and declaration. The fold uses the readers in `src/produced.ts`, which `./client` exports and the client `deliverables` Definition now imports, so the Host and the client list the same files.
- The turn-tail selector claims a turn whose `turn/start` is not loaded and whose Definition holds no data; `ProducedFiles` then reads that turn's entry through `useProjection('turnDeliverables')`, and the prose mention and link resolvers read the same value through `ctx.get('sessions')`. A loaded turn keeps the Definition's exact data.
- The `output_files` description names a built HTML page, and `html`/`htm` join `detectOutputExtensions`, so a command that names an `.html` path records it.
- The preview inlines a page's workspace ES modules: each module reached through a relative import or the page's import map becomes one `data:` URL under a generated import map, and every specifier names that map's key. Specifiers are found with `es-module-lexer`'s asm.js build. The preview reads the page's own bytes rather than the capped text page.
- The runtime context and the CV and slides skills tell the model to save the files it makes in the session workspace, one folder per piece of work; the Aeven folder line only names the folder that syncs. The conversation above had the Aeven repository as its workspace and was told to save in `~/Documents/Aeven`, so the Files tree never showed its work. A conversation without a folder of its own works in `~/Documents/Aeven/chats`, so its files still sync.
- The Files pane opens a file without an "outside the workspace" note, and the text read drops the `outsideWorkspace` field, whose only consumer was that note.
- Opening a file reuses a Files pill that shows only the tree before adding one. Pills survive a reload while the file each shows lives in browser memory, so every reload followed by an open added a pill.

## Alternatives considered

- **Extend the opening page back to the cut turn's `turn/start`.** Rejected: for this conversation that loads the whole 7 MB log on open.
- **Send the folded prefix of the cut turn with each history page.** Rejected: it adds wire fields to the follow snapshot and every page, and the assembler would need a seeded start; the projection registry already delivers, caches, and live-updates whole-log folds.
- **Watch HTML in a command's folders without the command naming it.** Rejected: the CV skill renders `cv.html` in one command and exports PDF, Word, and Pages in the next, so its intermediate page would be listed beside the documents.
- **Nest each module's dependencies as `data:` URLs inside its own `data:` URL.** Rejected: a module that six others import, such as three.js, would be embedded six times, with base64 growth at each level.

## Consequences

The created-files block appears for a long turn on every device and after every reload, at the cost of one more whole-value projection pushed when a mutation result lands; heavy local sessions hold under 200 entries. A build script that writes an HTML deliverable without naming it is recorded only when the model lists it in `output_files`. A page that fetches workspace files at run time, or builds module URLs from `import.meta.url`, still cannot reach them inside the sandboxed preview.
