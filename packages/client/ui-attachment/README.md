---
description: "Attachment presentation for the conversation UI: draft-image rail, document drop target, history-image gallery, and original-image lightbox; for users and maintainers of the Web attachment experience."
kind: "package-reference"
---

# @aeven/client-ui-attachment

English | [中文](README.zh.md)

## Summary

This package renders everything the conversation UI shows about attachments: the draft tray in the composer, a full-viewport drop invitation, sent attachments in Chat and Trajectory, and the image gallery. It is a pure presentation layer — attachment data, image loading, and callbacks come from the conversation package through declared slots. Choose it for the Aeven web client's attachment experience: images and files share one tile grid in the composer and in the sent message.

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

Mount this plugin alongside [`ui-conversation`](../ui-conversation/README.md); it waits for the conversation package's slot declarations and registers its surfaces into them. Users then see the draft tray with per-tile remove and click-to-open, the drop overlay with its limits line, sent attachments as a tile grid inside the user message, and the image gallery.

### Draft tray

Draft attachments show as 80px tiles, five per row, wrapping: images first as cover thumbnails, then files with their type icon and name. An uploading file shows a spinner and a failed one shows an error tile. Clicking an image opens the gallery over all draft images; clicking a file opens its bytes in a new tab.

### Sent attachments and the gallery

A user message with attachments (`layout: 'tray'`) renders one card: the tile grid on top and the text below, with a minimum width of one fifth of the column per tile up to five. A submission echo shows the same tiles from its local previews. Assistant, tool, and Trajectory images (`layout: 'gallery'`) keep the count-sized gallery: a lone image at 240px on its longer edge, several as 64px squares. The gallery fills the viewport with the selected image, offers an info popover (type, size, name), download, and close, and previous/next when there is more than one image; Escape closes it and the arrow keys wrap through the images. An image tile shows the enlarge pointer and opens that gallery over every image of its Turn; the info name is the stored file name, or one derived from the attachment digest while it stores none.

### Drop overlay

While a file drag is over the page, the full-viewport overlay announces the drop: illustration, title, and a limits line when drops are accepted. The overlay only shows state — the owner's document-level listeners decide accept or reject.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin waits for `conversation.input.attachments`, `conversation.message.images`, and `conversation.trajectory.images` through `ctx.slots.inject`. It then registers the composer tray, document drop target, and the sent-attachment renderer for Chat and Trajectory; every image opens the ui-primitives gallery. The presentation components are pure props: the conversation slot owner supplies attachment data, image loading, callbacks, and the locale translator; the package entry exports no components.

| File | Role |
|---|---|
| [`src/client/ComposerAttachments.tsx`](src/client/ComposerAttachments.tsx) | Draft-image rail + drop overlay assembly |
| [`src/UploadTray.tsx`](src/UploadTray.tsx) | Wrapping image and file tile grid for the composer and the sent message |
| [`src/client/MessageImages.tsx`](src/client/MessageImages.tsx) | Sent-message tray or count-sized gallery, by the owner's `layout` |
| [`src/MessageImage.tsx`](src/MessageImage.tsx) | Single image sizing, load/retry, click-to-open; local submission-echo previews render their object URL directly |
| [`src/message-image-entry.ts`](src/message-image-entry.ts) | Lightbox entry metadata — display name, media type, byte size — shared by the tray and the gallery |
| [`ImageLightbox`](../ui-primitives/src/ImageLightbox.tsx) (ui-primitives) | Document-level image gallery with info, download, and previous/next |
| [`src/DropOverlay.tsx`](src/DropOverlay.tsx) | Pointer-inert drag invitation portal |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the attachment surface is not enough. They move from the slots this package fills to the conversation shell that owns the input flow.

- [ui-conversation](../ui-conversation/README.md) — declares the attachment slots and owns the composer and image intake.
- [Web client architecture](../../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.md) — how browser plugin rows load and register slots.
- [Client package map](../README.md) — adjacent browser UI packages.

-----

<a id="model-experience"></a>
## Model Experience

None, as the plugin only renders attachment state supplied by the conversation UI and contributes no model-visible input.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the current attachment surface. They are package constraints, not a general image-viewer comparison or a task backlog.

- **Echo files do not open** — a submission echo's file tile has no stored original until the Host admits the message, so clicking it does nothing.
- **No zoom in the gallery** — the image renders at fit-to-viewport size only.
- **The gallery does not trap focus** — it sets `aria-modal` and restores focus on close, but Tab can reach the page behind it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The package contributes only effect-owned slot entries; the slot registry owns their lifecycle and validates their declarations.
