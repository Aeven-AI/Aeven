# Agent Note: Learned Procedures Survive Rewrites and Reach Recall

Status: implemented

English | [中文](2026-11-17-learned-procedures-survive-and-get-recalled.zh.md)

## Problem

Silent learning stored procedures, but they seldom helped a later turn. In one account's memory store 34 of 36 learned procedures were `candidate`; of 64 distinct candidates that met the promotion conditions since the mechanism started, 63 no longer existed, because each rewrite stored a new memory, forgot the old one, and kept `active` only when 60% of the old lines survived verbatim. Turn-start retrieval returned a procedure for 93 of 1,432 requests, and the relevance judgment, told to keep an unproven procedure only when it fits "exactly", delivered 12 of those in 17 days. Rewrites also lost knowledge: about ten LinkedIn procedures learned in October, including the browser steps for publishing, were replaced by one that only drafts, so each posting run started from nothing.

## Decision

- **Recall offers procedures by kind of task.** `memory-memos` reads the owner's current procedures beside the search and offers the relevance judgment up to `procedureCandidates` (default 3). It embeds each procedure's name and description once with the local embedding model, embeds the request, and offers the closest procedures whose cosine similarity stands `procedureMinMargin` (default 0.035) above the median of the owner's procedures; then those whose name and description share words with the request and the conversation before it (`procedureMatch`), where a word more than three procedure names share does not count. The procedure list is kept per owner until a memory write or ten minutes retire it, because listing is a text scan of every memory. The judgment keeps a procedure, active or candidate, when the request is the kind of task it is for.
- **An update extends.** The learning prompt requires an update to keep every step, variant, fact, preference, and recovery the work did not show to be wrong, and to give each variant of the task its own steps; the merge prompt keeps variants as well.
- **Nothing is rewritten unread.** A procedure is rewritten or forgotten only when the distillation read its full text. When the first decision covers one it saw clipped or as one line, the learner decides again with those procedures in full (up to 24,000 characters each); one still not read whole is kept, and an update of it is skipped.
- **Status survives rewrites.** A rewrite of an `active` procedure without a correction stays `active`, and a merge with an `active` member stays `active`. `memory-context` records each recalled procedure's name, so promotion and demotion reach the procedure now stored under that name when learning rewrote it in between.

## Alternatives considered

**Keep the 60% verbatim-line rule.** A model rewrite rarely keeps lines verbatim, so the rule demoted almost every update of a proven procedure.

**Update the stored memory in place instead of storing a new one.** It would keep the id, but the provider's capture path writes summaries and tags on remember; changing that is larger than following procedures by name.

**Choose procedures by shared words alone.** It needs no embedding, but a request in another language than the procedure, or one that names the task with a synonym, shares no word with it; the local model matched Spanish, Chinese, and Dutch requests to English procedures in 2 to 5 ms each.

**A fixed similarity cutoff.** `multilingual-e5-small` scores every procedure between 0.75 and 0.88 for any request, so no fixed value separates a match; a match stood 0.036 to 0.11 above the median and an unrelated request within 0.03.

**Expose the core's embedder or stored vectors.** The stored vector embeds the procedure's steps, not its kind of task, and the vendored core would need a new method; the core's embedder factory is importable and shares the loaded model.

## Consequences

A request such as "post on LinkedIn" now offers the LinkedIn procedure to every turn's judgment, and later work adds its steps to that procedure instead of replacing it. With a remote embedding provider, or fewer than six procedures, shared words decide alone. A learning pass whose first decision covers an unread procedure costs one more model call.
