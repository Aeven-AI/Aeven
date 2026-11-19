# Agent Note: chat turns failed on hotel and in-flight Wi-Fi

Status: implemented

English | [中文](2026-11-19-chat-on-hotel-and-in-flight-networks.zh.md)

## Problem

Users on hotel Wi-Fi and on Starlink-equipped flights reported turns that stayed on "Ævening" and ended in "Aeven couldn't be reached". A desktop behind a firewall that admitted only TCP 80 and 443, in both directions, chatted normally, so port blocking was not the cause. Under 300 ms of latency with jitter and 2% loss, every attempt of a turn failed with `TRANSPORT` after about 45 seconds and the third of five attempts succeeded after 2 min 29 s.

Three measured facts explain it. Cloudflare buffers a request body before contacting the origin and resets the connection when the upload is silent for 15 seconds; a 14-second pause passed and a 16-second pause was reset at 15.1 s. Every turn uploads the whole conversation: 132 KB for a new chat and 1.82 MB for a 704-message chat, of which 849 KB were 25 inline tool screenshots. Every image turn first uploaded an image to `POST /api/v1/files`, which the gateway answers with 415, before sending the images inline. A retry repeats the full upload into the same link. Separately, a device returning after days offline downloaded 119 MB of account-sync backlog on the same link, and the session log recorded only `Aeven API request to … failed`, so a client's log could not say which step broke.

The client behind the report sent no request that reached pink after 05:00 UTC on 2026-11-18, including the hourly `refresh-token` call, so that flight's failure happened before the origin and was not reproduced here.

## Decision

- `llm-aeven` gzips the chat request body at the fastest level (`requestCompression`, default `gzip`); the gateway's `express.json` parser inflates it. A new chat's request drops from 132 KB to about 40 KB, and a 554 KB request compresses in 7 ms. The hosted Host sets `requestCompression: none`: its datacenter link beside Cloudflare gains nothing from it.
- `llm-aeven` sends images inline from the first attempt (`imageTransport: 'inline'`), so an image turn no longer spends an upload on a Files API the gateway lacks. `llm-deepseek` keeps `files-api` and an uncompressed body for the official API.
- A `TRANSPORT` failure's message appends the deepest coded error of the fetch cause chain (`transportFailureMessage`), for example `(ECONNRESET: read ECONNRESET)`.
- The sync relay connection pings every `heartbeatMs` (60 s) so middleboxes keep its mapping, and reconnects only when nothing at all arrived for `silenceTimeoutMs` (300 s). The relay pings an idle connection at least every 120 s, so a ping queued behind a slow upload cannot end a healthy connection.

## Alternatives considered

- **Send inference to a hostname Cloudflare does not proxy.** Rejected for now: it removes the 15-second limit but also Cloudflare's edge, and smaller uploads already shorten the exposure.
- **Upload each image to the gateway once and reference it.** Deferred: it keeps every image visible to the model but needs gateway storage in `servers/node`.
- **Retain fewer images per request (10 images, 1.5 MiB).** Rejected: it cut a long chat's upload to 246 KB, but the model sees fewer screenshots, a 1.5 MiB budget with 768 KiB steps can offload even the newest image, and moving the offloaded prefix every 5 images invalidates the prompt cache twice as often.
- **Raise Node's 250 ms per-address connection attempt to 1 s.** Rejected: Node already gives the last address unlimited time, which on macOS is an IPv4 address, while a silently broken IPv6 path would add 750 ms to every new connection.
- **Hold catch-up pages back while an agent runs.** Rejected: on a fast link it only delays sync, a computer-use turn runs for minutes, and the hosted Host always has some account's turn running.

## Consequences

A gateway deployment whose proxy rejects `Content-Encoding: gzip` must set `requestCompression: none`. If the client's next failure log names a connect timeout or TLS error rather than a reset, the cause is between the device and Cloudflare, and Cloudflare's security events for the flight's addresses are the next evidence to read.
