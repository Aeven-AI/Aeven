# Agent Note: WhatsApp message cards

Status: implemented

English | [中文](2026-11-07-whatsapp-message-cards.zh.md)

## Problem

Asking Aeven to check WhatsApp showed a generic tool row holding the daemon's text listing, and the reply could only describe media in words: a voice note, photo, GIF, or video never reached the reader. Received media also stayed in the daemon's folder, out of the conversation.

## Decision

A `list_messages` or `get_message_context` call draws as one card per chat, outside the folded process group, with chat bubbles by day, photos and stickers, silently looping GIFs, videos that load when played, downloadable documents, and voice notes with a play button and a waveform that seeks.

- **Data.** The daemon returns `structuredContent.messages` (oldest first, deduplicated, sender names resolved) beside the unchanged text ([`message_cards.go`](../../../../native/whatsapp-mcp/source/internal/mcp/message_cards.go)). The MCP bridge records any `structuredContent` as the durable `tool/result` meta through `presentationMeta` ([`tools.ts`](../../../../packages/mcp/mcp-client/src/tools.ts)), so the card replays from the session log and the model still reads only the text.
- **Media.** The daemon's token-protected `GET /media` serves one message's decrypted bytes and re-encodes a voice note as AAC, because Safari before 18.4 plays no Ogg Opus ([`media_http.go`](../../../../native/whatsapp-mcp/source/internal/mcp/media_http.go)). `accountIntegrations.whatsAppMessageMedia` resolves the account from the call's tool name, answers only for the acting user's own number, and returns base64, since Typert Remote results carry JSON only.
- **View.** Connector tool names carry an account prefix, so `ToolCallTree` looks views up under `mcp__<provider>__<tool>` ([`tool-view-key.ts`](../../../../packages/client/ui-tool/src/client/tool/tool-view-key.ts)). The Connectors plugin registers the card and a `connector-cards` Turn index, which Chat merges into the generated-image call ids that stay visible ([`connector-cards.ts`](../../../../packages/client/ui-settings-integrations/src/client/connector-cards.ts)). The browser computes the waveform from the decoded recording.

## Alternatives considered

**A model-facing card tool** (the model calls `show_messages`) was rejected: it doubles the calls per answer and lets the model omit media the reader expects.

**A Host HTTP route streaming media** would allow range requests for long videos, but no Host plugin registers HTTP routes today; the Remote with a size limit (`whatsappMediaMaxBytes`) covers voice notes, photos, GIFs, and ordinary videos.

## Consequences

Every MCP tool that returns `structuredContent` now persists it in its `tool/result` meta, which grows the session log by that payload. A video over `whatsappMediaMaxBytes` shows as unavailable. Desktop composes the same plugins, so the card works wherever a WhatsApp number is linked.
