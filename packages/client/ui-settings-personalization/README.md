---
description: "Settings → Personalization: the browser page where a signed-in person chooses how Aeven talks with them."
kind: "package"
---

# @aeven/client-ui-settings-personalization

## Summary

The Settings → Personalization section, over the `personalization` Remote of [`@aeven/personalization`](../../preset/personalization/README.md). A person picks a voice from four cards, each with a one-line example reply, sets the name Aeven calls them, and writes notes about how they like answers. The name is the Aeven account display name — the one the sign-up naming step asks for — written through the signed-in reader's `setDisplayName`, so the account menu and the next message follow it; without an Aeven account the field is absent. A voice applies on click; the name and notes apply on Save. Every change reaches the person's sessions from their next message.

## Model Experience

This package adds nothing to model requests itself; `@aeven/personalization` renders what the page saves.

## Known Limitations and Deferred Work

None.
