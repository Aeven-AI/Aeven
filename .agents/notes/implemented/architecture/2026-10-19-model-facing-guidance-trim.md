# Agent Note: Model-facing guidance states only what a result cannot teach

Status: implemented

English | [中文](2026-10-19-model-facing-guidance-trim.zh.md)

## Problem

Every tool description and prompt section had grown by repeating what its own results already say. The bash description restated the sandbox denial marker, the escalation retry contract, the exit-code marker and the job tools; `web_fetch` restated that its content is untrusted data; `web_search` advertised a query bound its `queries` parameter already stated; `todo_write` restated every status in the vocabulary it accepts; the file-search tools described sampling rules in prose that the result itself reports. A model reading a schema and then its results met the same sentence twice, once as instruction and once as fact, and each copy was a place for the two to drift.

## Decision

**A tool description states the contract the schema cannot, and the result states what happened.** A fact a result carries — the denial marker and the escalation the denial offers, the truncation and its spill path, the exit code, the sampling head, the retry of a background job — belongs in the result. A fact the schema carries — the query bound on `queries`, the parameter order a caller must supply — belongs on the parameter. What remains in the description is the decision the model has to make before the call: when to run a command in the background, when a denial may be escalated, when a command is safe to attempt.

**Prompt sections keep the habits, not the mechanics.** The bash section states the exit-code habit and how to wait; the web sections state when a search is warranted, the untrusted-data notice and the citation obligation for the partner tool that is visible; the delegation sentence appears only while a continuable background subagent is registered. Nothing in a section repeats a schema field or a result's own marker.

**The escalation contract is stated once, on the path that can act on it.** Where the composition admits approval, the description names the same-turn retry and the rejection that ends it; where no approval channel exists, it states the plain denial instead, because advertising a retry that cannot be approved invites a wasted call.

## Alternatives considered

**Keep both copies and let the specs catch the drift.** Every duplicated fact then has two homes that must move together, and a spec pinning both only reports the drift after someone changes one of them; assigning each fact a single owner removes the second copy instead of watching it.

**Cut the descriptions by length, leaving each fact where it sits.** A shorter description that still restates its result's markers still teaches the same fact twice, so the drift survives the trim and the next sentence added to either side brings the duplication back.

**Advertise the same-turn escalation retry in every description, including compositions with no approval channel.** A retry the runtime cannot approve turns a denial into a call that was always going to fail, so the description states the retry only where an approval answer can reach it.

## Consequences

- The bash and pwsh descriptions name no `job_output`/`job_kill`; the background handoff lives on the `run_in_background` parameter and in the completion notice the runtime sends.
- `web_search` advertises its bound on the `queries` parameter (`accepts 1–N items`), not in guidance, so changing `searchMaxQueries` no longer moves the prompt prefix.
- `todo_write` keeps the parallel/serial distinction, which is the choice the call makes, and drops the status vocabulary the schema enumerates.
- A denied sandbox operation carries its escalation hint in the marker, so the model learns the route from the result it just received.

## Verification

Each package's spec pins the current text where the text is the contract: `packages/shell/tool-bash/tests/tools.spec.ts` and `tool-pwsh/tests/tools.spec.ts` pin the clause constants and the non-escalating variant, `packages/web/tool-web/tests/tool-web.spec.ts` pins the parameter bound and every scope variant of the guidance, `packages/fs/tool-fs-search/tests/tools.spec.ts` pins the exact section sentences and the tool description's sampling rule, and `packages/todo` and `packages/subagent/tool-subagent` pin the policy wording that reaches the model. The recorded system prompts under `snapshots/` were refreshed with `AVN_SNAPSHOT=refresh pnpm run test:snapshot`.
