---
description: "Per-account personalization: how each signed-in person wants Aeven to talk with them, for users and maintainers configuring or debugging it."
kind: "package"
---

# @aeven/personalization

English | [中文](README.zh.md)

## Summary

`@aeven/personalization` stores, per signed-in account, how that person wants Aeven to talk with them: a voice (`automatic`, `warm`, `direct`, or `playful`) and notes in their own words. The name Aeven calls them is not stored here: it is the account display name the sign-up naming step asks for, and it reaches the model as `<user_profile>` with every message. It renders those preferences into the system prompt of every session the person owns, directly after the persona, and serves the `personalization` Remote behind Settings → Personalization. A person who keeps every default contributes nothing to the prompt.

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

## Behavior

- **Storage.** One JSON document per account under the configured `root`, named by the escaped account id. A write replaces the document with one rename, so a concurrent prompt assembly reads the previous or the new document and never a partial one. A document this version cannot read yields the defaults.
- **Prompt section.** `user:personalization` is registered in each agent's scope and reads the session owner's document at every assembly, re-reading the file only when its size or modification time moved. A session without an owner renders nothing.
- **Voices.** `automatic` adds nothing and leaves the persona's own reading of the moment in charge; the other voices hold across subjects. The guidance line tells the model the preferences outrank the persona's voice defaults, and a request in the conversation outranks them.
- **Bounds.** The notes are trimmed, and notes over `maxNotesChars` are refused whole with reason `too-long` rather than clipped.
- **Remote.** `get()` returns the caller's preferences and bounds; `update(change)` applies the fields present. Both act for the acting signed-in user and throw without one.

## Model Experience

### The `user:personalization` system prompt section

#### What the model sees

One system-prompt section, registered in each agent's own scope at the configured `promptOrder` (`10` by default), so it reads as an amendment to the persona directly above it. Its text is evaluated at every assembly from the session owner's document, and a session without an owner renders nothing. Because the section is part of the system prompt, every `request/header` event records it, so a change is reconstructable from the log from the first request it reached.

##### Verbatim guidance and frame

```markdown
How this person asked you to talk with them. It outranks the voice defaults above; something they ask for in the conversation outranks it.
<personalization>
Voice: <the instruction of the chosen voice>
In their own words: <the person's notes>
</personalization>
```

##### Verbatim voice instructions (`warm`, `direct`, `playful`, in that order)

```markdown
Voice: Really warm and friendly in every reply, technical work included: encouraging, kind and conversational, like a friend who is glad to help, while staying exact.
Voice: Straight to the point in every reply, personal topics included: brief and plain, no small talk, and still kind.
Voice: Light and playful: humour and casual language are welcome, while the substance stays accurate.
```

#### Token effect

Conditional: none for a person who kept `automatic` with empty notes; otherwise the fixed guidance sentence, the `Voice:` line carrying the chosen voice's own instruction (one of the three above), and the `In their own words:` line when they wrote something. The notes are bounded at `maxNotesChars` (`1500` by default), and a longer text is refused rather than clipped, so the section never grows past what the reader set.

#### KV Cache effect

Prefix-stable while the person leaves the document alone: the section sits early in the system prompt, and every later request reuses it unchanged. An edit through Settings replaces it from that section onward in the owner's next request; the prefix before the section stays reusable.

## Known Limitations and Deferred Work

- Style requests made in conversation ("talk to me more casually") land in long-term memory, not in this document; Settings does not show them yet.
- **No invariant companion** — No runtime invariant companion is published because the store, the prompt section, and the Remote all read the same per-account document and the section is rendered from the store's own read, so a check could only re-read the file this package already reads; `identityUsers` owns which account a session belongs to.
