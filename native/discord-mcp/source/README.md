# Vendored subset

English | [中文](README.zh.md)

The Apache-2.0 pieces this package keeps from [`cappyeo/discord-mcp`](https://github.com/cappyeo/discord-mcp), and the pieces it deliberately does not.

| | |
|---|---|
| Upstream | `https://github.com/cappyeo/discord-mcp` |
| Commit cloned | `7ed828f9979f261fbb3ce94c440a8f46c28b5716` (2026-10-03, `perf: reduce discovery and initialization overhead in v0.31.1 (#77)`) |
| License | Apache-2.0, kept in [`LICENSE`](LICENSE) |
| Clone | `git clone --depth 1 https://github.com/cappyeo/discord-mcp /tmp/upstream-discord-mcp`, read-only |

## Copied files

The vendored TypeScript lives under `aeven/vendor/`, not under `source/`, because `tsconfig.build.json` compiles `aeven/**` with `rootDir: "aeven"` into `dist/`. `source/` carries the attribution record and this manifest.

| Upstream path | Kept at | Imports | Why it is kept |
|---|---|---|---|
| `LICENSE` | `source/LICENSE` | — | Apache-2.0 requires the license to travel with the copied files. |
| `packages/mcp-core/src/tools/_lib/untrusted.ts` | `aeven/vendor/untrusted.ts` | `node:crypto` | The nonce fence: a fresh 8-byte nonce per block, and the scan that defuses a lookalike tag contained in the text. Every Discord-authored value in this package's tool output passes through `wrapUntrusted` or `wrapMessages`. |
| `packages/mcp-core/src/tools/_lib/permissions.ts` | `aeven/vendor/permissions.ts` | `zod` | `PermissionString` holds a Discord permission bitfield as a base-10 string, because the bitfield exceeds `Number.MAX_SAFE_INTEGER`. `set_channel_permissions` takes its `allow` and `deny` arguments through it. |
| `packages/mcp-core/src/tools/_lib/snowflake.ts` | `aeven/vendor/snowflake.ts` | `zod` | The branded id schemas. `ChannelId`, `MessageId`, `UserId`, and `RoleId` are the tool argument schemas that reject anything which is not a 17-20 digit snowflake before a request is built; `Snowflake` is the unbranded base for an id that is neither. The file's remaining brands are upstream's vocabulary and are unused here. |

Copied files keep upstream's formatting and semicolons; `native/**` is outside the repository lint program ([`.oxlintrc.json`](../../../.oxlintrc.json) ignores it).

## Local modification

One file differs from upstream.

`aeven/vendor/untrusted.ts` extends `UntrustedKind` with the ten kinds this package renders — `messages`, `channels`, `members`, `roles`, `guild`, `thread`, `bans`, `automod_rules`, `invites`, `audit_log` — because upstream's vocabulary (`message`, `embed`, `webhook`, `username`, `channel_topic`, `template`, `audit_reason`) names single values while these tools return record sets. The fence mechanism, the nonce, the defusing scan, and `wrapMessages` are unchanged. A sync re-applies the ten added union members.

## Candidates not copied

Two upstream candidates pull in project-local or forbidden imports, so each has an equivalent here instead.

| Upstream path | Equivalent | Why not copied |
|---|---|---|
| `packages/mcp-core/src/tools/_lib/message-jump-url.ts` | `aeven/refs.ts` — `jumpUrl` | Imports `@sapphire/pieces` for its DI container and `../../rest/channel-guild-cache.js` to resolve a channel's guild. This package's guild is fixed by `DISCORD_GUILD_ID`, so the guild id is always known and no channel-to-guild cache exists. |
| `packages/mcp-core/src/tools/messages/_lib/message.ts` | `aeven/refs.ts` — `readableMessageText`, `componentText`, `embedText` | Imports `discord-api-types/v10` for `ComponentType.TextDisplay`. This package depends on `@modelcontextprotocol/sdk` and `zod` only, so the Components V2 number that module reads (`10`) is stated in `refs.ts` instead. |

## Deliberately not vendored

Upstream is a monorepo whose other three packages and roughly 275 tool modules exist to serve a multi-guild, multi-tenant, container-composed server. This package replaces that surface with 13 curated tools and 30 administration tools behind one fixed guild, so the following are left out on purpose.

- **The tool modules** under `packages/mcp-core/src/tools/` (`app_emojis`, `application`, `audit_log`, `automod`, `channels`, `commands`, `components-v2`, `emojis`, `events`, `guild`, `inspiration`, `intelligence`, `interactions`, `invites`, `members`, `messages`, `meta`, `monetization`, `onboarding`, `permissions`, `polls`, `reactions`, `roles`, `soundboard`, `stage_instances`, `stickers`, `templates`, `threads`, `users`, `voice`, `webhooks`, and the discovery/registry layer). `aeven/tools.ts`, `aeven/admin.ts`, and `aeven/moderation.ts` define the 43 calls this connector serves, written against `aeven/rest.ts`.
- **The middleware and access pipeline** (`middleware/`, `access/`, `preconditions/`, `pipeline/`, `identity-lock.ts`, `config.ts`). Guild allowlists, per-guild identity, and payload approval belong to a multi-guild server; here the guild is one environment variable and Aeven's own approval gate owns the decision.
- **The gateway client** (`gateway/`). The server is request-driven over stdio; it holds no Discord websocket.
- **The composer and preview machinery** (`tools/messages/_lib/composer.ts`, `tools/messages/_lib/delivery.ts`, `apps/`, `resources/`, `workflows/`, `stores/`, `pieces/`, `audit/`, `telemetry/`, `capabilities/`, `container.ts`). It builds and validates rich component trees before sending them; this package posts plain text, one file, and reactions.
- **`packages/mcp-server` and `packages/mcp-server-mocks`**. They are the deployment's entry points, transport assembly, and HTTP test doubles; the connector spawns `dist/main.js` instead and the suites in `tests/` stub `globalThis.fetch`.
