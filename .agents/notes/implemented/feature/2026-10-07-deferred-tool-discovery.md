# Agent Note: Deferred tool discovery that cannot overflow the request or the prompt cache

Status: implemented

English | [中文](2026-10-07-deferred-tool-discovery.zh.md)

## Problem

A web session on Aeven-1.0-Flash (2026-10-07) asked to open a page in the Chrome the user can see. Its log records how deferred tool loading failed. 62 tools were always in the request, because `@aeven/tool-search` deferred only `mcp__*` names. Three keyword searches for the browser loaded 68 unrelated connector tools: the query "chrome devtools navigate page browser window" matched Telegram's `get_history` ("within a time window") and GitHub, OneDrive, and Outlook tools through single description words, and every match was loaded for the rest of the session. The next request declared 130 tools and the gateway refused it (`tools may declare at most 128 tools`).

The browser tools never existed in that session. `chrome_devtools` and `playwright` were absent from all eight request headers, yet `preview_status` reported `toolPrefix: mcp__chrome_devtools__` and the `web_fetch` guidance named both prefixes, so the model spent turns guessing exact names that `select:` could only answer with a generic "No deferred tool is named …". The MCP supervisor stops for good after ten failed reconnects, so restarting Chrome could not bring the tools back.

Each successful load also discarded the prompt cache. In turn 6 the cached prefix fell from about 470 thousand tokens to 11,136 twice, because the tool list precedes the conversation in the rendered prompt; the two loads re-billed about one million input tokens. The index named connected accounts as `mcp__account_<24 hex>__{…}`, so Telegram, WhatsApp, GitHub, and Outlook were distinguishable only by id, and long names were cut and hashed (`list_reposit_26fbeb82e766`).

PTC mode could have carried deferred tools without touching the request, but its TypeScript SDK rendered 65 of those 68 connector tools as `args: unknown`: any keyword outside the enforced subset (a type array, `anyOf`, `minimum`, `$schema`) failed the whole schema. A program's 600-second wall clock also counted time a user spent deciding an approval.

## Decision

### Search lists, `select:` loads

`tool_search` keyword queries list at most `maxResults` (default 8, at most 20) tools with the first sentence of each description and load nothing. Name and namespace-title matches outrank description matches, and a tool whose only evidence is one description word is not listed. `select:<names>` loads; `restart:<server>` reconnects an MCP server. A native `select:` that would make one request declare more than `maxRequestTools` (default 128) tools is refused with the count, and an assembly whose undeferred tools alone exceed it fails at assembly instead of at the gateway.

### A titled, frozen index with update messages

The `deferred-tools` section names every deferred tool under a title per namespace: an MCP server's `title`, or a configured `groups` title for native tools. It also lists configured MCP servers that are not serving, with state, last error, and the restart query. The section is rendered on an agent's first request and stays byte-identical until compaction; a later change reaches the model as one logged `agent/pre-step` user message carrying the complete replacement index. Server state comes from the agent-scoped `mcp/servers` waterfall, which every `@aeven/mcp-client` instance answers with its title, state (`connecting`, `connected`, `retrying`, `failed`), last error, and a `restart()` that reconnects with a fresh attempt budget even after the supervisor gave up.

### Loading into `run_code` keeps the request fixed

When an agent's request presents `run_code`, `select:` returns SDK declarations in the code runtime's language and the model calls the tools inside a program. The request's tool list and system prompt do not change, so a load costs neither a cache miss nor request-limit headroom. Sub-calls run the full tool pipeline under their real names, so account approval policies apply unchanged. The `aeven` preset's `tool-presentation` row selects `mode: both` and stays disabled until the discovery evaluation shows Aeven-1.0-Flash writes these programs reliably; natively loaded tools remain the default.

### Typed SDK for every schema

`projectRenderableSchema` (`@aeven/tools`) maps any JSON Schema onto the enforced subset node by node before the TypeScript and Python renderers type it. Type arrays, `anyOf`, `nullable`, and single-member `allOf` become unions; local `$ref`s resolve with a cycle guard; dropped constraints become doc hints; an unsupported node widens only itself. On the 68 connector schemas from the session, 67 render typed parameters (the remaining one, `get_draft`, has none), at 0.83 of their JSON size. The registry holds a run's `CodeRunPauses` while one of its sub-calls waits for an approval, and the worker runtime stops its wall clock while paused.

### Truthful availability and readable names

`preview_status` reports `hostBrowser.toolsUnavailable` with the server's state, error, and restart query when no registered tool carries the browser prefix, and the `web_fetch` guidance names each browser server only while its tools are registered. Account connectors mount as `<provider>_<first 8 hex of the connector id>` with the title `<Provider> (<connector name>)`, so the index reads `Telegram (Olivier): mcp__telegram_1a2b3c4d__{…}`; the approval policy resolves connectors from the same name. The `aeven` preset defers built-in specialist groups (media generation, mail, memory, devices, the preview browser except `preview_status`, location, subagent control, and workflows), leaving 23 tools in every request.

### Resume and compaction

The natively loaded set is rebuilt from raw `tool/call` and `tool/result` events, which compaction leaves intact. `agent/session-start` with source `compact` discards the frozen index so the next request renders a current one.

## Alternatives considered

**Codex's turn-scoped working set** — clearing loaded tools at each user turn and re-discovering them bounds the request, but on a prefix-caching provider every clear and every reload re-bills the whole conversation; the session measured one such miss at about 465 thousand tokens. A fixed tool list with declarations in history bounds the request without any miss.

**A new `call_tool(name, args)` dispatcher** — a fixed transport tool would also keep the request stable, but approval policies and UI key on the executed tool name, so it needed a pre-identity call rewrite that the [pre-tool input rewrite note](../../proposed/feature/2026-06-30-pre-tool-input-rewrite.md) has not delivered. `run_code` already dispatches sub-calls under their real names through the full pipeline.

**Evicting least-recently-used loads near the limit** — keeps native loading working at the cap, but changes the tool list on eviction (another cache miss) and silently removes a tool the model may still call. Refusing the load with the count lets the model choose.

**Semantic retrieval for search** — embedding ranking could match paraphrased requests, but the measured failure was a lexical one (single common words loading unrelated tools); deterministic ranking with name and title weighting fixes it without a model dependency. It stays available if the evaluation finds paraphrase misses.

**Rewriting the index section on every change** — simpler than update messages, but any server connect or loss would invalidate the cached prompt from the system section onward.

**Per-agent tool restriction instead of deferral** — hiding tools by persona removes them from both request and index, so the model cannot discover them at all.

## Consequences

A request can no longer exceed the tool cap through loading, and keyword searches no longer accumulate unrelated tools. The always-sent set in the `aeven` preset falls from 62 to 23 tools. Under `run_code`, loading costs one model step and no cache miss; under native loading it still invalidates the cache once per load, which the evaluation weighs against Aeven-1.0-Flash's program-writing reliability. The worker runtime adds about 13 ms per `run_code` and about 0.1 ms per sub-call through the full pipeline, against a median model step of 9.3 seconds in the session.

The model now pays a step to reach a deferred built-in tool such as `preview_click`. Account tool names change from `mcp__account_<id>__` to `mcp__<provider>_<id>__`; logged sessions that loaded the old names lose those loads on resume. The `mcp/servers` routing entry was added to `scoped-events.generated.ts` by hand because `gen-scoped-events` fails on two existing violations (`capabilities/changed`, `message-feedback/changed`) on this branch.

## Testing

`packages/core/tool-search/tests/tool-search.spec.ts` covers the index text, groups, servers that are not serving, freezing with update messages, compaction, keyword ranking and caps, native and `run_code` loading, the request limit, restart, and rebuilding the loaded set from raw events. `schema-projection.spec.ts` pins the projection on a real Telegram MCP schema. `reconnect.spec.ts` covers connection states and `restart()`; `runtime.spec.ts` covers the paused wall clock; `ptc.spec.ts` covers the approval pause; the tool-browser and tool-web suites cover the availability reports.
