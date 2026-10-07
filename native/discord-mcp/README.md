# discord-mcp

English | [中文](README.zh.md)

Aeven's Discord connector server. The connector spawns one stdio MCP process per connected guild, so
a model working in one server can read it, post to it, and — when the deployment allows it —
administer it, without ever naming a guild in a tool call.

Every request authenticates as the deployment's own Discord application with
`Authorization: Bot <token>`. No user token exists in this package and no self-bot path is reachable
from it: Discord's user-token and gateway APIs are never called.

| Piece | Role |
|---|---|
| `aeven/main.ts` | Executable entry: validates the environment, builds the server, serves it over stdio, and exits when stdin closes |
| `aeven/rest.ts` | The REST client: bot authentication, bounded rate-limit retries, multipart upload, and fixed error sentences |
| `aeven/format.ts` | Tool text rendering, with every Discord-authored value inside a nonce fence |
| `aeven/refs.ts` | Discord record types, channel type names, jump links, and readable message text |
| `aeven/tools.ts` | The 13 curated tools |
| `aeven/admin.ts` | The 22 administration tools, registered only when enabled |
| `aeven/moderation.ts` | The 8 moderation tools, registered only when enabled |
| `aeven/lookups.ts` | The guild, channel, and role lookups both tool surfaces share |
| `aeven/vendor/` | Apache-2.0 pieces copied from upstream; see [`source/README.md`](source/README.md) |
| `scripts/build.ts` | Compiles `aeven/` into `dist/`; the connector spawns `dist/main.js` |
| `tests/` | The tool surface, the REST client, fencing, search, local validation, the upload body, and environment validation, without network access |
| `dist/` | Build output, git-ignored |

## One process per guild

The connector starts a child process per connected guild and passes that guild in the environment.
Nothing about the guild travels in a tool argument, so a model cannot address a server it was not
connected to, and a stale answer from one server cannot name a channel in another. Two connected
servers are two processes, each limited by the Aeven API's proxy to its own guild.

## Environment

| Variable | Required | Meaning |
|---|---|---|
| `DISCORD_AUTHORIZATION` | yes | `Authorization` header value of every Discord request. Aeven's connector passes `Bearer <owner's Aeven session>` and points `DISCORD_API_BASE` at the Aeven API's Discord proxy, which holds the bot token. Absent or empty, the process refuses to start. |
| `DISCORD_GUILD_ID` | yes | The one guild this process serves. |
| `DISCORD_GUILD_NAME` | no | Name shown in tool output before a guild lookup fills the cache; without it the first lookup fetches the guild. |
| `DISCORD_ADMIN_TOOLS` | no | `1` registers the 30 administration tools. Anything else registers only the curated 13. |
| `DISCORD_MAX_SCAN_MESSAGES` | no | Most messages one `search_messages` call scans, 1–5000. Default `500`. |
| `DISCORD_MAX_FILE_BYTES` | no | Largest file `send_file` uploads, 1–536870912. Default `10485760`. |
| `DISCORD_REQUEST_TIMEOUT_MS` | no | Network budget of one logical call, 1–300000. Default `20000`. |
| `DISCORD_API_BASE` | no | Discord REST base. Default `https://discord.com/api/v10`. |

An unset or empty variable takes its default; a required or out-of-range one fails at start with the
variable's name, never a guessed value. stdout carries the MCP stream and nothing else — every log
line goes to stderr.

## Tools

### Curated surface — always served

| Tool | Arguments | Discord call |
|---|---|---|
| `list_channels` | `type?` | The server's channels without threads: id, name, type, category, topic |
| `get_channel` | `channel_id` | One channel or thread: name, type, category, topic, slowmode, and for a thread its parent, owner, counts, and archive state |
| `get_messages` | `channel_id`, `limit?` (1–100, default 50), `before?`, `after?` | Recent messages, newest first, as `[id] ISO-time author: text` with attachment, embed, and reaction summaries. `before` and `after` are mutually exclusive |
| `get_thread` | `thread_id`, `limit?`, `before?`, `archived?` | A thread's own fields plus its messages; `archived` lists the parent channel's archived public threads |
| `search_messages` | `query`, `channel_id?`, `limit?`, `pages?`, `before?` | Case-insensitive substring match over recent messages of one channel or of the server's text channels, under a scan budget, with a coverage line |
| `list_members` | `limit?` (1–1000, default 100), `after?`, `query?` | Server members with their display names and roles |
| `get_guild_info` | none | The server's own record: name, id, owner, counts, description, boost tier, locale, features, role count |
| `send_message` | `channel_id`, `content` (1–2000) | Posts as the bot; returns the new message id and jump link |
| `reply_message` | `channel_id`, `message_id`, `content` | Posts a reply referencing that message |
| `add_reaction` | `channel_id`, `message_id`, `emoji` | Adds the bot's own reaction; `emoji` is a glyph or `name:id` |
| `remove_reaction` | `channel_id`, `message_id`, `emoji` | Removes the bot's own reaction |
| `send_file` | `channel_id`, `file_path`, `caption?`, `reply_to_message_id?` | Uploads one file from this computer |
| `create_thread` | `channel_id`, `message_id?`, `name`, `auto_archive_duration?`, `rate_limit_per_user?` | Opens a thread, anchored on a message when one is named and standalone otherwise |

### Administration surface — `DISCORD_ADMIN_TOOLS=1`

| Group | Tools |
|---|---|
| Roles | `list_roles`, `create_role`, `edit_role`, `delete_role`, `assign_role`, `remove_role` |
| Members | `kick_member`, `get_member`, `edit_member`, `timeout_member`, `clear_timeout` |
| Bans | `list_bans`, `get_ban`, `ban_member`, `bulk_ban_members`, `unban_member` |
| Messages | `delete_messages`, `purge_messages` |
| Channels | `create_channel`, `edit_channel`, `delete_channel`, `set_channel_permissions` |
| Invites | `list_invites`, `revoke_invite` |
| AutoMod | `list_automod_rules`, `create_automod_rule`, `edit_automod_rule`, `delete_automod_rule` |
| Audit log | `read_audit_log` |
| Server | `edit_guild` |

Off by default: a deployment serves these names only when the administrator sets the variable, and
each call carries an optional `reason` that Discord records in the audit log. Their permission
bitfield is the deployment's, not this package's.

Kick, ban, and role tools need the bot's highest role above the target's, a bot cannot kick or time
out the server owner, and a timeout a bot sets never outlives the 28-day maximum.

## What the bot needs in the Discord Developer Portal

- **Message Content intent.** Without it Discord returns empty message bodies, and `get_messages`
  and `search_messages` report only the text carried by Components and embeds.
- **Server Members intent.** `list_members` and `get_member` read `GET /guilds/{id}/members`, which
  Discord refuses with 403 until the administrator enables this privileged intent for the Aeven
  application. The refusal is reported as that precondition, not as a generic permission error.
- **The permission bitfield the host requests at install.** The curated surface needs View Channels,
  Read Message History, Send Messages, Send Messages in Threads, Create Public Threads, Attach
  Files, Add Reactions, and Embed Links. A deployment that also serves the administration surface
  adds Manage Roles, Manage Channels, Kick Members, Ban Members, Moderate Members, Manage Messages,
  Manage Threads, Move Members, Manage Server, and View Audit Log. Discord reports a channel or role
  that denies one of these as a permission error; that is the server's own setting.
- **The bot must be in the guild.** A lookup Discord answers with 403 or 404 means the bot left the
  guild or the guild is gone.

## Search

Discord's server-wide guild search endpoint accepts a user token only, so this package never calls
it. `search_messages` walks `GET /channels/{id}/messages` instead: one channel when `channel_id` is
given, otherwise every text and announcement channel of the guild, page by page, up to
`DISCORD_MAX_SCAN_MESSAGES` messages in total. It matches a case-insensitive substring of the
readable text — the message content, then Components V2 `TextDisplay` parts, then embed
title, description, fields, and footer — and reports each match with its channel and jump link. The
last line states how many messages and channels the scan covered and whether it was complete or
stopped at the budget. Results cover the recent window the line reports, never the whole history.

## Untrusted content

Channel names, topics, server names, member names, role names, message bodies, embed text, and file
names are other people's text. Each reaches tool output inside a block fenced by a fresh 16-hex
nonce — `<untrusted_discord_messages nonce="…">…</untrusted_discord_messages>` — and any lookalike
tag inside is defused before it is written, so Discord content cannot close its own fence. Status
lines and error sentences are written by this package and stay outside the fence. Errors never
repeat Discord's response body; they carry a fixed sentence and the HTTP status.

## Vendored subset

The nonce fencing, the base-10 permission string, and the snowflake id schemas come from
[`cappyeo/discord-mcp`](https://github.com/cappyeo/discord-mcp) at commit
`7ed828f9979f261fbb3ce94c440a8f46c28b5716` (2026-10-03), Apache-2.0, under `aeven/vendor/`. Upstream's
tool modules, middleware and access pipeline, gateway client, and composer machinery are not
vendored: the curated 13 and the administration 30 replace them. [`source/README.md`](source/README.md)
records every copied file, the one local modification, and each candidate implemented here instead.

## Build and test

```sh
pnpm --dir native/discord-mcp run build      # emits dist/main.js
npx vitest run native/discord-mcp/tests      # from the repository root
npx tsc --noEmit -p native/discord-mcp/tsconfig.build.json
```

## Known Limitations and Deferred Work

- **No gateway and no event listener.** The process is request-driven: it holds no Discord websocket
  and learns of new messages only when a tool reads a channel. Real-time delivery — message
  received, reaction added, member joined — is deferred to a later change with its own process
  design.
- **Rate-limit handling is per-process.** Each child process honours the 429 waits and bucket reset
  hints Discord returns to it, with a three-attempt cap and a fixed maximum wait. Two processes
  serving two guilds share no view of a global bucket, and no cross-process queue exists.
- **Message content is plain text.** `send_message` and `reply_message` post a string, so embeds,
  Components V2 trees, polls, stickers, and forum posts are deferred; `send_file` uploads exactly
  one file per call.
- **Search is a bounded walk.** Discord's guild search endpoint is user-token-only, so results cover
  the pages a call asked for, not the whole history. A query older than the covered window returns
  nothing rather than a partial answer, which the coverage line makes visible.
