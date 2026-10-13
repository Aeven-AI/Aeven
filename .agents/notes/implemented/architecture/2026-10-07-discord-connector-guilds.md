# Agent Note: Discord connects one guild per connector row behind one Aeven application

Status: implemented

English | [中文](2026-10-07-discord-connector-guilds.zh.md)

## Problem

WhatsApp and Telegram gave the account connector its shape for providers whose account is a device or a session: one connector row per account, one supervised process per row, one `mcp__account_<id>__` tool namespace per row, and Settings driving the sign-in. Discord breaks three assumptions in that shape.

- The unit a user connects is not an account. It is a **guild** the user adds a bot to, and one person may add it to many. A row per provider account would make several guilds share one row, one namespace, and one enable switch, and would let a tool call reach the wrong server.
- The credential is not the user's. Discord bots authenticate with an application's own bot token, and the upstream building block, [`cappyeo/discord-mcp`](https://github.com/cappyeo/discord-mcp), expects the caller to own a bot and hand it over as `DISCORD_TOKEN`. Aeven's request is the opposite: one Aeven-owned application, installed by any user into any guild, with no user-created bot and no user token.
- The tool surface is not shippable as it stands. Upstream serves 221 tools — roles, automod, monetization, voice, templates, guild blueprints, components, intelligence, and webhook administration among them. Mounting all of them would put an unexplained and largely irrelevant catalog in every conversation.

## Decision

`discord` is a first-class `ConnectorProvider` whose **unit of connection is one guild**: one connector row, one connector id, one `mcp__account_<id>__` namespace, and one independent enable and remove switch per guild, while a single Aeven Discord application and bot back every row.

The Aeven API's connector broker owns the Discord application and every Discord call that needs its credentials ([connector secrets on the Aeven API](2026-10-07-connector-secrets-on-aeven-api.md)): the install exchange (`POST /oauth2/token` with the authorization code, the PKCE verifier, the client id, and the client secret), the installer read, the membership check (`GET /guilds/{id}`), the bot identity (`GET /users/@me`), and leaving a guild. The install link is Discord's bot authorization screen: `authorize('discord')` asks the API to start the consent with `scope=bot applications.commands identify`, the permission bitfield of the served surface, and account-bound PKCE state. The API spends the code at its callback, confirms the bot is a member, and records the guild, installer, and bot; the Host's next Settings read writes one row from that result. Installing into a guild the account already connected refreshes that row, and the connector id is derived from the account and the guild id, so tool names survive an uninstall and reinstall. `maxDiscordGuilds` bounds the rows one account may hold; an install beyond it is removed again at the API.

The row stores `applicationId`, `botUserId`, `guildId`, `guildName`, an optional icon URL, the installer's id and name when Discord reported them, and `linked`, which turns false when the bot is no longer a member. The client secret and bot token stay on the API, so no row, Host process, tool schema, model request, or browser response carries a secret, and a guild row owns no credential record of its own.

Each guild runs its own connector server as a **stdio child process** through the existing MCP client, with the guild id, `DISCORD_API_BASE` pointing at the API's Discord proxy for that guild, and `DISCORD_AUTHORIZATION` carrying the owner's Aeven session in its environment, and `cwd` left to the client's default. The proxy acts as the bot only for paths inside a guild the owner installed it into. One process serves one guild, so no tool takes a guild argument and two guilds cannot be mixed; the process starts with the guild's mount and dies with it, and restarts with the new session when the owner's session rotates, so the connector needs no daemon supervisor, no loopback port, and no restart policy of its own. The Host re-reads the guild membership through the proxy at most once per `discordVerifyIntervalMs` per row, which is what turns a removed bot into a disconnected row without asking Discord on every conversation step.

The server is [`native/discord-mcp`](../../../../native/discord-mcp/README.md): the curated surface the request names — `list_channels`, `get_channel`, `get_messages`, `get_thread`, `search_messages`, `list_members`, `get_guild_info`, `send_message`, `reply_message`, `add_reaction`, `remove_reaction`, `send_file`, `create_thread` — plus an administration and moderation surface of 30 tools across members (kick, ban, bulk ban, unban, member read and edit, timeout), messages (delete and purge), roles, channels and their permissions, invites, the audit log, AutoMod, and server settings, registered only when `discordAdminTools` is on. The install link requests the permissions of whichever surface the deployment serves, and `discordPermissions` replaces that bitfield outright. `search_messages` walks messages under a scan budget rather than calling Discord's search route, which Discord reserves for user accounts.

The approval gate follows the three surfaces: the seven read tools run directly, the six tools that post, reply, react, upload, or open a thread ask as visible actions, and every administration or moderation tool asks on its own with a message that names it as a server-wide change.

Uninstalling leaves the guild through `DELETE /users/@me/guilds/{id}` where Discord allows it, then deletes the row. A leave the deployment cannot perform — an unreachable Discord, a bot Discord refuses to remove — still deletes the local row, because the user asked for the connection to be gone.

## Alternatives considered

**Vendor upstream whole and disable categories by configuration.** Upstream is a TypeScript monorepo whose tools run through its own `defineTool` pipeline, access-requirements registry, and audit middleware. Serving it whole means shipping that machinery and then describing which 221 tools are off, and its tool names (`channels_list`, `messages_read`) are not the names this connector's gate and skill are written against. Rejected: the vendored subset is the REST and message-projection helpers, and the curated surface is written for Aeven.

**One connector row for Discord, with a guild argument on every tool.** Fewer rows and no per-guild child process. Rejected: a single namespace means one enable switch for every server, a model that must pass a guild id it has no way to verify, and no structural answer to "never mix guilds accidentally".

**A daemon per row with a loopback HTTP endpoint, as WhatsApp and Telegram do.** Rejected here because those daemons exist to hold a *session* — a WhatsApp device link, a Telegram login — that must stay alive between conversations and across browser requests. Discord has no per-connector session to hold: the bot token belongs to the deployment, and the MCP client's stdio transport already owns the child lifecycle that the mount needs.

**Per-user Discord applications.** Rejected outright: it would require every user to create a bot in the Developer Portal, which is exactly what this connector exists to avoid.

**Always-on administration tools.** Rejected: a moderation surface that exists by default changes the approval conversation, the requested permissions, and the risk of an unintended ban for every deployment, including the ones that only want to read and post.

## Consequences

Adding a server needs the Aeven Discord application on the Aeven API with a client id, a client secret, and a bot token, plus the Message Content and Server Members intents enabled for it, and the API's callback URL registered on the application. That registration is a Developer Portal action by a person; the code path is complete without it, and the API reports the provider as not configured while the credentials are missing. No test installs against Discord; the API's install exchange, membership check, proxy guard, and uninstall are pinned against a stubbed `fetch` in `servers/node`.

Discord's gateway is out of scope: incoming messages and mentions are read when a conversation asks for them, and a listener for real-time events is deferred. Discord's server-level search route is likewise unreachable for a bot, so `search_messages` reports the window it scanned instead of claiming complete coverage.

The approval gate's tool lists in `packages/host/account-integrations/src/index.ts` mirror the names `native/discord-mcp` registers, as the Telegram connector's do. Unlike the Telegram daemon, which fails its own suite when its annotations and the Host's list drift apart, nothing checks the Discord pair automatically: the native package pins its served names, and the Host list is maintained by hand.

Administration tools additionally need the matching permissions granted at install time. A guild installed while `discordAdminTools` was off does not gain them by turning the flag on; the server has to be added again.
