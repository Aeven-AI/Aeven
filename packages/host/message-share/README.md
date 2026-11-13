---
description: "Public links to shared assistant messages: the messageShare Remote publishes a message to the Aeven API, lists the signed-in account's links, and deletes them."
kind: "package-reference"
---

# @aeven/host-message-share

English | [中文](README.zh.md)

## Summary

`@aeven/host-message-share` lets a signed-in user publish one finalized assistant message, without the prompt that led to it, at a public URL. The Host builds the snapshot from the persisted Session log, never from text a browser sends, and sends it to the Aeven API's `/api/shares` routes with the user's own `AEVEN_TOKEN`; the API files every link under that account and serves it at `/s/<shareId>`. Sharing the same message again refreshes the snapshot behind the same link. The `messageShare` Remote also draws the link's preview card before the link exists, lists the account's links a page at a time, and deletes one or all of them; the browser half is [ui-message-share](../../client/ui-message-share/README.md).

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The `avn-web-app` bundle mounts it with `apiUrl` from `AEVEN_API_URL` and `workspaceMount` set to the `workspace-files` row's mount. It needs `sessionPersistence`, `sessions`, `credentials`, and `identityUsers`; `attachments` and `workspaceRegistry` are read when present.

### Configuration

| Field | Default | Effect |
| --- | --- | --- |
| `apiUrl` | required | Aeven API origin that stores and serves the links; HTTPS, or HTTP on loopback. |
| `credentialRef` | `AEVEN_TOKEN` | Credential holding each user's Aeven access token. |
| `timeoutMs` | `60000` | Budget for one API call. |
| `workspaceMount` | none | Path prefix of the workspace-files route, so a Markdown image served from it is published; omitted, such images are dropped. |
| `maxImages` | `8` | Images one share carries; later images are dropped. Must not exceed the API's `shares.maxImages`. |
| `maxImageBytes` | `4194304` | Largest image one share carries; larger images are dropped. Must not exceed the API's `shares.maxImageBytes`. |
| `imageMaxPixels` | `2560000` | Pixel budget an image content block is scaled down to before it is sent. |
| `imageTargetBytes` | `409600` | Encoded size an image content block is compressed toward before it is sent. |

### Remote methods

| Method | Request | Value |
| --- | --- | --- |
| `create` | `{ sessionId, messageId }` | The link: `shareId`, `url`, `title`, `sessionId`, `messageId`, `createdAt`, `updatedAt` |
| `list` | `{ cursor? }` | `{ items, nextCursor }`, newest first; `nextCursor` is `null` on the last page |
| `delete` | `{ shareId }` | `{ removed: true }` |
| `deleteAll` | none | `{ removed }`, the number of links deleted |
| `preview` | `{ sessionId, messageId }` | `{ mediaType: 'image/png', data }`: the card the link unfurls with, base64-encoded; the API stores nothing |

Every method answers `{ ok: true, value }` or `{ ok: false, error: { code } }`, where `code` is `signed-out`, `session-not-found`, `target-not-found`, `too-large`, `share-limit`, `not-found`, or `unavailable`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### The snapshot

The target is the append-origin `assistant/message` event whose message id matches; an interrupted message is refused. Only that message is published, never a `user/message`, so neither the question nor injected context reaches a public page. Its text blocks become Markdown, followed by its image blocks, and the title is the first line of that Markdown. When a live Session has not yet stored the message, the Host flushes it and reads the log again.

### Images

The Markdown names image `n` as `share-image:n`, and the bytes travel base64-encoded beside it; the API re-encodes them. An image content block is read from the attachment store as a scaled-down copy within `imageMaxPixels` and near `imageTargetBytes`. A Markdown image is published when its source is a file inside the Session's working directory or a registered workspace, either as a path or as a URL on the workspace-files route; the real path must stay inside one of those roots. An `https` or `data:` image stays as written, and any other source keeps only its alt text, because a reader of the public page could not load it.

### Source map

| File | Role |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `MessageShareService`: config, the `messageShare` Remote, Session inspection |
| [`src/snapshot.ts`](src/snapshot.ts) | Finds the message in the log and builds the Markdown, title, and images |
| [`src/api.ts`](src/api.ts) | `/api/shares` client and the mapping of API refusals to failure codes |
| [`src/types.ts`](src/types.ts) | Remote request, value, and failure types |
| — | No runtime invariant companion is published; links live only on the Aeven API, so the Host holds no second observation to check. |

</details>

-----

<a id="model-experience"></a>
## Model Experience

None, as sharing reads the Session log and never adds to it, so no request the model receives changes.

#### KV Cache effect

None; sharing touches no request content.

## Known Limitations and Deferred Work

- **The final step only**: the response is the turn's closing assistant message, the same text the copy action takes; text the model wrote in earlier steps of the turn is not published.
- **A deleted link may stay in caches**: chat apps and social sites keep the preview card they fetched, and the API serves images with an hour of caching.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
