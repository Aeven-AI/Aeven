---
description: "Host Remote readings of a Session workspace: directory listings, text previews, and bounded name search."
kind: "package-reference"
---

# @aeven/api-workspace-files

English | [中文](README.zh.md)

## Summary

`@aeven/api-workspace-files` owns the `workspaceFiles` Remote namespace, the Host half of the right sidebar's file explorer. `list` returns the direct children of a directory, `read` returns the leading page of a UTF-8 text file, and `search` walks the tree breadth-first for entries whose name contains a query. The workspace root is the Session header's `cwd`, with the sandbox policy's root as the fallback; every listing, preview, and search stays inside that root and nothing here writes. Both halves read the same composed filesystem as the model's file tools, so a deployment keeps one access policy for the explorer and for the agent.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

## Model Experience

### Workspace file readings

#### What the model sees

The tool `sidebar_files` with an optional `path`: it stats the path and asks the window showing the Session, through the `workspace-files/show` waterfall, to open a file in a preview tab of the explorer or expand the explorer to a folder inside the workspace. It returns one sentence naming what is shown, and fails when the path is missing, a folder lies outside the workspace, the file has no text or image preview, or no window answers within `showTimeoutMs`. The Remote namespace itself registers no prompt section or session event, so what a model reads of a workspace stays `avn-tool-fs`'s.

#### Token effect

Only the `sidebar_files` call and its one-sentence result; a listing, a preview page, and a search result are drawn in the browser and never join a request.

#### KV Cache effect

Append-only for `sidebar_files`: its result joins the conversation after the user's message. The Remote calls neither assemble nor change a model request.

## Known Limitations and Deferred Work

- **A preview is the head of a text file** — `read` returns at most `maxLines` lines and refuses a page above `maxBytes` instead of cutting it, and a file holding NUL bytes or one the filesystem refuses as text is reported not-text rather than decoded.
- **Search matches names, not content** — it walks directories breadth-first, compares entry names case-insensitively, stops at `searchMaxDirectories` or `searchMaxHits` and reports the truncation, and never descends into the names in `searchSkip`.
- **Invariant omission** — No invariant companion is published because every call recomputes its answer from the composed filesystem and retains nothing: the workspace confinement, the entry and line caps, and the byte refusal are enforced in the operation that builds each value, so there is no second observation to compare and no state that could drift between calls.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
