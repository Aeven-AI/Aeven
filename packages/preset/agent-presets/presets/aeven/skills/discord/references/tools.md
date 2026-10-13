# Discord tool surface

Every connected server serves the curated tools below through Aeven's own Discord bot. The server is fixed by the connection: no tool takes a guild id, which is what keeps two servers apart. A deployment that enables the Discord administration tools adds the second table; otherwise those names do not exist.

## Curated tools

| Tool | Arguments | Discord call |
|---|---|---|
| `list_channels` | `type?` (`text`, `voice`, `category`, `forum`, `announcement`, `stage`) | Channels of the connected server, without threads |
| `get_channel` | `channel_id` | One channel, or one thread: name, topic, slowmode, parent |
| `get_messages` | `channel_id`, `limit?` (1–100, default 50), `before?`, `after?` | Recent messages, newest first; `before` and `after` are mutually exclusive |
| `get_thread` | `thread_id`, `limit?`, `before?` | A thread's own fields plus its messages; `archived?` reads a channel's archived public threads |
| `search_messages` | `channel_id?`, `query`, `limit?`, `pages?`, `before?` | Case-insensitive substring match over recent messages of one channel, or of the server's text channels under a scan budget; the result reports what was covered |
| `list_members` | `limit?` (1–1000, default 100), `after?`, `query?` | Server members; needs the Server Members intent |
| `get_guild_info` | none | Server name, id, owner, counts, description, boost tier, locale, features, roles |

## Tools that ask first

| Tool | Arguments | Effect |
|---|---|---|
| `send_message` | `channel_id`, `content` (1–2000 characters) | Posts a message as the Aeven bot |
| `reply_message` | `channel_id`, `message_id`, `content` | Posts a reply referencing that message |
| `add_reaction` | `channel_id`, `message_id`, `emoji` | Adds the bot's own reaction; `emoji` is a glyph or `name:id` |
| `remove_reaction` | `channel_id`, `message_id`, `emoji` | Removes the bot's own reaction |
| `send_file` | `channel_id`, `file_path`, `caption?`, `reply_to_message_id?` | Uploads a file from this computer |
| `create_thread` | `channel_id`, `message_id?`, `name`, `auto_archive_duration?`, `rate_limit_per_user?` | Opens a thread, anchored on a message when one is named |

## Administration tools, when the deployment enables them

Members: `kick_member`, `ban_member`, `bulk_ban_members`, `unban_member`, `list_bans`, `get_ban`, `get_member`, `edit_member`, `timeout_member`, `clear_timeout`.

Messages: `delete_messages`, `purge_messages`.

Roles: `list_roles`, `create_role`, `edit_role`, `delete_role`, `assign_role`, `remove_role`.

Channels: `create_channel`, `edit_channel`, `delete_channel`, `set_channel_permissions`.

Invites and audit: `list_invites`, `revoke_invite`, `read_audit_log`.

AutoMod and server: `list_automod_rules`, `create_automod_rule`, `edit_automod_rule`, `delete_automod_rule`, `edit_guild`.

Each of these asks for approval on its own and is worth stating plainly before it runs: a ban, a timeout, a deleted channel, or a changed permission is visible to the whole server and is hard to undo.

## Limits worth remembering

- Search: Discord reserves server-wide text search for user accounts. A bot walks messages instead, so results cover the recent window the tool reports, not the whole history.
- Message text: the Aeven application needs the Message Content intent for reliable message bodies; an empty body with attachments or embeds still renders their text.
- Access: the connect screen requests the permissions of the curated surface. A server where a channel or role denies them answers with a permission error, which is the server's own setting, not a fault of the connection.
