---
description: "Per-account personalization: how each signed-in person wants Aeven to talk with them, for users and maintainers configuring or debugging it."
kind: "package"
---

# @aeven/personalization

## Summary

`@aeven/personalization` stores, per signed-in account, how that person wants Aeven to talk with them: a voice (`automatic`, `warm`, `direct`, or `playful`) and notes in their own words. The name Aeven calls them is not stored here: it is the account display name the sign-up naming step asks for, and it reaches the model as `<user_profile>` with every message. It renders those preferences into the system prompt of every session the person owns, directly after the persona, and serves the `personalization` Remote behind Settings → Personalization. A person who keeps every default contributes nothing to the prompt.

## Behavior

- **Storage.** One JSON document per account under the configured `root`, named by the escaped account id. A write replaces the document with one rename, so a concurrent prompt assembly reads the previous or the new document and never a partial one. A document this version cannot read yields the defaults.
- **Prompt section.** `user:personalization` is registered in each agent's scope and reads the session owner's document at every assembly, re-reading the file only when its size or modification time moved. A session without an owner renders nothing.
- **Voices.** `automatic` adds nothing and leaves the persona's own reading of the moment in charge; the other voices hold across subjects. The guidance line tells the model the preferences outrank the persona's voice defaults, and a request in the conversation outranks them.
- **Bounds.** The notes are trimmed, and notes over `maxNotesChars` are refused whole with reason `too-long` rather than clipped.
- **Remote.** `get()` returns the caller's preferences and bounds; `update(change)` applies the fields present. Both act for the acting signed-in user and throw without one.

## Model Experience

The section is part of the system prompt, so every `request/header` event records it and a change is reconstructable from the log from the first request it reached. It sits early in the prompt and changes only when the person edits it, so it stays in the cached prefix between edits. Its cost is the guidance line plus the person's own text, bounded by the two limits.

## Configuration

```yaml
- id: personalization
  name: '@aeven/personalization'
  config:
    root: !!js avnHomePath('personalization')
```

| Field | Default | Meaning |
|---|---|---|
| `root` | required | Absolute directory holding one document per account |
| `maxNotesChars` | `1500` | Longest notes text a person can store |
| `promptOrder` | `10` | Prompt-section order; the persona sits at `0` |

## Known Limitations and Deferred Work

- Style requests made in conversation ("talk to me more casually") land in long-term memory, not in this document; Settings does not show them yet.
