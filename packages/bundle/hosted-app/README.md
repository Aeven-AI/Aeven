---
description: "The avn hosted bundle: the web patch layer narrowed for a Host that Aeven operates for many accounts, which runs no command outside a per-account jail and no file operation on its own machine and keeps no setting one account could change for another."
kind: "package-bundle"
---

# @aeven/hosted-app

English | [中文](README.zh.md)

## Summary

`@aeven/hosted-app` is the bundle layer for Aeven Web served to many people from one Host. It applies after `@aeven/web-app` and states two rules as rows: nothing runs on the Host's machine for a session, and nothing one account changes applies to another. Filesystem, terminal, the Host's browser, device, computer-use, code runtime, workflow workers, code subagents, the skill catalog, and workspace folders are off; the `preview_*` browser tools stay and reach the reader's own browser through the Aeven extension, and the shell runs only with `AVN_HOSTED_SANDBOX=1`, each command inside its account's [jail](../../sandbox/sandbox-jail/README.md); web search and fetch, imagine, attachments, memory, and in-process subagent delegation stay. Account settings resolve per signed-in account, and the sync provider keeps an encrypted connection for every account signed in here. Each served page also states the reader's country from the edge's `countryHeader` (Cloudflare's `cf-ipcountry`) as `__AVN_READER_COUNTRY__`, which starts the WhatsApp country-code box. With `googleAnalyticsId` set, each served page also loads that Google Analytics 4 property's gtag; the bundle sets the aeven.io property, and no other composition loads one. The bundle mounts the console logger at info level, so Host plugin warnings and errors reach the service log.

Boot it with `avn hosted`, which composes base, web, and this bundle on port 3085 unless `AVN_HOSTED_PORT` names another. `AVN_HOME` decides where the deployment keeps its state, `AVN_HOSTED_HOST` the address the server binds, and `AVN_HOSTED_TRUSTED_HOSTS` the public names a browser may reach it by; TLS, the public name, and request limits belong to the proxy in front.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

`avn hosted` is the only supported launch. A deployment sets `AVN_API_URL` and `AEVEN_SYNC_URL` to the API and relay it serves, and `AEVEN_SOCKET_URL` to the API's account socket (default `wss://aeven.io/socket`), names its public hosts in `AVN_HOSTED_TRUSTED_HOSTS`, and points its proxy at the bound address with WebSocket upgrade for `/sync` and the client socket. Sessions, workspaces, memory, personalization, automations, connectors, mail, and sync key by the signed-in account; settings written through the browser are refused, because the settings document belongs to the Host.

## Understand the implementation

The bundle is one `cordis.patch.yml` applied over the web layer. A patch replaces the targeted row's whole `config`, so every row here restates every key it owns, and the preset tool rows are disabled in the same file so no preset re-enables them. `src/limits.ts` admits model streams per account and in total, queueing a request behind that account's own queue and refusing one that would exceed either bound.

## Further Exploration

- [Agent Note: Hosted Aeven Web for many accounts](../../../.agents/notes/implemented/feature/2026-11-05-hosted-web-host.md)
- [Web app bundle](../web-app/README.md)

## Model Experience

None, as the bundle adds no prompt section and no tool of its own: it removes the tools that would reach the Host's machine, so a hosted session's model sees the conversation, web, memory, and attachment tools only.

#### KV Cache effect

None of its own; requests keep whatever caching the remaining tools and the system prompt already produce.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No quotas or rate limits for public sign-up** — request admission bounds concurrent streams per account and in total; it does not gate account creation, spend, or request frequency.
- **Account data is not encrypted at rest** — each account's sessions, memory, and sync database live in its own directory under the deployment's home, readable by whoever operates the Host.
- **Code runs only in the account's jail** — without `AVN_HOSTED_SANDBOX=1` a hosted session cannot run a command; with it, commands run in a disk-limited account folder and reach only GitHub, the npm registry, and PyPI through the jail's egress proxy, which bounds each account's connections and bytes, the files they list as outputs are shown at the call, uploads are mounted read-only, the model can read files and images in that folder, and the Files sidebar shows it read-only, while file writes, file search, and the Host's browser stay off.
- **Images are served per session** — the deployment refuses fingerprint-only reads, so hosted images carry no cache-forever URL.
- **Memory work is bounded, not isolated** — embeddings run in the Host process, so a large catch-up for one account still costs the others latency.


### Dev Note

No invariant companion is published: the bundle owns no independent runtime relationship, only row configuration that its own composition and tests observe.
