# Agent Note: mail reads HTML-only bodies as text and forwards a message with its HTML, inline images, and attachments

Status: implemented

English | [中文](2026-11-15-mail-html-bodies-and-forward.zh.md)

## Problem

`mail_read` returned no text for messages that carry only a `text/html` part, such as Microsoft support mail: the headers and a logo attachment came through, so the model saw an empty message that read normally in a mail client (#648). `toMailMessage` used `parsed.text` alone, and mailparser converts HTML to text only for a lone root HTML part, so a `multipart/related` HTML body with inline images, or an empty `text/plain` beside real HTML, reached it with no usable text. Mail could also not be forwarded: `mail_send` offered send, reply, and draft only, so passing a message on meant retyping it as plain text and losing its formatting, images, and attachments.

## Decision

- `toMailMessage` keeps the `text/plain` part when it has visible text and otherwise converts `parsed.html` with `html-to-text` (already in the tree through mailparser, now a direct dependency): no word wrap, images skipped, links kept with their URLs unless the URL equals the link text. `MailMessage.textSource` records `plain` or `html`, and `mail_read` adds `(The message has no plain-text part; this text was converted from its HTML.)` for `html`. Plain-text messages render as before.
- An attachment the HTML body embeds (mailparser's `related`) carries `inline: true` and reads `, inline in the body` in the attachment list. It keeps its index, so `saveAttachments` still saves it.
- `MailSendRequest.forward` names the message to forward. The service reads it from the account and sends the sender's text, then a `---------- Forwarded message ---------` block (From, Date, Subject, To, Cc), then the original's readable text; when the original had HTML, an HTML alternative carries the same block above the original's head `<style>` blocks and body content. Every original part is attached, and inline images keep their Content-ID so the forwarded HTML still shows them. The subject defaults to `Fwd: …`, a request cannot both reply and forward, and a forward can also be saved as a draft. Sending still asks for approval, with the reason `Send a forwarded email from ${account} to ${to}.`

## Alternatives considered

**Attach the original as `message/rfc822`.** It keeps the message byte for byte, but several clients show it as a file to open rather than inline, and the recipient sees an attachment instead of the message.

**Drop inline images from the attachment list.** They would no longer read as attachments, but the model could not save one any more, and indices would shift between `mail_read` and `saveAttachments`.

## Consequences

A read of an HTML-only message costs as many tokens as its visible text, still capped by `bodyMaxChars`. A forward sends the original's full size, bounded by `messageMaxBytes` when the original is read. The model still writes plain text only; composing HTML or attaching workspace files to outgoing mail remains deferred.

## Verification

A `multipart/related` HTML-only message shaped like #648's (an HTML body with a `cid:` logo) parsed through `toMailMessage` returns `Dear Olivier, …` with `textSource: 'html'` and the logo marked inline; a plain-text message returns its body unchanged with `textSource: 'plain'`. Forwarding it through `forwardParts` and `composeMessage`, then parsing the result, gives the subject `Fwd: …`, HTML that still contains `cid:logo`, the head style, and the link, and the logo as a related attachment with Content-ID `logo`.
