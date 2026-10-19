---
description: "Settings → Personalization: the browser page where a signed-in person chooses how Aeven talks with them."
kind: "package-reference"
---

# @aeven/client-ui-settings-personalization

English | [中文](README.zh.md)

## Summary

The Settings → Personalization section, over the `personalization` Remote of [`@aeven/personalization`](../../preset/personalization/README.md). The page is three settings, top to bottom: the voice as one row of options whose chosen option explains itself below the row, notes in the person's own words, and the master prompt the person's sessions carry, always visible rather than hidden behind a disclosure. A voice applies on click; the notes and the master prompt apply on Save, and the master prompt offers Reset to default once the person changed it. The page states that the name Aeven calls them comes from the conversation instead of asking for it: the account display name lives on the account, and this page keeps no name field.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Model Experience

None, as the page adds nothing to a model request; it reads and writes the personalization document the owning package renders as prompt sections. The master prompt editor shows the text those sections carry, before `{{model}}` and `{{cwd}}` are filled in per session.

#### KV Cache effect

None; no prompt input originates here.

## Known Limitations and Deferred Work

- **Invariant omission** — No invariant companion is published because the page holds no fact of its own: the voice, the notes, and the master prompt are read and written through the `personalization` Remote, and the page keeps only the read cache those calls fill.
- **Renaming** — The account display name has no editor on this page; an account surface owns it.

### Dev Note

None.
