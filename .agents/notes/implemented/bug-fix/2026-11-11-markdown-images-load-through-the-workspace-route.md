# Agent Note: Markdown images load through the Session's workspace route

Status: implemented

English | [中文](2026-11-11-markdown-images-load-through-the-workspace-route.zh.md)

## Problem

A reply that embedded a picture the Assistant had just made showed no picture on hosted Web. `![](logo-out/aeven-mark.png)` — the shape a model writes for a file in the workspace it is working in — became its alt text, and an image with an empty alt became nothing at all, so the reader and the model both took the reply for fine.

Two rules met in that gap. The renderer's image resolver accepted only `https:` sources and absolute local paths, building `/api/file?path=…` for the latter; `LINK_SAFETY.allowedImagePrefixes: ['https://', '/']` refused a workspace-relative source before the resolver saw it. And a Host that serves several accounts mounts no `/api/file` at all: `pathReads: false` skips `SessionMediaReferences`, since that route reads any path the process can ([hosted reads note](2026-11-06-hosted-reads-name-a-session.md)). So the only URL the resolver could build was unmounted, and the only source shape that Host could serve was refused. On a single-account desktop Host the same markdown worked, because `/api/file` exists there and the absolute path in the first attempt at least reached a route.

## Decision

`ui-chat` resolves every local image an Assistant writes to the Session-scoped `/api/workspace-file?sessionId&path` route, which both profiles register: `workspaceImagePath` names the file inside the workspace (stripping the workspace root from an absolute path under it, keeping a relative path as written), and `assistantImageUrl` prefers the durable copy an earlier `read_image` stored, then the workspace URL. A source with a scheme, a protocol-relative source, and an absolute path outside the workspace resolve to undefined, so their own resolver still decides. `workspaceFileUrl` moves to `@aeven/client-ui-primitives`, where the Files sidebar and the Chat share one shape.

`hypermarkdown` gains `allowRelativeImages` (default `false`) on `linkSafety`: a scheme-less, rootless image source passes when the host declares it resolves those itself. It covers images only, never links, and never a protocol-relative source. `ui-primitives` sets it for assistant Markdown, whose resolver is the gate that turns the source into a workspace URL or alt text.

## Alternatives considered

**Serve `/api/file` on hosted too, confined to the caller's folders.** Rejected in the [hosted reads note](2026-11-06-hosted-reads-name-a-session.md): the route carries no Session, so confinement needs a second account-to-folder rule beside the one the workspace routes already resolve.

**Have the Assistant write only absolute paths.** A model cannot know a hosted workspace's absolute path — it differs per account and per device — and the note above still records that such a path does not load on hosted. Telling the model to write absolute paths would keep the workspace shape refused while pointing it at a route that is absent.

**Copy every embedded image into the attachment store and rewrite the markdown.** This would give the picture a durable path the existing route serves, but it changes what the model wrote, doubles storage for images the workspace already holds, and needs a model-visible rewrite pass over every reply.

**Open `allowedImagePrefixes` to `['*']`.** The resolver would still refuse everything it cannot serve, but the sanitizer would stop being a second opinion at all; the argument for the narrow flag is that the new permission is named and testable.

## Consequences

A picture an Assistant writes into the workspace now renders on hosted Web and on desktop, whether the source is relative or absolute inside the workspace. A source that names a file outside the workspace still shows its alt text on hosted, because no route serves it. The unresolved case remains silent — `MarkdownImage` renders alt text with no marker — so a wrong path is still invisible to the reader; making that state visible is deferred.

## Verification

`packages/client/ui-chat/tests/workspace-images.client.spec.tsx` covers the source shapes (relative, absolute inside and outside the workspace, `https:`, `http:`, `data:`, protocol-relative, percent-escaped, no known workspace root), the stored-copy preference, and one render through the markdown engine asserting the `img` src. `packages/client/hypermarkdown/tests/unit/security/link-safety.client.spec.ts` covers the relative allowance on and off and the protocol-relative exclusion; the sanitize spec pins the new default. `pnpm run test:gui` and the typecheck pass.
