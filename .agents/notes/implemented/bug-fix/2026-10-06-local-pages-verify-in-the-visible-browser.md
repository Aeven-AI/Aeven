# Agent Note: Local pages verify in the visible browser

Status: implemented

English | [中文](2026-10-06-local-pages-verify-in-the-visible-browser.zh.md)

## Problem

[The browser surface status report](2026-10-01-browser-surface-status-report.md) ordered the browser surfaces by cost to the user: headless Playwright first, the attached Chrome only after a refusal or for a signed-in page. That order is about reading pages the session does not control. It had no case for a page the workspace itself serves. On 2026-10-06 a session restyling the Aeven settings page verified every change in headless Playwright at `127.0.0.1:3080`. Its measurements described a browser the user could not see, and one of them disagreed with what the user saw in the visible window.

## Current scope

The [selected-sidebar actions decision](../feature/2026-10-09-fast-sidebar-browser-actions.md) supersedes the remote-page headless-first order. Local pages still verify in the visible browser first.

## Decision

The page's address decides, not the kind of task. A page served from this machine (`localhost` or `127.0.0.1`) is an application under development and is verified first in the browser the user can see: the pane beside the session, or the Host's Chromium that the `mcp__chrome_devtools__*` tools drive. The headless browser stays its fallback when neither is available, and the model then says the check ran in a headless copy. Remote pages keep the headless-first escalation. The first-step browser context, the `preview_status` next step, `web_fetch`'s prompt section, and the `in-app-browser` skill all state the rule.

## Alternatives considered

**Classify by task ("development work uses DevTools").** The model must infer the task kind, and it inferred it wrongly here. The address is a fact the model reads off the URL it is about to open.

**A rule in the repository `AGENTS.md`.** It covers only this repository, while the harness guidance covers every workspace's dev server, and two copies of one rule drift.

**Block local origins in Playwright (`--blocked-origins`).** It enforces the order, but it also removes the headless browser as the fallback for a local page when the visible browser is down or cannot start, and the headless browser is a resource the session keeps for exactly that case. A hook denying those navigations has the same cost.
