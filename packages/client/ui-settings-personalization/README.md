---
description: "Settings → Personalization: the browser page where a signed-in person chooses how Aeven talks with them."
kind: "package-reference"
---

# @aeven/client-ui-settings-personalization

English | [中文](README.zh.md)

## Summary

The Settings → Personalization section, over the `personalization` Remote of [`@aeven/personalization`](../../preset/personalization/README.md). A person picks a voice from four cards, each with a one-line example reply, sets the name Aeven calls them, and writes notes about how they like answers. The name is the Aeven account display name — the one the sign-up naming step asks for — written through the signed-in reader's `setDisplayName`, so the account menu and the next message follow it; without an Aeven account the field is absent. A voice applies on click; the name and notes apply on Save. Every change reaches the person's sessions from their next message.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Model Experience

None, as the page adds nothing to a model request; it reads and writes the personalization document the owning prompt section renders.

#### KV Cache effect

None; no prompt input originates here.

## Known Limitations and Deferred Work

- **Invariant omission** — No invariant companion is published because the page holds no fact of its own: the voice, the name, and the notes are read and written through the `personalization` Remote and the Aeven account, and the page keeps only the read cache those calls fill.

### Dev Note

None.
