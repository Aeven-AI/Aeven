---
description: "Settings → Memory: what Aeven has learned about the signed-in user, with View, Correct, and Forget."
kind: "package-reference"
---

# @aeven/client-ui-settings-memory

## Summary

`avn-client-ui-settings-memory` registers the Memory page in Settings over the `memoryManager` Remote from `@aeven/api-memory-manager`. It replaces the MemOS Viewer as the user's place to review what Aeven learned.

## Use this package

The page has four tabs:

- **About you** lists `person` memories; **Projects** lists `project` memories grouped by the workspace of the session they came from; **Knowledge** lists `world` and `experience` memories. A search box filters all three. Each memory can be edited or forgotten and links to its conversation.
- **Capabilities** lists learned capabilities with status and run counts. **View** shows the procedure, its version, and recent runs with verdicts and corrections; from there a capability can be edited, retired or put back in use, confirmed when unconfirmed, or deleted.

Copy lives in the `settings.memory` dictionaries (English and Simplified Chinese).

## Model Experience

None.

## Known Limitations and Deferred Work

- The page reloads on open and after its own changes; it does not follow changes made by a running session.

## Dev Note

None.
