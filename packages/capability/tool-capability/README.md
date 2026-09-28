---
description: "Capability learning for the model: the capability_manage tool, learning guidance, confirmation, and draft recall."
kind: "package-reference"
---

# @aeven/tool-capability

## Summary

`avn-tool-capability` lets the agent learn and maintain capabilities for the session's owner. `capability_manage` offers `learn`, `view`, `list`, `update`, `write_file`, `delete`, `report`, `retire`, and `restore`. `learn` stores the procedure as an unconfirmed draft first, then asks the user through `ctx.userQuestions` whether to learn it: confirming makes it `learned`, declining deletes it, and a session with no reachable user (such as a subagent) keeps it as a draft. Changing, deleting, retiring, or restoring a confirmed capability also asks the user. The plugin records one execution per turn that loaded a confirmed capability (through the `skill` tool or a `/name` invocation), with the tools, retries, tokens, and the model's `report` from that turn; a direct-user correction in the next turn and a rating on the turn's reply are attached to it afterwards. At the start of a direct-user turn, unconfirmed drafts whose name and description share at least two words with the request are recalled once per session.

## Use this package

Mount it per agent beside a host `capability` registry (the `standard`, `cordis`, and `ptc` presets include it).

| Field | Default | Meaning |
|---|---|---|
| `promptOrder` | `116` | Order of the learning guidance section |
| `maxDrafts` | `3` | Maximum drafts recalled for one turn |
| `previewMaxChars` | `4000` | Maximum procedure characters shown in a confirmation question |

## Model Experience

### Learning guidance

#### What the model sees

In sessions with an owner, one system-prompt section telling the model to learn a capability when the user asks it to, or after working out a recurring multi-step procedure through errors, dead ends, or a correction; how to write it (when to use it, requirements, exact steps, verification, recovery); that saving asks the user; and what not to save.

#### Token effect

About 170 tokens per request in owned sessions; none elsewhere.

#### KV Cache effect

Static per session.

### Draft recall

#### What the model sees

```text
<capability_drafts>
Unconfirmed procedures saved earlier that may apply. The user has not confirmed them: read one with capability_manage (action "view") and verify each step before relying on it.
- <name>: <description>
</capability_drafts>
```

#### Token effect

Only when a draft matches; at most `maxDrafts` lines, each draft once per session.

#### KV Cache effect

Append-only after the user's message.

## Known Limitations and Deferred Work

- **Keyword matching for drafts** — draft recall matches words, not meaning.
- **Proposals come from the model** — automatic proposals from recorded evidence (retries followed by success, corrections) are not generated yet.
- **Corrections are recognized by phrasing** — a correction must open with a phrase such as "that's wrong" or "it didn't work" to count against the previous turn's executions.

## Dev Note

None.
