# Agent Note: WhatsApp connectors run a vendored Go daemon per linked number

Status: implemented

English | [中文](2026-10-06-whatsapp-connector-daemon.zh.md)

## Problem

Every connector before this one is a mount over a credential the Host holds: an OAuth grant, a bearer token, or a user-supplied MCP endpoint, for GitHub, the Google services, Microsoft 365, and custom MCP. A WhatsApp account is none of those. The account is a device linked to a phone by scanning a QR code, its credential is the client's session rather than a record the Host owns, the tool surface is stateful — the daemon caches incoming messages between conversations and backfills history per chat on request — and unlinking has to end the session at WhatsApp rather than discard a token. The executor gate also recognizes connector tools only by the `mcp__account_<id>__` prefix, so a provider has to mount there to be governed at all.

## Decision

Vendor [Sealjay/mcp-whatsapp](https://github.com/Sealjay/mcp-whatsapp) at commit `ee039b67234a5216bda4e9a88c4e2fe1a2beae6f` under `native/whatsapp-mcp/source/` and compile it into one executable per platform with `native/whatsapp-mcp/scripts/build.ts`. Its `go.mod` takes `modernc.org/sqlite`, a pure-Go driver, so `CGO_ENABLED=0` cross-compiles all six targets from any build host. Each target's binary packs into `@aeven/whatsapp-mcp-<platform>-<arch>`, which `@aeven/host-account-integrations` carries as optional dependencies and resolves at startup, unless `whatsappBinaryPath` names a binary explicitly.

The Host supervises one daemon per linked number (`packages/host/account-integrations/src/whatsapp.ts`):

- `WhatsAppDaemon` spawns `whatsapp-mcp -store <directory>/store serve -addr 127.0.0.1:0 -exit-on-stdin-eof` beside a `media/` root passed as `WHATSAPP_MCP_MEDIA_ROOT`, both created mode 0700 under the account's connector directory. The child inherits PATH, the home, temporary, and Windows system variables, and LANG, plus a 32-byte bearer token generated per process; no provider key or Host credential reaches it.
- The daemon binds a loopback port the operating system chooses and announces it as its single JSON stdout line, `{"listening":"127.0.0.1:<port>"}`. Startup fails after `whatsappStartupTimeoutMs`, or earlier if the process exits. `/mcp`, `/status`, and `/logout` each require the bearer token, so a local process that finds the port still cannot read the account or end its session.
- The Host holds the child's stdin open and the daemon exits when it closes, so a crashed Host leaves no process holding the store's `flock`. `stop()` closes stdin and sends SIGKILL only after `whatsappStopGraceMs`.
- An unexpected exit restarts the daemon with exponential backoff from `whatsappRestartDelayMs` up to `whatsappMaxRestartDelayMs`, reset once a run outlives the maximum delay and scheduled only while the row stays enabled and linked. A startup failure schedules no further restart; the next conversation step or Settings action retries.

Linking is a Host-owned attempt rather than a redirect: `startWhatsAppPairing` creates the row and starts a daemon, Settings renders the QR PNG that `/status` returns, and the number becomes a linked connector when the phone scans it. `logout()` ends the session at WhatsApp and clears the local session, and removing the connector stops the daemon and deletes its directory. One owner links at most `maxWhatsAppAccounts` numbers, and each number keeps one row, one data directory, one daemon, and one `mcp__account_<id>__` namespace.

The daemon's tools mount through the existing MCP mount path before each conversation step, and the executor gate denies every tool of a connector that is disabled, foreign, or not connected. Every WhatsApp tool outside the fifteen that only read the account or download media into its own directory — `list_messages`, `list_chats`, `get_chat`, `get_message_context`, `search_contacts`, `is_on_whatsapp`, `get_status`, `pairing_status`, `download_media`, `get_poll_results`, `list_groups`, `get_group_info`, `get_blocklist`, `get_privacy_settings`, `request_sync` — asks for approval first, because everything else is visible to other people.

For the Desktop application, the package set packs the target's tarball (`packedWhatsApp`) and the seed installs it as `file:./desktop-packages/aeven-whatsapp-mcp-<platform>-<arch>-0.1.0.tgz`. The shipped app resolves the daemon from its own store: no build step runs during installation and first launch needs no network access.

## Alternatives considered

**Mount a daemon the user installs, through the custom MCP provider.** That provider already stores an endpoint and an optional bearer token and mounts its tools under the same `mcp__account_<id>__` prefix, so this would have needed no vendoring, no platform packages, and no desktop packaging. Rejected because the state that decides the connector belongs to the account rather than to the endpoint: a linking attempt has to survive across separate browser requests, `/status` has to answer between conversations whether the number is still linked, and unlinking has to end the session at WhatsApp. A user-supplied endpoint gives the Host none of those three.

**Speak the multi-device protocol inside the Host.** A Node client in the Host process would remove the vendored tree, the six platform packages, and the seed's tarball. Rejected because it moves the protocol, its SQLite store, and its file locking into the process that runs conversations: `whatsmeow` is the maintained implementation, and a separate process keeps a protocol crash, a held store lock, or a corrupted session from taking conversations down with it.

**Compile the daemon during installation instead of shipping a binary.** Rejected because it would put a Go toolchain on every build host and add a lifecycle script to the desktop project's reviewed `allowBuilds` policy, where an unlisted script is a hard install error. Building at pack time keeps the shipped store free of build steps and their network dependencies.

## Consequences

Linking one number costs 8,957,022 bytes of tarball and 25,667,074 bytes of extracted daemon in the macOS arm64 seed, against 877 MB of application and a 342 MB dmg. Only the built target's package ships; the other five platform packages exist for the other desktop targets and for GitHub's connector.

No credential record holds the WhatsApp session, so no Remote response, tool result, or Settings view can leak it: the daemon's own store is the only copy of it, which also makes deleting that directory the only recovery from a bad session, and re-linking means scanning a new QR code. Each linked number runs a process for as long as its row stays enabled and linked, because messages arrive between conversations; `maxWhatsAppAccounts` bounds how many numbers one owner can carry this way.

Pairing a real number stays a manual step: no automated test scans a QR code with a phone, and nothing in the suite drives an account through linking, a first message, and unlinking. The vendored source keeps upstream's Go test files under `native/whatsapp-mcp/source/`, which exercise the daemon itself rather than the Host's supervision of it.

## Related

[Personal skills and connectors](2026-10-04-personal-skills-and-connectors.md) owns the connector ownership model this provider extends: rows owned by the authenticated account, tools registered in the owning agent's scope, and an executor that rejects disabled, deleted, and foreign-account connections.

[Telegram connectors run a vendored Node daemon per account](2026-10-07-telegram-connector-daemon.md) reuses this shape, and records the three ways its upstream building block differs.
