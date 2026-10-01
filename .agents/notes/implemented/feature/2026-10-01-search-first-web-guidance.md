# Agent Note: Search-first web guidance and a session clock

Status: implemented

English | [中文](2026-10-01-search-first-web-guidance.zh.md)

## Problem

The shipped `tool:web_search` guidance stated the tool's contract — the argument bound, the untrusted-data notice, the citation obligation — and nothing about when an answer must come from the web. A session therefore answered time-sensitive questions from memory and reported them with the confidence it reserves for facts the workspace can confirm, while the tool that settles those questions sat unused in the schema.

Two further facts kept the gap invisible. No shipped composition mounted `@aeven/time-context`, so a session could not see how old its knowledge was — the one reading the search decision is made against. And the `web_search` tool description repeated the contract-only text, so the model's tool list contained no trigger either.

## Decision

Both `web_search` guidance variants in `packages/web/tool-web/src/search.ts` open with one search-first paragraph: search when the answer could have changed since training — software versions and releases, prices and availability, current events, schedules, people, and documentation or API behavior — and when the model would otherwise guess, hedge, or assert a fact the workspace cannot confirm. The argument contract follows unchanged, then the variant's own closing obligation (read the page with `web_fetch`, or use the returned snippets) and the citation rule. The tool description carries a shorter form of the same trigger, so the obligation appears wherever the schema is read.

The paragraph is package-owned model-facing text, beside the contract and citation sentences it now precedes. It is not a `tool-web` Config field: the text is a model-facing obligation rather than a deployment-varying setting, and two deployments that disagree about it disagree about model behavior, which neither composition would show.

The `aeven` preset mounts `@aeven/time-context` with `refreshIntervalMs: 300000`. A session on that preset reads an ISO timestamp with numeric offset and IANA zone, its request's browser zone, and elapsed time, at least once every five minutes; the interval suppresses the per-step injection a fast tool loop would otherwise pay for.

Neither half is enforcement. A session can still answer from memory, and nothing in the tool pipeline inspects whether a factual claim was searched for.

This record owns the model-facing policy text and the clock row alone. [Default Web search in shipped compositions](2026-07-31-web-default-search.md) and [Shared-base Web fetch default](2026-09-01-shared-base-web-fetch-default.md) continue to own provider selection, credential resolution, the search endpoint and timeout, and which tools each profile exposes.

## Verification

`packages/web/tool-web/tests/tool-web.spec.ts` pins the search-first paragraph and both closing obligations verbatim, renders the complete guidance through an unrestricted and a scoped tool registry for every combination of visible web tools, and checks the tool description's advertised query bound. The keyless snapshot lane pins the settled guidance in the `system-prompt.expected.md` sidecar of every shipped profile that exposes the tool, and the description in its `tool-schemas.expected.json`.

## Alternatives considered

**State the policy in the deployment persona.** Rejected because the tool section renders exactly while `web_search` is visible: the policy then travels with the capability and disappears from a composition that has no web tools, while a persona sentence would have to be repeated in every preset and would outlive the tool it describes.

**Mount the clock in `packages/bundle/base/cordis.patch.yml`.** Rejected because each reading is a durable user message in the model history, and the shared base serves profiles that never ask a time-sensitive question. The agent preset is the plane that decides what one session carries, so the clock is a preset row and `sdk-minimal`, ACP, and custom base-only profiles keep an unchanged history.

**Make the policy a `tool-web` Config field.** Rejected for the reason stated in the decision: a deployment that wants different wording wants different model behavior, and a string override would hide that difference from both compositions.

**Trigger a search mechanically, through a pre-step policy or a hook.** Rejected because search necessity is a judgment about the question. A keyword rule misses the time-sensitive question that carries no keyword, and a search on every turn spends an auxiliary model call on turns that need none.

## Consequences

Every request that exposes `web_search` pays for the policy paragraph, and a session on the `aeven` preset pays one short user message per five minutes. In exchange, the decision to search rests on a stated obligation and a visible date rather than on recall.

Free-text guidance is the weakest mechanism that fits: it competes with the session's other instructions for attention, and a session that ignores it fails silently rather than loudly. The stronger alternatives — a keyword rule, a per-turn search, or a required citation on factual claims — each misfire on the questions they are meant to catch or spend a model call on every turn.

The policy text is model-visible prompt content, so editing it refreshes the system-prompt sidecars of every shipped profile in the same change (`pnpm run test:snapshot:refresh`).
