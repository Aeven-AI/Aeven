# Agent Note: Logged bulk payloads pin per-scenario sidecars

Status: implemented

English | [中文](2026-10-23-logged-bulk-payloads-pin-per-scenario-sidecars.zh.md)

## Problem

A recorded-session fixture is both replay input and expected output, so every byte in it is reviewed surface: a maintainer reading a session diff decides from those lines whether the harness behaved correctly. Bulk text inside a logged event drowns that surface. A request system prompt and its tool schemas are thousands of characters of static composition that no scenario's behavior depends on. A `turn-review/request` event carries a review prompt plus a JSON transcript of the entire turn — the turn's user messages, tool calls, clipped tool results, and replies — inside one event, which restates conversation text the surrounding events already record; with the payload inline, a one-word prompt edit rewrites every fixture that logs a review and buries the behavior under text no reviewer reads twice.

The same events are also produced on two surfaces. Replay compares a normalized harvest against committed bytes; refresh writes committed bytes from a fresh run through a partially different pipeline. When the two paths disagree by one character, refresh churns fixtures nothing changed, the committed form stops being a fixed point of its own normaliser, and the volatile-value preservation that keeps unrelated values stable is disabled for that log ([refresh volatiles](../bug-fix/2026-07-27-stable-snapshot-refresh-volatiles.md)).

## Decision

A committed session fixture keeps small structural events inline and moves a logged bulk payload behind a stable token, with the readable copy in a sidecar beside the fixture the scenario owns. Three payloads follow that rule: a request header's `system` becomes `{{system}}` and its prompt belongs to `system-prompt.expected.md`; its `tools` becomes `{{tools}}` with `tool-schemas.expected.json`; and a `turn-review/request`'s `system` and `messages` become `{{turnReviewSystem}}` and `{{turnReviewMessages}}` with `turn-review.expected.json`.

### The review request keeps its structure and pins its text

`turn-review/request` retains `turn`, `round`, `route`, and `maxTokens` inline. They are small, and they are the assertion about which route reviewed which turn. The scenario-owned sidecar `turn-review.expected.json` holds `{prompt, requests: [{session, messages}]}`: the prompt once, then one entry per session fixture that logged a request, with `session` naming that fixture's index so a child session's request belongs to the log that carries it. A second prompt in one scenario fails the run, because one plugin prompt produces every request in the corpus and a differing prompt is a provenance error rather than a variant to store. `turn-review/verdict` stays inline, being small and the outcome the fixture exists to pin.

Extraction runs after `redactSessionSnapshotIds`, so the review message's own `id` reaches the sidecar as a stable `{{message:N}}` token instead of a minted UUID. The transcript keeps the tokens its source events carry — `{{cwd}}` inside a tool result, `{{spillLocator:…}}` — so a sidecar shows the turn's user text, calls, and results without host paths or session identities.

### The normaliser exports the rule

`@aeven/session-snapshot` exports `normalizeSessionSnapshotsWithReview`, which returns the normalized fixtures plus the review evidence they pinned; `normalizeSessionSnapshots` delegates to it and returns the fixtures, so existing callers keep their contract. `turnReviewSnapshot(rawLogs)` collects a scenario's requests in fixture order, primary session first. `scrubTurnReviewRequests` replaces the two payload fields with tokens and is idempotent. `formatTurnReviewSnapshot` and `parseTurnReviewSnapshot` own the sidecar's canonical JSON (two-space indent, one trailing newline) and its shape validation. `writeTurnReviewSnapshot` and `expectTurnReviewSnapshot` are the write and compare halves the headless, SDK, and ACP adapters share: a scenario that logs no review request owns no sidecar, so the writer removes a stale file and the comparison fails on one.

### Cwd canonicalisation preserves an escaping backslash

`scrubString`'s canonical mode converts path separators only inside paths rooted at `{{cwd}}`, so regexes, commands, and model-authored text survive. A nested JSON string value — the review transcript is one — closes a quoted path with `\"`, so the match reached one character past the path and the rewrite turned the escape's backslash into a separator: `cannot read "{{cwd}}/deleted.txt"` became `cannot read "{{cwd}}/deleted.txt/"` on the comparison surface while the fixture write kept the plain form. The canonicaliser keeps a trailing backslash that escapes the closing quote of a nested JSON payload and converts only separators inside the path, which holds both surfaces to the byte the product logged.

### The corpus gate holds the rule

For every scenario, `scripts/session-snapshot-corpus.corpus.ts` asserts that each fixture is a fixed point of `scrubTurnReviewRequests`, that `turn-review.expected.json` exists exactly when some fixture of that scenario logs a request, and that every `session` index in the sidecar names a committed fixture. Eight scenarios log a review request — `acp/fs-escalation-approved`, `sdk/persistent-tools`, `session/fs-delete-recreate`, `session/fs-edit`, `session/fs-write`, `session/fs-write-overwrite`, `session/fs-write-overwrite-bounded`, and `session/session-sandbox-root` — and the gate, not that sentence, keeps the set true as file-changing turns move between scenarios.

## Alternatives considered

**Keep the payload inline.** Each reviewed fixture then repeats the review prompt and the turn's conversation text on its own line; a prompt edit rewrites hundreds of lines, and the review surface cannot be read on its own. The payload is auxiliary evidence — quoted conversation for an auxiliary model call — not conversation the fixture records.

**One corpus-level review sidecar.** A single file for the whole corpus needs a path every adapter knows, an owner for the file, and a rule for two record runs that disagree. It also couples every scenario to every prompt: a prompt change would fail each scenario that logs a review, but nothing would say which fixtures the sidecar belongs beside. Per-scenario ownership needs no manifest field, no cross-profile source indirection, and no adapter symlink, which the header pins require precisely because their sidecars live outside the scenario.

**Route the prompt through the header-pin machinery.** Header pins avoid duplicating identical prompt and schema files across header classes. A review sidecar cannot use that path: its `requests` differ per scenario by construction, and the only shared part is one 1352-character prompt, smaller than any system prompt. Duplicating it fails exactly the scenarios that log a review when it changes, which is also the set a refresh must rewrite.

**Convert the escape in the refresh write path.** Repairing the trailing separator where refresh writes leaves the comparison surface still inventing a character in the recorded text, so the fixture would match a normaliser that misquotes the product's own log. Any later nested JSON payload would hit the same bug.

## Consequences

- A reviewed scenario commits three artifacts: the fixture with its tokenised event, the readable sidecar, and — under the SDK adapter — the notification golden that carries the same event inline, because that file is a wire transcript of every session event normalized for identities and paths rather than a scenario fixture.
- The review prompt is duplicated in every reviewed scenario's sidecar. That is the one piece of static text repetition buys, and it buys failure isolation: a prompt change fails the scenarios that log a review and nothing else.
- A prompt change fails replay until refresh regenerates prompt, requests, and fixtures together; the failing comparison names the sidecar, so the repair is one refresh run over the corpus.
- A sidecar reader correlates the transcript to `session.jsonl` through its `{{message:N}}` token rather than reading raw values, which is the price of the sidecar being a normalisation fixed point.
- The canonicaliser carries a rule about nested JSON escapes, so a future payload embedding cwd-rooted paths in JSON text inherits it instead of re-deriving it.

## Testing

`pnpm run test:snapshot` replays the corpus keyless and runs the corpus gate inside the same lane; the ACP, SDK, and headless adapters each compare their scenario's sidecar, and a scenario that gained or lost a review request fails on sidecar presence as well as on its fixture. `pnpm run test:snapshot:refresh` regenerates the sidecar from the committed model scripts, so a prompt edit in `@aeven/turn-review` surfaces as sidecar mismatches across the reviewed scenarios until refresh runs, and then as a reviewed prompt diff once it has. `pnpm run typecheck` covers the exported surfaces.

## Related

- [Session-log snapshot corpus](../testing/2026-08-24-session-log-snapshot-corpus.md) owns the corpus, its manifest classes, and the fixture guards the review gate extends.
- [ACP snapshot tests](../testing/2026-06-19-acp-snapshot-tests.md) owns session-log replay, normalization, and the header-pin sidecars this rule parallels.
- [Turn review and the bash edit guard](2026-10-21-turn-review-and-bash-edit-guard.md) owns the review call, its prompt, and the two events it logs.
- [Stable snapshot refresh volatiles](../bug-fix/2026-07-27-stable-snapshot-refresh-volatiles.md) owns refresh write-back and why a surface disagreement costs fixture churn.
