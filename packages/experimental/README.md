---
description: "The experimental group map: private prototypes and internal-only plugins excluded from official releases, for users and maintainers navigating the group."
kind: "package-group"
---

# packages/experimental

English | [中文](README.zh.md)

## Summary

The experimental group contains prototype capabilities that are not part of any official release: they run on the real harness, but their contracts can change and they carry no support promise. The group holds the cross-realm Inspector, the CPython subprocess backend for the code-execution seam, the installed Cua Driver computer-use provider, the browser overlay that draws the agent's pointer, and the browser-worker runtime and image packer used by preview deployments. Use these packages to try an unreleased capability; they carry no stability promise, and released products must not depend on them.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`browser-overlay`](browser-overlay/README.md) | On-screen agent pointer and action feedback for a browser being operated | — |
| [`code-runtime-python`](code-runtime-python/README.md) | CPython subprocess backend for the code-execution seam | `ctx.codeRuntime` |
| [`computer-use-cua-driver-mcp`](../computer-use/computer-use-cua-driver-mcp/README.md) | Experimental local desktop control through an installed Cua Driver MCP executable | `ctx.computerUse` |
| [`inspector`](inspector/README.md) | Cross-realm CDP hub for Host debugging, Client Runtime inspection, network capture, and Cordis trees | `ctx.inspector` |
| [`subscription-auth`](../llm/subscription-auth/README.md) | Coding-subscription OAuth routes, quota reporting, and media generation | registers LLM routes and scoped tools |
| [`webworker-packer`](webworker-packer/README.md) | Builds the gzip-compressed VFS image consumed by the browser worker preview | library and CLI — no ctx key |
| [`webworker-runtime`](webworker-runtime/README.md) | Runs the harness plugin tree inside a dedicated browser worker | library and worker entry — no ctx key |

-----

<a id="related-documentation"></a>
## Related documentation

- [Experimental package decision](../../.agents/notes/implemented/architecture/2026-08-18-experimental-agent-teams-packages.md) — placement, release exclusion, and dependency isolation.
- [Code runtime subsystem](../../docs/subsystems/code-runtime.md) — the code-execution seam that the CPython backend implements.
- [Experimental subtree rules](AGENTS.md) — what experimental status does and does not relax.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
