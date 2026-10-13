---
description: "Deferred tool discovery for deployments and maintainers deciding which tools leave the model request, how the model finds and loads them, and what the request limit and prompt cache cost."
kind: "package-reference"
---

# @aeven/tool-search

English | [中文](README.zh.md)

## Summary

`avn-tool-search` keeps specialist tools out of the model request until the model asks for them. Tools whose names match the configured patterns (every MCP server's `mcp__*` tools by default) are listed by name in a deferred tool index in the system prompt, grouped under a readable title per namespace, together with the MCP servers that are configured but not serving and why. The model reads the index, lists matching tools with a keyword query, and loads exact tools with `select:`. Add it when an agent carries more tools than a provider accepts in one request (128 for the Aeven and DeepSeek APIs) or when tool schemas dominate the prompt. The cost is one extra model step whenever a task needs a deferred tool.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>

## Use this package

### Configuration

```yaml
- id: tool-search
  name: '@aeven/tool-search'
  config:
    defer: ['mcp__*', 'grok_imagine_*', 'mail_*']
    groups:
      - title: Image and video generation
        tools: [grok_imagine_*]
    maxResults: 8
    maxRequestTools: 128
```

| Field | Default | Meaning |
|---|---|---|
| `defer` | `['mcp__*']` | Tool name patterns kept out of the request until loaded; `*` matches any run of characters |
| `groups` | `[]` | Titles for deferred tools outside MCP servers; the first group whose `tools` patterns match a name titles it, and unmatched names fall under `Other tools` |
| `maxResults` | `8` (1–20) | Tools one keyword query lists at most; a model-supplied `max_results` cannot exceed it |
| `maxRequestTools` | `128` | Most tools one model request may declare; a `select:` that would exceed it is refused, and an assembly whose undeferred tools alone exceed it fails |

An MCP server's namespace title is the `title` its [`@aeven/mcp-client`](../../mcp/mcp-client/README.md) instance reports, else its server name.

### Query forms

`tool_search` takes one `query` string:

- **Keywords** list up to `maxResults` matching tools with the first sentence of each description, and load nothing. A tool name or namespace title match outranks a description match, a keyword prefixed with `+` must appear in the name or title, and a tool whose only evidence is one description word is not listed.
- **`select:<name>[,<name>...]`** loads exact tools from the index. Names that are not deferred are reported beside the loaded ones; a name under a server that is not serving reports that server's state and the restart query.
- **`restart:<server>`** connects an MCP server that the index lists as not serving and reports the tools it registered.

### Loading into the request or into `run_code`

How `select:` loads depends on the agent's tool presentation. When the agent's request presents `run_code` ([PTC mode](../tools/README.md) `both` or `ptc`), `select:` returns the tools' SDK declarations in the mounted code runtime's language and the model calls them inside a program as `tools["<name>"](args)`; the request's tool list never changes. Otherwise `select:` returns the tools' schemas and adds them to every following request of that agent.

-----

<a id="understand-the-implementation"></a>

## Understand the implementation

The plugin listens to `system-prompt/assemble`. For an agent, it removes deferred tools from the assembled tool list (keeping natively loaded ones), appends the index section, and drops `tool_search` itself when nothing is deferred and no server is down. The index text is rendered on the agent's first request and then stays fixed; on each later step an `agent/pre-step` listener compares the current index with the one the model last received and, when they differ, adds one logged user message carrying the complete replacement index. `agent/session-start` with source `compact` discards the fixed index, so the request after compaction renders a current one.

Server state comes from the agent-scoped `mcp/servers` waterfall that `@aeven/mcp-client` answers. A server is listed as not serving when its state is not `connected` and its tool names match the defer patterns.

The natively loaded set is per agent. On first use it is rebuilt from the session's raw `tool/call` and `tool/result` events, reading the `Loaded tools:` line of each successful `tool_search` result; raw events survive compaction, which rewrites only derived history. Declarations returned for `run_code` start with `Declared for run_code:` and add nothing to the set.

-----

<a id="model-experience"></a>

## Model Experience

### Tool index in the system prompt

#### What the model sees

A `deferred-tools` system-prompt section when at least one tool is deferred or one deferring server is not serving. One line per namespace names every deferred tool, loaded or not: `- <title>: <prefix>{<name>, ...}` for an MCP server and `- <title>: <name>, ...` for a group of native tools, sorted by title. A `Not serving now:` block follows when servers are down, one line each: `- <title> (<prefix>*): <stopped|reconnecting|starting>[ after: <error>]. tool_search "restart:<server>" connects it again.` The opening line depends on whether the request presents `run_code`.

##### Opening line without run_code

```markdown
Deferred tools: their schemas are not loaded, so they cannot be called yet. tool_search "select:<name>[,<name>...]" loads exact tools, callable from your next step; a keyword query lists matching tools with what they do and loads nothing.
```

##### Opening line with run_code

```markdown
Deferred tools: call them inside run_code as tools["<name>"](args). tool_search "select:<name>[,<name>...]" returns their declarations; a keyword query lists matching tools with what they do and loads nothing.
```

#### Token effect

The section costs the tool names and titles, far less than the schemas it replaces: one deferred MCP tool costs its name instead of its full schema. Each deferred tool's schema leaves every request until it is loaded natively.

#### KV Cache effect

The section is rendered once per agent and stays byte-identical until compaction, so connecting, losing, or restarting a server does not change the system prompt. Native loading adds schemas to the request's tool list, which invalidates the cached prefix from the tool list onward on the next request; loading for `run_code` changes neither the tool list nor the system prompt.

### Index update message

#### What the model sees

When the index changes after the first request, the next step carries one user message from this plugin with the complete current index, or `Deferred tools: none.` when nothing is deferred.

##### Message text

```markdown
The deferred tools changed. This index replaces the one in the system prompt and any earlier update:
<index>
```

#### Token effect

One index's worth of tokens per change; no message while the index is unchanged.

#### KV Cache effect

Append-only: the message joins the conversation like any context message and leaves earlier tokens untouched.

### tool_search calls and results

#### What the model sees

The `tool_search` schema registered in [`src/index.ts`](src/index.ts). Keyword results list one line per tool, `- <name> (<title>): <first sentence>`, and end with the exact `select:` query for them. A native `select:` result starts with `Loaded tools: <names>` followed by one `<function>{schema}</function>` line per tool; a `run_code` `select:` result starts with `Declared for run_code: <names>`, then `Call them inside run_code as tools["<name>"](args).`, then the fenced SDK declarations. A `restart:` result reads `<title> is connected. Its tools: <names>.`

#### Token effect

A keyword result costs one short line per listed tool. A `select:` result costs the selected schemas or declarations once in history; native loading also adds the schemas to every following request.

#### KV Cache effect

Results are append-only history. Native loading changes the next request's tool list as described for the tool index.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Ranking is lexical** — keyword queries match name, title, and description words; a request phrased in words none of those contain lists nothing, and the model falls back to the index.
- **Declarations leave history at compaction** — a tool declared for `run_code` must be selected again after compaction before the model can see its arguments; calling it without the declaration still works when the arguments are right.
- **A tool's schema is checked against `maxRequestTools` only by count** — a provider limit on total schema bytes is not enforced here.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open design questions and directions that are not decided. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above, the package code, and the linked Agent Notes.

- Whether `run_code` loading becomes the default depends on a discovery evaluation of program-writing reliability on Aeven-1.0-Flash; the [deferred tool discovery Agent Note](../../../.agents/notes/implemented/feature/2026-10-07-deferred-tool-discovery.md) records the trade-off.
- Re-declaring tools that compaction removed from history, or promoting frequently used ones into the request at compaction, are open directions.

</details>
