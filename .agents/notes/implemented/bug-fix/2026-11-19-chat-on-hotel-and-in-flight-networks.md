# Agent Note: chat turns failed on hotel and in-flight Wi-Fi

Status: implemented

English | [中文](2026-11-19-chat-on-hotel-and-in-flight-networks.zh.md)

## Problem

Users on hotel Wi-Fi and on Starlink-equipped flights reported turns that stayed on "Ævening" and ended in "Aeven couldn't be reached". A desktop behind a firewall that admitted only TCP 80 and 443, in both directions, chatted normally, so port blocking was not the cause. Under 300 ms of latency with jitter and 2% loss, every attempt of a turn failed with `TRANSPORT` after about 45 seconds and the third of five attempts succeeded after 2 min 29 s.

Three measured facts explain it. Cloudflare buffers a request body before contacting the origin and resets the connection when the upload is silent for 15 seconds; a 14-second pause passed and a 16-second pause was reset at 15.1 s. Every turn uploads the whole conversation: 132 KB for a new chat and 1.82 MB for a 704-message chat, of which 849 KB were 25 inline tool screenshots. Every image turn first uploaded an image to `POST /api/v1/files`, which the gateway answers with 415, before sending the images inline. A retry repeats the full upload into the same link. Separately, a device returning after days offline downloaded 119 MB of account-sync backlog on the same link, and the session log recorded only `Aeven API request to … failed`, so a client's log could not say which step broke.

The client behind the report sent no request that reached pink after 05:00 UTC on 2026-11-18, including the hourly `refresh-token` call, so that flight's failure happened before the origin and was not reproduced here.

## Decision

- `llm-aeven` gzips the chat request body (`requestCompression`, default `gzip`); the gateway's `express.json` parser inflates it. A new chat's request drops from 132 KB to about 39 KB.
- `llm-aeven` sends images inline from the first attempt (`imageTransport: 'inline'`), so an image turn no longer spends an upload on a Files API the gateway lacks. `llm-deepseek` keeps `files-api` and an uncompressed body for the official API.
- `llm-aeven` retains at most 10 images and 1.5 MiB of inline image data per request, offloading the oldest in steps of 5 images or 768 KiB. An offloaded image keeps its placeholder path.
- A `TRANSPORT` failure's message appends the deepest coded error of the fetch cause chain (`transportFailureMessage`), for example `(ECONNRESET: read ECONNRESET)`.
- The sync relay connection pings every `heartbeatMs` (30 s) and reconnects after one silent interval. While any agent runs on the Host, each catch-up page waits up to `catchUpYieldMs` (15 s).
- The desktop shell starts the Host with `--network-family-autoselection-attempt-timeout=1000`, so a handshake slower than Node's 250 ms default is not abandoned for the next resolved address.

## Alternatives considered

- **Send inference to a hostname Cloudflare does not proxy.** Rejected for now: it removes the 15-second limit but also Cloudflare's edge, and smaller uploads already shorten the exposure.
- **Upload each image to the gateway once and reference it.** Deferred: it keeps every image visible to the model but needs gateway storage in `servers/node`.
- **Pause catch-up for the whole duration of a turn.** Rejected: a computer-use turn runs for minutes, and live frames arrive only after catch-up subscribes.

## Consequences

A long chat with many screenshots shows the model fewer of them; the model reads older ones through their placeholder paths. A gateway deployment whose proxy rejects `Content-Encoding: gzip` must set `requestCompression: none`. If the client's next failure log names a connect timeout or TLS error rather than a reset, the cause is between the device and Cloudflare, and Cloudflare's security events for the flight's addresses are the next evidence to read.
