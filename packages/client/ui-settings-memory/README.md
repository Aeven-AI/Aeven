---
description: "Settings → Memory: what Aeven has learned about the signed-in user, with View, Correct, and Forget, and Import memory."
kind: "package-reference"
---

# @aeven/client-ui-settings-memory

English | [中文](README.zh.md)

## Summary

`avn-client-ui-settings-memory` registers the Memory page in Settings over the `memoryManager` Remote from `@aeven/api-memory-manager`. It replaces the MemOS Viewer as the user's place to review what Aeven learned.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

**Import memory** sits at the top of the page, above the tabs. Its button opens a file picker for a data export (`.zip`) from ChatGPT, Claude, Gemini, Grok, or another assistant, or one saved conversation. The browser rebuilds an archive from its text files, so images and attachments never leave the device, and uploads the file through the composer's attachment route. The page then starts a new conversation whose first message asks Æven to import the file, with the file attached, and closes Settings. The agent reads the file at its attachment path with its own tools, guided by the aeven preset's `memory-import` skill, and saves facts with `memory_remember_bulk`. A file over the attachment size limit, or an archive without text files, is refused in the row.

The page uses the same underline tabs as Plugins:

- **About you**, **Projects**, and **Knowledge** list memories as quiet cards. A card shows the fact and when it was remembered. Opening it reveals what was said, and a Details fold for the kind, time, and project. Edit, Forget, and Show conversation sit in that open card. Show conversation selects the session inside the app and closes Settings.
- **Projects** groups cards by the workspace folder of the session they came from.
- Each memory tab asks the provider for its own domains (`person`; `project`; `world` and `experience`) one page at a time. **Load more** appears only while the provider reports more of that tab's memories than are loaded, and disappears once an empty page or the reported total ends the list.
- **Capabilities** lists the learned procedures from `memoryManager.procedures()`, newest first, with a search box that filters by name and description. A card shows the procedure's name and description; opening it shows when it was learned, its domain and project, what Aeven recalls for it, and the full procedure behind a Procedure fold. Show conversation, Edit (the recalled steps), and Forget sit in the open card, and Forget asks for confirmation.
- **Standing facts** lists each statement with Edit and Remove; Remove asks for confirmation before it deletes.

Copy lives in the `settings.memory` dictionaries (English and Simplified Chinese).

## Model Experience

None, as the page only reads and writes memory settings through the `memory` Remote and registers no prompt, tool, or model-visible result.

#### KV Cache effect

None; no prompt input originates here.

## Known Limitations and Deferred Work

- The page reloads on open and after its own changes; it does not follow changes made by a running session.

### Dev Note

**Runtime invariant:** No companion is published. The section renders what the `memoryManager` Remote returns and holds no runtime state of its own beyond the loaded page and the open row.
