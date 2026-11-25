# Agent Note: Slack sign-in on the hosted Host

Status: implemented

English | [中文](2026-11-25-slack-sign-in-on-the-hosted-host.zh.md)

## Problem

Slack's login runs on the Host with a loopback redirect, `http://127.0.0.1:<slackCallbackPort>/callback`. On a desktop Host the browser runs on the same computer, so the redirect reaches the listener. On the hosted Host the browser runs on the user's computer and the Host on a server, so Slack sends the browser to a loopback address nothing listens on, and chat.aeven.io offered no Slack connector.

## Decision

- A Host the browser reaches over the network sets `slackRedirectUrl` to a public HTTPS route on its own web server; the hosted bundle uses `https://chat.aeven.io/connectors/slack/callback`, which the Slack application registers beside the loopback address.
- With that field set, `authorize('slack')` passes `startSlackLogin` a `SlackCallbackRelay` instead of binding the loopback port. The route looks up the login by the redirect's `state`, answers the browser with the same pages the loopback listener shows, and hands the code to that login; the exchange, the workspace check, and the per-workspace connector rows are unchanged.
- A redirect whose `state` no login awaits gets the "did not come from the window Aeven opened" page and settles nothing.

## Alternatives considered

- **Brokering Slack through the Aeven API** — would move every Slack token to the API, but Slack's connector id derives from the team id known only after consent and the Host already refreshes and probes its own Slack tokens; the public route reaches the same result without that rework.
- **Loopback on the hosted Host** — the browser can never reach the server's loopback interface.

## Consequences

- The Slack application must register `https://chat.aeven.io/connectors/slack/callback`, and the hosted Host needs the application's public client id in `SLACK_CLIENT_ID`.
- Desktop Hosts keep the loopback redirect.
