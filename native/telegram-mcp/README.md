# telegram-mcp (vendored)

English | [中文](README.zh.md)

Aeven's Telegram connector daemon. The directory holds two things: a pinned copy of
[`bstuff/telegram-mcp`](https://github.com/bstuff/telegram-mcp) under `source/`, and the Aeven-owned
daemon entry under `aeven/` that the connector spawns.

| Piece | Owner | Role |
|---|---|---|
| `source/` | upstream, unmodified | MCP server over a personal Telegram account: `src/server.ts` registers 33 tools, `src/client.ts` owns the teleproto client and its session |
| `aeven/server.ts` | Aeven | The served server: upstream's 33 tools plus the Aeven-owned tools registered on the same instance |
| `aeven/main.ts` | Aeven | Executable entry: builds the sign-in adapter, starts the daemon, announces its address on stdout, stops when stdin closes |
| `aeven/daemon.ts` | Aeven | Loopback HTTP daemon: MCP at `/mcp`, account control at `/status`, `/login/*`, `/logout` |
| `aeven/auth.ts` | Aeven | Phone → code → 2FA, or QR scan → 2FA, sign-in as a resumable state machine, replacing upstream's interactive `bin/login.ts` |
| `aeven/qr.ts` | Aeven | Renders each `tg://login` token as the SVG QR code Settings shows |
| `aeven/teleproto.ts` | Aeven | teleproto-backed sign-in: parks Telegram's callbacks on the values the control endpoints resolve |
| `aeven/tools.ts` | Aeven | Which tools run without a prompt, and the names of the Aeven-owned tools |
| `aeven/refs.ts` | Aeven | Arguments and resolution shared by the Aeven-owned tools: a person by id, @username, link, or name, and a member inside a chat |
| `aeven/rights.ts` | Aeven | The two rights vocabularies: what a promotion grants, and what a group withholds from its members |
| `aeven/moderation.ts` | Aeven | Blocking, spam reports, and member administration: kick, ban, unban, list banned, promote, demote |
| `aeven/groups.ts` | Aeven | Group and channel administration: create, join, leave, name and description, member permissions, invite links |
| `aeven/api.ts` | Aeven | One raw tool that reaches every request class teleproto ships, apart from the refused namespaces |
| `scripts/build.ts` | Aeven | Compiles `source/` and `aeven/` into `dist/`; the connector spawns `dist/aeven/main.js` |
| `tests/` | Aeven | Sign-in step handling, the HTTP surface, the served tool list, and the Aeven-owned tool helpers, without Telegram credentials |
| `dist/` | build output, git-ignored | Emitted JavaScript; Node cannot strip types under `node_modules` |

## Pin

Upstream commit [`3615273ed9cb2ada6ceed0e190bba01cc815af43`](https://github.com/bstuff/telegram-mcp/commit/3615273ed9cb2ada6ceed0e190bba01cc815af43)
(2026-09-27), MIT, kept in `source/LICENSE`. A sync replaces `source/`, keeps `aeven/`, rebuilds, and
re-runs the tests in `tests/`.

## Local modifications

`source/` carries no edits: every Aeven addition is a separate file under `aeven/`, so an upstream
sync replaces the tree without replaying patches. Nothing upstream is overridden.

## Daemon contract

`node dist/aeven/main.js` binds `127.0.0.1:0`, writes one JSON line to stdout (its only stdout
output) — `{"listening":"127.0.0.1:<port>"}` — and serves:

| Route | Method | Purpose |
|---|---|---|
| `/mcp` | POST, GET, DELETE | MCP over Streamable HTTP |
| `/status` | GET | `{ state, phone, reason, identity, qr }`, where `state` is `login`, `code`, `qr`, `password`, `authorized`, `unlinked`, or `failed`, and `qr` is the SVG data URL of the current login code in the `qr` state; `?verify=1` also confirms the session with Telegram |
| `/login/start` | POST | `{ phone }` sends the login code and returns once Telegram delivered it |
| `/login/qr` | POST | Requests a login token for the Telegram app to scan (Settings → Devices → Link Desktop Device) and returns once Telegram issued it; the token is replaced before it expires, and a scanned account with 2FA continues at `/login/password` |
| `/login/code` | POST | `{ code }` completes sign-in, or reports that a 2FA password is needed |
| `/login/password` | POST | `{ password }` completes 2FA sign-in |
| `/logout` | POST | Terminates the Telegram session and clears the stored session string |

Every route requires `Authorization: Bearer <TELEGRAM_MCP_TOKEN>`; the connector generates the token
per process and passes it in the environment. Credentials and the session string never travel in
request bodies or responses. The environment supplies `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`,
`TELEGRAM_MCP_HOME` (the Aeven-owned per-account directory holding `session`, `identity.json`, and
`downloads/`), and `TELEGRAM_MCP_TZ`. Closing stdin shuts the daemon down, so a crashed Host leaves
no process holding a session.

A rejected code or 2FA password leaves the attempt on the same step and reports `reason`, so the user
can type another value; the connector's own expiry abandons an attempt that is never finished.

Telegram content returned by the read tools is other people's content: the connector treats it as
untrusted data, and the writing tools sit behind the user's approval.

## Aeven-owned tools

Upstream's 33 tools stand unchanged. The daemon registers 18 more on the same server, so the served
list is 51. `aeven/tools.ts` names the Aeven-owned tools and marks the three that only read, and
`tests/daemon.spec.ts` fails if the served annotations drift from that list. The connector mirrors
the read list in `packages/host/account-integrations` for its approval gate, so every tool that
changes something asks first.

| Group | Tools |
|---|---|
| Blocking | `block_contact`, `unblock_contact`, `list_blocked` |
| Reports | `report_spam` |
| Member administration | `kick_member`, `unban_member`, `list_banned`, `promote_member`, `demote_admin` |
| Groups and channels | `create_group`, `join_chat`, `leave_chat`, `set_group_info`, `set_group_permissions` |
| Invite links | `create_invite_link`, `list_invite_links`, `revoke_invite_link` |
| Raw access | `telegram_api_call` |

Banning and promoting exist only in supergroups; a basic group has no bans, so `kick_member` removes
a member there outright. Blocking a person is an account-level action and never removes them from a
group. A member is named by id, @username, link, or name, and an id that the dialog cache cannot
resolve is looked up in the chat the tool was given, because a member list carries the access hash
the bare id lacks.

`telegram_api_call` reaches any request class in teleproto's generated schema by name, so a
capability the named tools do not cover needs no daemon change. The `auth.*`, `account.*`, and
`payments.*` namespaces are refused: signing in, account security, and spending real money stay
outside the tool surface.
