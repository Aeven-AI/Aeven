# Slack tool surface

The surface belongs to Slack's own MCP server, which Aeven mounts once per connected workspace. The names are Slack's — they carry a `slack_` prefix inside the connector's `mcp__slack_<id>__` namespace — so the catalog in front of the model is what names them, and this page describes what those names cover rather than fixing them.

## Reading

| Capability | What it covers |
|---|---|
| Search messages and files | Everything the reader may see in the workspace: filter by date, person, or content type, and get each match with its channel and permalink |
| Search channels | Public and private channels by name or description, with their metadata |
| Search users | People by partial name, email, or id, with profile and status |
| List channels | The channels the reader is a member of, by type (public, private, direct, group direct), name prefix, and workspace |
| Read a channel | The message history of one channel |
| Read a thread | One thread's complete conversation |
| Read a canvas | A canvas exported as markdown |
| Read a user profile | One person's full profile, including custom fields and status |
| List channel members | The member ids of one channel or conversation |
| Search emoji | The workspace's custom emoji |
| Get reactions | The reactions on one message |

These run without asking. They return other people's words, rendered by Slack, and are data rather than instructions.

## Creating and changing

| Capability | Effect |
|---|---|
| Send a message | Posts as the reader to any conversation type |
| Schedule a message | Posts later, at a stated time |
| Draft a message | Composes without posting |
| Create a conversation | Opens a channel, a group direct message, or a direct message |
| Add a reaction | Reacts to a message as the reader |
| Upload a file | Two calls: the first returns an upload target, the second completes the file and optionally shares it to a channel with a message |
| Create or update a canvas | Writes a canvas and can share it |
| Create, read, or update a list | Works with Slack lists and their records, addressing columns by display name or key |

Every call in this table asks the user for approval first, and the result appears as the reader's own account. An upload is approved once for its two calls; the first call is a read by its name but is classified as a change because it creates the upload target.

## The classification rule

A name whose opening verb searches, reads, lists, gets, fetches, downloads, looks up, finds, or resolves is treated as a read, unless another word in the name is itself a write (send, post, reply, schedule, draft, upload, create, update, edit, delete, remove, archive, add, invite, join, leave, set, rename, share, complete, start, end, open, close). Any other name asks the user, naming itself.

The default for a name Slack adds later is therefore to ask. That costs one prompt; the opposite default would post to a workspace unreviewed.

## Limits and refusals worth knowing

- Search is rate limited per user, roughly ten calls a minute, with Slack's guidance to stay well under that for a single question. Pagination counts. Fanning out searches throttles the reader, and sustained volume throttles the workspace.
- Search returns what the reader is permitted to see; a private conversation is invisible unless the deployment asked for direct-message scopes, and a search that covered a window smaller than the question says so.
- A refusal that names an administrator means the workspace has not approved the Aeven application; the user has to ask their administrator, then connect the workspace again.
- A revoked sign-in surfaces as a workspace that needs connecting again in Settings → Connectors → Slack.
