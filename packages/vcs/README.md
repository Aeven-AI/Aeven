---
description: "The vcs group map: source control as one capability seam — the ctx.vcs definition, the git provider, and the model-facing git tools, for users and maintainers composing repository work."
kind: "package-group"
---

# vcs/ — Version control

## Summary

The vcs group gives agents a working understanding of the repository they are editing: which branch is checked out, what is staged and what is not, what a change contains, what landed recently, and how to record the next commit without guessing. The capability is split across three product packages: the `avn-vcs` seam (`ctx.vcs`) that selects a provider and normalizes every report, the `avn-vcs-git` provider that carries out the operations with git through `ctx.subprocess`, and the model-facing `avn-tool-vcs` tools that own the `git_*` schemas and presentation. The group ships no forge integration: pull requests, reviews, and merge queues are not part of it.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`vcs/`](vcs/README.md) | Defines the capability: provider registry, repository resolution, and normalized status, diff, log, staging, commit, branch, remote, and merge operations | `ctx.vcs` |
| [`vcs-git/`](vcs-git/README.md) | Carries those operations out with git through `ctx.subprocess`, with bounded output and structured failures | registers on `ctx.vcs` |
| [`tool-vcs/`](tool-vcs/README.md) | Exposes `git_status`, `git_diff`, `git_log`, `git_commit`, `git_branch`, `git_remote`, and `git_merge` to the model | registers on `ctx.tools` |

Providers register operations, not tools: `tool-vcs` owns every model-visible name, schema, and rendering, so a second engine can answer the same calls without changing what the model sees.

-----

<a id="related-documentation"></a>
## Related documentation

- [Version control subsystem](../../docs/subsystems/vcs.md) — operations, per-side change reporting, bounds, and `VcsError` codes.
- [Source control as a capability Agent Note](../../.agents/notes/implemented/architecture/2026-10-30-source-control-as-a-capability.md) — why the operations are a seam, and what stays deferred.
- [Generated tool catalog](../../docs/tool-catalog.md) — the `git_*` schemas the model receives.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
