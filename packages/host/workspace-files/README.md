---
description: "Authenticated read-only HTTP route serving a registered workspace's files, so a file the agent produced can be referenced from a rendered model reply."
kind: "package-reference"
---

# @aeven/host-workspace-files

English | [中文](README.zh.md)

## Summary

A model reply rendered in the Web GUI can show an image, but only from an `http` or `https` URL — a filesystem path is refused by the renderer. `avn-host-workspace-files` is what gives a produced file such a URL: it registers one prefix route on the [webserver](../webserver/README.md) that serves `<mount>/<workspaceId>/<relative path>` from the canonical directory of a workspace in the [workspace registry](../../workspace/workspace/README.md). Every request passes Connection's Host/Origin fence and browser authentication before any path is resolved; traversal outside the workspace directory is 403, an unknown workspace id or absent file is 404, and non-GET/HEAD is 405. Serving is read-only: the route never writes, lists, or deletes.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Compose this plugin in a browser-facing host whose agent produces files the user should see in the conversation — a rendered chart, a screenshot, a generated diagram. It needs `webServer`, `connection`, and `workspaceRegistry`.

### Minimal configuration

```yaml
- name: '@aeven/host-workspace-files'
  config:
    mount: /workspace
```

`mount` is the absolute route prefix, without a trailing slash. It is configuration rather than a constant because a deployment that already owns `/workspace` for something else must be able to move this route without patching source.

### What the route serves

A GET or HEAD of `<mount>/<workspaceId>/<relative path>` reads that path under the workspace's canonical directory and returns its bytes. `workspaceId` is a registry id, not a directory name, so a URL never spells a host path. Known image, PDF, and text extensions get their content type; anything else ships as `application/octet-stream`, which browsers download rather than execute. Every response carries `X-Content-Type-Options: nosniff`, a `default-src 'none'; sandbox` content-security policy, and `Cache-Control: no-store`, so a rewritten file is served fresh under its unchanged URL and an SVG opened as a top-level document cannot run scripts or fetch anything.

### Exposure this route creates

The whole workspace directory becomes readable over HTTP to any client holding a valid browser session — source, dotfiles, and credentials included. The route is never public: `ctx.connection.requestRejection` runs before any path handling, so an unauthenticated caller cannot even distinguish a real workspace id from an invented one. A deployment that must not expose workspace contents over HTTP removes this row rather than reconfiguring it, and removes the surface prompt's workspace-URL sentence with it.

### Observable failures

An unknown workspace id, an absent file, and a directory target all return an empty 404 — the route never reveals which of the three it was. A path resolving outside the workspace directory returns 403. Non-GET/HEAD returns 405. Unauthenticated requests receive Connection's own 401 or 403.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

The package is one function plugin around `serveWorkspaceFile`. `apply` registers a prefix route under an effect scope, so disposing the fiber releases it and a reload re-registers cleanly. The handler authenticates, rejects non-GET/HEAD, strips the mount prefix, and hands the remainder to `serveWorkspaceFile` together with a closure resolving a workspace id to its directory. The registry lookup stays a closure rather than a parameter of the served path, so the serving logic never holds a service reference.

### The traversal fence

Two normalizations run in sequence, and only the second one is this package's. `new URL(...)` collapses dot segments before the route sees the path, so a plain `../` never survives to be resolved. An encoded slash does survive that step and only becomes a `..` segment once the handler decodes the pathname — which is why `serveWorkspaceFile` re-resolves the joined target and requires it to be the workspace root or stay under it. The check uses `sep` rather than `/`, because `resolve()` emits backslash paths on Windows where a `/` suffix would reject every legitimate subpath.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `serveWorkspaceFile` and `apply`: route registration, authentication order, traversal rejection, MIME and safety headers |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these when the serving contract is not enough: the route seat, the id source, and the composition that mounts this row.

- [Webserver](../webserver/README.md) — the named-route table this plugin registers into.
- [Workspace registry](../../workspace/workspace/README.md) — where a `workspaceId` and its canonical directory come from.
- [avn-web-app bundle](../../bundle/web-app/README.md) — the composition that mounts this row and states the URL form in the surface prompt.
- [Generated configuration catalog](../../../docs/config-catalog.md#aeven-host-workspace-files) — every accepted config field and its source declaration.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the [avn-web-app](../../bundle/web-app/README.md) surface prompt: it states the URL form, so a model that produced a file can reference it as `![alt](<webUrl>/workspace/<workspaceId>/<path>)` and have the reply render the image instead of reporting a filesystem path the renderer refuses.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the served surface is not yet enough. They are current package constraints, not a task backlog.

- **No invariant companion** — No runtime invariant companion is published because the only owned relation is this package's single named route, and the webserver already rejects a duplicate `(kind, path)` registration at `register()`. A teardown-stream probe would additionally false-positive on correct disposal, because `internal/plugin` fires before the disposing fiber's effects run and the legitimate owner still holds the route at notification time. Register/release symmetry is covered by the package's HMR-safety test instead.
- **Whole-directory exposure is the only granularity** — the route serves everything under a workspace directory to an authenticated reader. A deployment needing a narrower published subtree, or per-file rules, has no configuration for it and must omit the row.
- **No range requests or streaming** — every response reads the complete file into memory before writing it, so a large media file is served whole and a browser cannot seek within it.
- **The MIME table covers produced artifacts** — images, PDF, and common text types. Other extensions download as `application/octet-stream` until an asset class ships.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
