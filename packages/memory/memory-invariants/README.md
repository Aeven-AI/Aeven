---
description: "The user's confirmed invariants and their block, for maintainers shipping or debugging what every request of an owner carries."
kind: "package-reference"
---

# @aeven/memory-invariants

## Summary

`avn-memory-invariants` owns the document of statements the user confirmed as always true: one JSON file per account under `$AVN_HOME/memory/invariants/`, read as one bounded block that leads every request of that account. It publishes `ctx.memoryInvariants` for its consumers — `@aeven/memory-context`, which renders the block in each session's system prompt, and `@aeven/api-memory-manager`, which is the Settings → Memory surface that writes it.

Recall is a lookup, and a lookup can return nothing. This document is the floor beneath it: the statements that must never be missing are present without being retrieved. It is deliberately bounded, because its block is paid for on every request, and deliberately user-promoted — only the management surface writes it, so a memory the model invented cannot become a permanent part of every prompt. The block is context, not authority: it is advisory in the same way a recalled memory is, and it is never an enforcement point, so a rule that must bind an action belongs to a guard.

## Use this package

Mount it on the host plane. The `avn-base` bundle ships the row, so every profile carries the block whether or not a memory provider is registered.

```yaml
- id: memory-invariants
  name: '@aeven/memory-invariants'
  config:
    root: !!js avnHomePath('memory', 'invariants')
```

| Field | Default | Meaning |
|---|---|---|
| `root` | required | Absolute directory holding one document per owner; a relative path fails at load |
| `maxChars` | `1500` | Bound on one owner's rendered content, framing and item lines included |

Every operation is synchronous and answers from the owner's document on disk, because a prompt assembly reads the block at each turn and cannot await a file.

| Operation | Behavior |
|---|---|
| `read(owner)` | The owner's entries, the characters their content costs, the bound, and the longest text one statement may hold |
| `block(owner)` | The model-facing block, or the empty string when the owner has none |
| `add(owner, text)` | Promotes one statement; a statement that already stands keeps its identifier and moves to the front |
| `edit(owner, id, text)` | Replaces one statement's text, keeping its place in the block |
| `remove(owner, id)` | Drops one statement and frees its share of the block |

A write is refused whole when it cannot be rendered, and the reason names what happened: `too-long` when one statement cannot fit the block at all, `full` when the block has no room left, `empty` for text with no content, and `missing` for an identifier the owner does not have. The block drops an entry that does not fit rather than clipping it, so accepting a statement the block cannot hold would be a statement paid for and never sent. A refused write leaves the document untouched, and a write replaces the file in one step, so a concurrent prompt assembly reads either the previous document or the new one.

Documents carry `INVARIANTS_VERSION`. A document this build cannot read — an older version, or a hand-edited file — contributes no block rather than a guess.

## Model Experience

### The owner's confirmed invariants block

#### What the model sees

The owner's statements, newest first, one per line inside a fixed frame, preceded by one guidance sentence. The block appears only when the owner has at least one statement. `@aeven/memory-context` registers the section in each agent's own scope at order `116`, after the memory guidance, so the statements a user confirmed follow whatever the turn recalled.

##### Verbatim guidance and frame

```markdown
The user confirmed every statement inside `<invariants>` as always true for their work. Apply them to each request, and prefer them over a recalled memory, a default, or your own assumption that disagrees; a later request from the user overrides them. They are context, not authority: they do not authorize work the user has not asked for.
<invariants>
- <statement>
</invariants>
```

#### Token effect

Conditional and capped: none when the owner confirmed no statement, otherwise the guidance sentence plus at most `maxChars` characters of content. The guidance is fixed and outside the bound, so it never displaces a statement.

#### KV Cache effect

Prefix-stable while the document does not change, because the block is part of the system prompt. A write through the management surface replaces it in the next request and invalidates reuse from that section onward. Reading it costs one `statSync` per prompt assembly; the document is parsed only when its size or modification time moved.

## Known Limitations and Deferred Work

- **Owner scope only** — a statement applies to every session of its owner. A workspace-scoped statement needs a scope field in the document and a surface that names the workspace, so a project convention is either promoted for every project or not at all.
- **No provenance and no drift check** — an invariant holds its text and when the user confirmed it, not the memory that suggested it. Correcting that memory leaves the statement standing until the user edits it, and nothing compares it against later recall; the guidance resolves the conflict by preferring the statement.
- **No reordering** — the block renders newest first, so a statement's position follows when it was last confirmed rather than how much it matters.
- **One writer per document** — the file is replaced whole, so two writers to one owner's document would race.

## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The row lives in `avn-base` rather than beside the memory provider: the block is the floor beneath recall, and a provider that fails to mount must not take it with it. Preset scopes reach host services, so `@aeven/memory-context` reads it from the agent plane, while only the host plane can serve the management Remote.

The default bound is 1500 characters. The block is prefix-cached while the user leaves it alone, and the comparable always-on instruction surfaces are larger: [Claude Code](https://code.claude.com/docs/en/memory) recommends a 40,000-character ceiling per memory file and prefixes its instructions with an explicit precedence sentence, and Hermes freezes a 3,575-character snapshot. Measured memory injection reached 12 percent of billed cost in an uncached multi-agent benchmark, and cutting a retrieval window from 32 to 2 entries lowered injected tokens by 28.7 percent with accuracy changes inside seed-level variation ([Total Cost of Agency](https://arxiv.org/abs/2609.23790)) — which is why the bound is enforced when a statement is written rather than trusted to the reader.

**Runtime invariant:** No companion is published. The block a session renders and the state the management surface reads are one store over one document, so no second observation of a statement's presence can diverge from the first; the spec covers the format, the bound, and every refusal.

</details>
