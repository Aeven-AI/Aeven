---
description: "Share action for the Web GUI: the share button before branch in the assistant message's action row, the share dialog with its thumbnail and link, and the link manager."
kind: "package-reference"
---

# @aeven/client-ui-message-share

English | [中文](README.zh.md)

## Summary

This package adds sharing to the Web GUI. It contributes the `share` entry of the finalized assistant message's action strip, a lucide `share-2` button directly before branch. The button opens a dialog that says the link makes the response public, shows a thumbnail of the response, and offers **Manage** and **Create link**. Create link publishes the message through the `messageShare` Remote of [host-message-share](../../host/message-share/README.md) and copies the URL, or opens the system share sheet on a touch device; while it works, a spinner takes the place of its link glyph and the button keeps its width. Manage, titled **Created links**, lists every link the signed-in account created, loading more as the list scrolls, with a delete action per link and a confirmed **Delete all links**.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin alongside `ui-conversation` and the Host's `host-message-share` row. The share button appears in the action row of each turn's closing assistant message, after feedback and read aloud and before branch. The dialogs are the product's `Modal`; every string lives in the `share` locale namespace in Chinese, English, and Spanish.

### Failures

A refused share shows the failure under the thumbnail, and the dialog stays open. A failed page load in the link manager shows the failure with a retry action; a failed delete leaves the row in place.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package registers the `share` entry (order 30) of `conversation.chat.assistant-actions`. Its injected face binds the Session id into four verbs over `ctx.remote.messageShare` and folds a carrier failure into the `unavailable` code. The thumbnail is a copy of the turn's rendered closing `assistant-step` flow row, found by their `data-chat-turn` and `data-chat-flow-kind` attributes when the dialog opens; controls are stripped, the copy is inert, and it is drawn at half size. The link manager pages with the API cursor and loads the next page when a sentinel below the last row enters the list's scroll area.

| File | Role |
| --- | --- |
| [`src/client/index.ts`](src/client/index.ts) | Plugin entry: dictionaries and the slot entry |
| [`src/client/ShareAction.tsx`](src/client/ShareAction.tsx) | The button and which dialog is open |
| [`src/client/ShareDialog.tsx`](src/client/ShareDialog.tsx) | Share dialog: thumbnail, link field, Manage and Create link |
| [`src/client/ManageLinksDialog.tsx`](src/client/ManageLinksDialog.tsx) | Link manager with paging, per-link delete, and delete-all confirmation |
| [`src/client/ShareThumb.tsx`](src/client/ShareThumb.tsx) | Captures and draws the thumbnail |
| [`src/client/locales.ts`](src/client/locales.ts) | `share` dictionaries |

</details>

-----

<a id="model-experience"></a>
## Model Experience

None, as sharing never enters the Session log, the model context, or telemetry.

#### KV Cache effect

None; sharing touches no request content.

## Known Limitations and Deferred Work

- **The thumbnail needs the rendered rows**: when the response row is not in the DOM, the thumbnail shows the share glyph instead.
- **Chat view only**: the trajectory and waterfall views render no share action.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The plugin owns one slot registration and one dictionary registration, both released by their effects, so no second authority exists to check at runtime.
