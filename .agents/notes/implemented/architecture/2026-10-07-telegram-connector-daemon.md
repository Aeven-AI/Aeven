# Agent Note: Telegram connectors run a vendored Node daemon per account

Status: implemented

English | [中文](2026-10-07-telegram-connector-daemon.zh.md)

## Problem

The WhatsApp connector established a shape for a messaging provider whose account is a device or a session rather than an OAuth grant: the Host owns one supervised daemon per linked account, mounts the daemon's tools per conversation, and drives pairing from Settings. Telegram needs the same shape, but its upstream building block differs in three ways that decide the implementation:

- [`bstuff/telegram-mcp`](https://github.com/bstuff/telegram-mcp) speaks **stdio only**. Its entry reserves stdout for JSON-RPC, so nothing can read a bound address or a sign-in state from it.
- Sign-in is an **interactive CLI** (`bin/login.ts`, readline over a terminal). The phone → code → 2FA exchange has no machine API, and a browser cannot drive a terminal prompt.
- The session is a **teleproto session string** in a file, not a directory the daemon locks and caches, and `my.telegram.org` application credentials are required for the whole process.

## Decision

Vendor the upstream source under `native/telegram-mcp/source/` at a pinned commit and keep every Aeven addition in separate files under `native/telegram-mcp/aeven/`, so an upstream sync replaces the tree without replaying patches. The additions are:

- `aeven/daemon.ts` — a loopback HTTP daemon that mounts the upstream `createServer()` tool list on a Streamable HTTP transport, announces `{"listening":"127.0.0.1:<port>"}` as its only stdout line, exits when stdin closes, and requires a per-process bearer token on every route. It adds `/status`, `/login/start`, `/login/code`, `/login/password`, and `/logout`, which mirror the WhatsApp daemon's `/status` and `/logout`.
- `aeven/auth.ts` — sign-in as a resumable state machine over an injectable port, so the step handling and the HTTP surface are testable without a network or an account.
- `aeven/teleproto.ts` — the port's teleproto implementation. Telegram's client offers one long-running `start()` with callbacks, so each callback parks on a deferred value that a control endpoint resolves; a rejected step re-arms its deferred, which lets the user type another code or password on the same step.
- `aeven/server.ts`, `aeven/tools.ts`, `aeven/refs.ts`, `aeven/rights.ts`, `aeven/moderation.ts`, `aeven/groups.ts`, and `aeven/api.ts` — the tools upstream does not ship. `createTelegramServer()` registers them on upstream's server, so the served list is upstream's 33 plus 18: blocking and spam reports, member administration, group and channel settings, invite links, joining and leaving, and one raw tool that reaches any request class in teleproto's generated schema by name. `aeven/refs.ts` resolves a person by id, @username, link, or name, and looks an id the dialog cache cannot resolve up in the member list of the chat the tool was given, because that list carries the access hash the bare id lacks; `aeven/rights.ts` maps the right names the tools accept onto the fields Telegram puts on the wire.

The connector keeps one row, one data directory, one daemon, and one `mcp__account_<id>__` namespace per account, exactly as WhatsApp does, and rejects a second attempt for an account already signed in by Telegram user id rather than by phone number or name.

Deployment-owned application credentials are named by credential references (`telegramApiIdRef`, `telegramApiHashRef`, defaulting to `TELEGRAM_API_ID` and `TELEGRAM_API_HASH`), resolved in the Host at spawn time, and passed only in the child's environment. No user account, browser response, tool schema, or model request carries them, and users never visit `my.telegram.org`.

Permissions follow the tool annotations: the 20 tools marked `readOnlyHint` — upstream's 17 and the three Aeven listings — run directly, and the 31 that change a real account sit behind the existing `ask` gate. `native/telegram-mcp/tests/daemon.spec.ts` fails if the served annotations and `aeven/tools.ts` drift apart, and `packages/host/account-integrations` mirrors that list for the gate.

## Alternatives considered

**Mount upstream stdio through `@aeven/mcp-client`.** The MCP client already supports `transport: 'stdio'`, and the Google connectors spawn a Node MCP child that way, so this needs no vendor change. Rejected because the process would then be owned by the per-conversation mount rather than by the connector: there is nowhere to hold a sign-in attempt across browser requests, no `/status` to read, and no place to end a session on unlink.

**Fork the upstream CLI for a programmatic login only.** Driving `login.ts` by writing to its stdin works when stdin is not a terminal, but it means parsing prompts and error text, and the 2FA prompt is deliberately hidden. Rejected as brittle for a credential flow.

**Ship the Python `bssth/telegram-mcp` implementation.** A similarly named repository is Python + telethon, and would need a Python runtime in the Desktop seed. Rejected: the plan's Node/TypeScript upstream ships as plain JavaScript that runs on the Node the Host already spawns.

## Consequences

The Desktop package set packs one tarball of the compiled daemon (`packedTelegram`), because `native/` is not part of the `avn` release family; the connector resolves it from `@aeven/telegram-mcp` and spawns it with the Host's own runtime, so no external Node, npm, or npx is involved.

`native/telegram-mcp/tests/` covers the sign-in steps, the token gate, the control routes, the served 51-tool list, the Aeven-owned tool helpers, and the built entry as a child process. Live MTProto is not exercised: signing in a real account needs the deployment's registered application plus a phone, code, and 2FA password, so it stays a manual step (recorded in the package README's known limitations).

Upstream ships messaging, reading, media, and poll tools and nothing an admin needs, so moderation and administration stay Aeven-owned. They cover the actions Telegram's own clients take through MTProto: blocking, spam reports, bans and promotions, group settings, invite links, and joining or leaving. Banning and promoting exist only in supergroups, so a basic group is removed from with a different call, and `block_contact` never removes anyone from a group. Blocking and unblocking read the account's own block state back before reporting success, because Telegram answers those calls with a flag the tool does not have to trust. Everything else the schema offers stays reachable through `telegram_api_call`, which spares the daemon a tool per capability at the cost of a call shaped like the schema; `auth`, `account`, and `payments` are refused there, so signing in, account security, and spending real money remain outside the tool surface.
