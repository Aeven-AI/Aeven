# Agent Note: Direct routes, clean-shutdown presence, and socket probes

Status: implemented

English | [中文](2026-11-10-direct-routes-presence-and-socket-probes.zh.md)

## Problem

Three gaps in how Aeven's devices reach each other:

- **Direct links needed mDNS.** Two desktops of an account linked over the local network only when multicast discovery found them. Guest and office networks drop multicast, separate subnets never see each other, and a tailnet across sites carries no mDNS, so updates and forwarded inputs fell back to the relay.
- **A closed desktop stayed present.** A desktop stamps `seenAt` every minute and counts as present for 150 seconds. After the app quit, Aeven Cloud kept forwarding new conversations to it for up to two and a half minutes and answered each one only after the ten-second fallback.
- **A dead socket went unnoticed.** A browser hides WebSocket Ping frames, and the operating system can kill a suspended page's socket without a close event. A laptop waking from sleep or a phone returning to the page kept a socket that delivered nothing until the next TCP timeout.

## Decision

- **Advertised routes.** Each device without `keepConnected` writes its private and Tailscale (100.64.0.0/10) IPv4 addresses and its link port as `routes` on its entry in the encrypted devices document, with every presence stamp. The LAN transport dials the routes of devices that stamped within `routeWindowMs` (default 150 s) and did not mark themselves offline, rotating through a device's routes on each retry; mDNS results still come first. The existing handshake proves the account key, so an address that now belongs to another machine never links. Links are accepted only from loopback, private, link-local, and tailnet sources. An always-on device neither advertises nor dials routes. This adapts t3code's learned-route list.
- **Offline on clean shutdown.** On disposal, a device without `keepConnected` rewrites its entry with `offline: true`, keeping its last `seenAt`, and waits up to `leaveMs` (default 1.5 s) for the outbox to reach the relay. Session sync treats an `offline` device as away whatever its stamp says; the next stamp rewrites the entry without the mark.
- **Socket probes.** While connected, the page coming back into view, `pageshow`, `online`, and a Network Information `change` event make `ConnectionController.probe()` ask Gateway to open a stream to `$probe`, an endpoint no Host serves. Every Host version answers with an `error` frame, so the probe needs no protocol change. No frame within `probeTimeoutMs` (default 8 s) replaces the socket. This adapts t3code's connection supervisor probe.

## Alternatives considered

**`tailscale serve` to expose the desktop Host over HTTPS on the tailnet.** Deferred: it opens a browser-reachable Host to every tailnet device, which needs its own authentication decision. Advertising tailnet addresses gives device-to-device links without exposing the Host.

**An application-level heartbeat frame.** Rejected: an unknown frame type fails a client's whole socket, so a page loaded before a deploy would loop on reconnects unless both sides negotiated the frame. The unknown-endpoint probe has the same effect with no negotiation.

## Consequences

A device's private and tailnet addresses are visible to the account's other devices through the encrypted devices document. A route to a device that stamped recently but is unreachable from here costs one failed connection per `lanRetryMs`. A Host that is slow to answer for longer than the probe timeout gets a reconnect it did not need.

## Verification

Two desktops of one account on networks without multicast, or on one tailnet across sites, link directly within one presence stamp. Quitting a desktop makes the Aeven Web dialog show it offline at once, and a new web chat runs in Aeven Cloud without the ten-second wait. Suspending a laptop with chat.aeven.io open and waking it reconnects within the probe timeout.
