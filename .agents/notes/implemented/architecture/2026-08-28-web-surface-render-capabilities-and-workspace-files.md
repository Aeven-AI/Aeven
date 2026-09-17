# Agent Note: The Web surface states what it renders, and serves the files a reply references

Status: implemented

English | [中文](2026-08-28-web-surface-render-capabilities-and-workspace-files.zh.md)

## Problem

Assistant replies in the Web GUI render through `MarkdownText`, which draws ` ```mermaid ` fences as diagrams, renders KaTeX math, and displays `![alt](url)` images from absolute `http`/`https` URLs. No model-facing text said so. The `app:web-surface` prompt section described servers, HMR, and rebuilds, and opened with "The browser provides no implicit DOM, route, or screenshot context" — which reads as a surface with no rendering ability at all.

A model with no statement of its output surface guessed, and guessed differently from run to run. Recorded sessions show both failure directions. Asked for a diagram, a session reached for `cordis_define` to build a Client plugin, because the Cordis section's routing rules claim work whose "requested outcome is visual" and nothing named the cheaper path. Asked for an image, a session downloaded the file, reported a filesystem path, and stated "I can't inline images into the chat text itself — the GUI's message renderer doesn't embed image content from replies." Later in that same session, after reading the renderer, it corrected itself and emitted `![dog](https://…)`, which rendered. The capability never changed; only the model's belief about it did.

The image case had a second, real half. A file the agent produces has no URL, and the renderer refuses filesystem paths and `data:` URIs, so a correct instruction alone cannot make a produced file visible. One recorded session solved it by starting a throwaway static server on port 8787 and referencing `http://127.0.0.1:8787/weather.png`.

## Decision

**The surface prompt states what the surface renders.** `webSurfacePrompt` now says replies render as GFM, that a mermaid fence becomes a diagram and math renders through KaTeX, that images display from absolute `http`/`https` URLs while filesystem paths and `data:` URIs are refused, and that the model must never claim it cannot display an image or diagram inline. The `WEB_SURFACE` section is the correct home because this is a property of the surface, not of an agent: it mounts only for `avn web`, so the statement is absent on the CLI, where none of it renders.

This is deliberately not an agent-preset persona rule. A persona travels with the agent into surfaces where the claim is false, and a user preset forking a shipped preset to carry one sentence makes every upstream preset change a manual merge.

**`avn-host-workspace-files` gives a produced file a URL.** One authenticated prefix route serves `<mount>/<workspaceId>/<relative path>` from a workspace's canonical directory. `ctx.connection.requestRejection` runs before any path handling, so an unauthenticated caller cannot distinguish a real workspace id from an invented one. Traversal outside the directory is 403, unknown id and absent file are both an empty 404, non-GET/HEAD is 405.

**The exposure is whole-directory and deliberate.** Every file under the workspace is readable by a holder of a browser session. A narrower published subtree was considered and rejected for now: it requires the agent to copy artifacts into a publish directory, which is the step models forget, and the failure would be silent — a broken image rather than an error. A deployment that cannot accept the exposure removes the row and the prompt's workspace-URL sentence with it.

## Verification

The package's real-composition suite boots webserver, Connection, a stub registry, and the row through the Loader, then asserts over the served HTTP surface: 401 before any path handling for both real and invented ids, content types and safety headers, a rewritten file served fresh, 404 for unknown id / missing file / directory, 405 for POST, and route release on entry disposal.

Traversal coverage documents a two-stage normalization. A plain `../` never reaches the route — `new URL()` collapses it, leaving a path that addresses an unregistered id — so the assertion for it is 404. An encoded slash (`..%2f`, `%2e%2e%2f`) survives URL parsing and becomes a `..` segment only when the handler decodes the pathname; those are the requests the resolved-prefix check rejects with 403, and they are what proves the fence is load-bearing.

The surface prompt's full text is pinned byte-for-byte in `web-app.spec.ts` against the same fixture the Web e2e smoke uses, so a wording change that skips the fixture fails in `pnpm run test` rather than only in the keyed e2e.

## Consequences

The Web surface prompt grows by one paragraph, so every Web session's system prompt changes and its prefix cache is invalidated once on upgrade.

`avn web` now exposes workspace contents to an authenticated browser session. This is a real increase in what a leaked session cookie reaches, and it is the reason the exposure paragraph sits in the package README rather than only in this note.

The prompt's workspace-URL sentence and the `workspace-files` row are one unit: removing the row without removing the sentence leaves the model building URLs that 404. Both live in `packages/bundle/web-app`, and the README states the pairing.

A model that still reports a filesystem path for a produced image, or declines to draw a diagram, is now a prompt-adherence failure with a pinned expected text to check against, rather than an unstated capability the model had to infer.

## Alternatives considered

**A persona or user-preset rule.** Rejected as the permanent fix: wrong scope (it follows the agent onto surfaces where it is false), and it forks a shipped preset to carry a deployment fact. It remains a legitimate local stopgap, provided the wording names absolute `http`/`https` URLs — an instruction that says only "reply with a markdown image link" produces confident `![dog](/Users/…/dog.jpg)` output that silently does not render.

**Enable `data:` image URIs in `LINK_SAFETY`.** One line, no server work, and rejected: base64 in a reply is model-visible, and the model-visible-implies-logged rule then persists every displayed image into the session log.

**Leave the ad-hoc static server.** Rejected: it works, as a recorded session shows, but it spends a turn, leaks a process, binds an unmanaged port, and serves without authentication.

**Narrow the Cordis section's visual trigger instead.** Insufficient alone. It would stop the diagram detour without telling the model what to do instead, and it does not touch the image case at all.
