---
description: "The signed-in account's data rights on a Host: a streamed zip export of everything the account keeps here and on the Aeven API, and erasing the local data of an account the API purged."
kind: "package-reference"
---

# @aeven/host-account-data

English | [中文](README.zh.md)

## Summary

`@aeven/host-account-data` serves `GET /api/account-data/export`, the download behind Settings → Account → Export data. The response starts at once: the zip is written while the browser reads it, files are opened only when the archive reaches them, and the Host holds one chunk and at most one chat log in memory. Small text is deflated at level 1; media and large files are stored. The Aeven API's copy of the account (`GET /api/account/export`) is fetched beside the local walk and written last.

Deleting an account on the Aeven API starts a 30-day grace period; the API then purges it and keeps only the SHA-256 of the user id, which is also the name of the account's home directory. This service asks `POST /api/account/deleted` about every account it holds data for, at start and on an interval, and erases each purged one, so every desktop and the hosted copy forget the account without being online when it was deleted.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

```yaml
- id: account-data
  name: '@aeven/host-account-data'
  config:
    apiUrl: !!js process.env.AEVEN_API_URL ?? 'https://aeven.io/api'
```

| Field | Default | Meaning |
| --- | --- | --- |
| `apiUrl` | required | Aeven API origin. |
| `credentialRef` | `AEVEN_TOKEN` | Credential holding each user's Aeven access token, used for the API copy. |
| `checkDelayMs` / `checkIntervalMs` | 60 s / 6 h | When purged accounts are looked up. |
| `compressMaxBytes` | 8 MiB | Largest text file deflated; `0` stores everything and spends no CPU on compression. |
| `compressionLevel` | 1 | Deflate level for compressed entries. |
| `chatFiles` | absent | A device-wide folder included in every account's export and never erased; the desktop sets its chats folder. |
| `maxConcurrentExports` | 0 (unlimited) | Exports streaming at once across accounts; beyond it the route answers 429. |
| `maxBytesPerSecond` | 0 (unlimited) | Throughput cap per export. |
| `skipDirectories` | `node_modules`, `.venv`, `venv`, `__pycache__` | Directory names left out of every exported tree: installable tooling, not the account's data. |

`GET /api/account-data/export/progress` answers `{ fraction }` for the caller's running export: bytes read into the archive against an estimate that sizes the non-chat sources up front and the chats from their measured average, never 1 before the archive ends. Settings shows it as a bar. Each account streams one export at a time whatever the limits; a second request answers 429 until the first finishes or is cancelled. The hosted bundle allows two exports at 25 MB/s each.

Plugins that keep per-account data register a source:

```ts
import { rm } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@aeven/host-account-data'

export function registerRecordings(ctx: Context, dirOf: (owner: string) => string): void {
  ctx.inject(['accountData'], (scoped) => {
    scoped.effect(() => scoped.accountData.register({
      name: 'recordings',
      export: async (owner, out) => { await out.directory('recordings', dirOf(owner)) },
      erase: async (owner) => { await rm(dirOf(owner), { recursive: true, force: true }) },
    }), 'recordings: account data')
  })
}
```

`owners()` is optional and lists the accounts a source holds data for, so the purge check finds them.

<a id="understand-the-implementation"></a>
## Understand the implementation

The archive is a `yazl` zip (ZIP64 when it passes 4 GiB). Entries are added with `addReadStreamLazy`, so a file descriptor opens only when its entry is written, and a file removed since the walk becomes an empty entry. yazl keeps every entry until it writes the central directory, so a producer must not hold its content after its one call. The output is pulled one chunk per read, so the archive advances only as the download drains.

Sources registered here: chats (every session log the account owns, decoded to JSON Lines, with the images and files attached in them), memories (every record, read page by page), and the account home directory (skills, automations, connector settings and message stores). The home export leaves out credentials: `credentials.json`, Telegram sessions, WhatsApp device keys, the sync replica, the memory store, connector caches, and lock files. Recordings, personalization, the Aeven folder, skills and connected services, message feedback, and the managed chat folders of `working-directory` register their own sources.

No runtime invariant companion is published; the sources own their stores, and an export or erasure is one pass over them with no second observation to check.

<a id="model-experience"></a>
## Model Experience

None, as the export and erasure never reach the Session log, a model request, or the system prompt.

#### KV Cache effect

None; no request content changes.

## Known Limitations and Deferred Work

- A 429 reaches a browser download as a failed download; the page does not yet explain it.
- Session recovery copies under `recovery/` are not attributed to an account, so a purge leaves them.
- A session still running when its account is purged refuses deletion; the next check erases it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The design and the alternatives considered are in the [Agent Note](../../../.agents/notes/implemented/feature/2026-11-17-account-data-export-and-deletion.md).

</details>
