# Agent Note: Learned Procedures Survive Rewrites and Reach Recall

Status: implemented

English | [中文](2026-11-17-learned-procedures-survive-and-get-recalled.zh.md)

## Problem

Silent learning stored procedures, but they seldom helped a later turn. In one account's memory store 34 of 36 learned procedures were `candidate`; of 64 distinct candidates that met the promotion conditions since the mechanism started, 63 no longer existed, because each rewrite stored a new memory, forgot the old one, and kept `active` only when 60% of the old lines survived verbatim. Turn-start retrieval returned a procedure for 93 of 1,432 requests, and the relevance judgment, told to keep an unproven procedure only when it fits "exactly", delivered 12 of those in 17 days. Rewrites also lost knowledge: about ten LinkedIn procedures learned in October, including the browser steps for publishing, were replaced by one that only drafts, so each posting run started from nothing.

## Decision

- **Recall offers procedures by kind of task.** `memory-memos` reads the owner's current procedures beside the search and offers the relevance judgment up to `procedureCandidates` (default 3) whose name and description share words with the request and the conversation before it (`procedureMatch`); a word more than three procedure names share does not count. The judgment keeps a procedure, active or candidate, when the request is the kind of task it is for.
- **An update extends.** The learning prompt requires an update to keep every step, variant, fact, preference, and recovery the work did not show to be wrong, and to give each variant of the task its own steps; the merge prompt keeps variants as well.
- **Nothing is rewritten unread.** A procedure is rewritten or forgotten only when the distillation read its full text. When the first decision covers one it saw clipped or as one line, the learner decides again with those procedures in full (up to 24,000 characters each); one still not read whole is kept, and an update of it is skipped.
- **Status survives rewrites.** A rewrite of an `active` procedure without a correction stays `active`, and a merge with an `active` member stays `active`. `memory-context` records each recalled procedure's name, so promotion and demotion reach the procedure now stored under that name when learning rewrote it in between.

## Alternatives considered

**Keep the 60% verbatim-line rule.** A model rewrite rarely keeps lines verbatim, so the rule demoted almost every update of a proven procedure.

**Update the stored memory in place instead of storing a new one.** It would keep the id, but the provider's capture path writes summaries and tags on remember; changing that is larger than following procedures by name.

**Retrieve procedures by embedding in a separate tier.** The store's ranking puts procedures among every memory; a word match on the few procedure names is cheap, needs no model call, and selects the kind of task a request names.

## Consequences

A request such as "post on LinkedIn" now offers the LinkedIn procedure to every turn's judgment, and later work adds its steps to that procedure instead of replacing it. Matching is by word, so a request in another language than the procedure matches only on shared names such as a product's. A learning pass whose first decision covers an unread procedure costs one more model call.
