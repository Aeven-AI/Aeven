# Agent Note: Connection retries continue in the final backoff tier

Status: implemented

English | [中文](2026-11-10-connection-retries-past-the-final-tier.zh.md)

## Problem

The [connection recovery decision](2026-08-28-web-connection-recovery-control.md) ended automatic recovery after the failed retry in the 10s tier, about 15 to 25 seconds after the loss. Restarting Aeven Web's Host after a deploy takes longer than that, so every open page published `disconnected`, stopped retrying, and stayed dead until the reader reloaded it or pressed **Reconnect now**.

## Decision

`ConnectionController` keeps retrying in the final tier: each attempt waits 50–100% of the 10s cap and the state stays `disconnected` while it does, so the indicator still offers **Reconnect now**. The earlier tiers, manual reconnect, the offline suspension, and the visibility retry are unchanged. This note supersedes only the terminal state of the recovery decision.

## Alternatives considered

**Keep the terminal state and reload the page on focus.** Rejected because a page left open on a second screen or a wall display is not refocused, and it is exactly the page that must recover without a reader.

**Grow the cap further, to minutes.** Rejected for now: a Host restart is the common outage and lasts tens of seconds, and one request per tab every 5–10 seconds during an outage is negligible next to the two-second WebSocket heartbeat of a healthy page.

## Consequences

A page recovers on its own once the Host answers, within one final-tier delay. During a long outage each open tab makes one connection attempt every 5–10 seconds.

## Verification

Restart the `aeven-hosted` service with chat.aeven.io open for longer than the earlier tiers add up to: the page reconnects without a reload.
