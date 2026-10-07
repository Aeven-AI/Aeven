---
name: whatsapp
description: Read, search, and send WhatsApp messages, media, reactions, and group changes through the user's linked WhatsApp numbers.
---

# WhatsApp

Use the current tool catalog to find the linked WhatsApp tools named `mcp__whatsapp_<id>__<tool>`; each linked number has its own `<id>` and its own set of tools. If no WhatsApp tools are available, ask the user to link a number in Settings → Connectors → WhatsApp.

When more than one number is linked, call each connection's `get_status` and use `own_phone` to tell them apart. Use the number the user names; ask which one to use when the request does not make it clear. Never mix tools from different numbers in one conversation thread.

Find chats and people before acting: `list_chats`, `search_contacts`, and `get_chat` resolve names to chat JIDs; `list_messages` and `get_message_context` read history. Keep message IDs and chat JIDs exactly as tool results report them. Use `request_sync` only when the user asks about history older than the local cache.

Sending, replying, reacting, editing, deleting, marking as read, typing indicators, polls, contact cards, blocking, privacy and status changes, and every group change are visible to other people and require the user's approval. Send only what the user asked for, to the recipient they named; draft longer messages for review first. Report only results the tools returned.

Files: `send_file`, `send_audio_message`, and `download_media`'s `output_path` accept only paths inside the connection's media directory, which `get_status` reports as `media_root`. Copy a file there before sending it. `download_media` returns the saved path; images and short audio also arrive inline.
