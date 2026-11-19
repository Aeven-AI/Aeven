# Agent Note: a browser approval names what goes out and shows its text, and page scripts never post

Status: implemented

English | [中文](2026-11-19-browser-approvals-show-what-goes-out.zh.md)

## Problem

Editing a LinkedIn reply through the user's browser raised two prompts, "Run a script that clicks or submits in the page on a website", for a script that opened the comment's "…" menu and one that clicked "Edit". Neither posted anything. The click on "Save changes" that did publish the edit ran without a prompt. Neither prompt said what would be posted. The causes:

- `isSendScript` asked whenever a script clicked and its source mentioned a publishing verb anywhere; LinkedIn's element id `replaceableComment_urn:li:comment:…` and the menu text "Copy link to comment" both contain "comment".
- "Save changes" opens with no publishing verb, so the click passed.
- The prompt carried only the generic reason, and the preview tools had no message argument for the card to show. The extension's status gave no page address, so the reason said "on a website" and no per-site grant was offered.

## Decision

- `isSendLabel` matches a label that opens with a publishing verb ("Send", "Post comment", "Reply"), not one that merely mentions one. Verbs are grouped (`PublishVerb`), with a `commit` group (Save, Update) that publishes only when it saves composed text.
- `@aeven/browser-chromium/src/outbound-probe.ts` runs in the page before a `preview_click` on a CSS selector and a `preview_press` Enter. It reports the clicked control's verb, the text in the nearest composer (searched up to the article, dialog, or form holding the control), email recipients and subject, and the document address. Reply, Comment, and Save ask only when that composer holds text; Send, Post, Repost, Invite, and Submit always ask.
- `ApprovalRequestEvent` and `approval/asked` carry `outbound` (kind, site, to, subject, text). The existing approval card leads with the kind ("Post this reply on linkedin.com") in zh, en, and es, and shows the content in its labeled To / Subject / Message lines.
- Page scripts no longer ask by their source text. On a website each `preview_evaluate` runs behind a guard that refuses a programmatic click, synthetic click or Enter, or form submission that the probe classifies as publishing, marks the control with `data-aeven-send`, and fails with an instruction to click it with `preview_click`, which asks with the content. A script that sends a writing request still asks. A trusted pointer or key event disarms the guard, so the person's own clicks and the tools' debugger clicks never meet it.

## Alternatives considered

- **Add Save to the publishing verbs.** Rejected: every settings page would ask. Save asks only when it saves composed text.
- **Let the model declare what it posts.** Rejected: the prompt must show what the page will send, not what the model says it sends.
- **Run page scripts in two passes to find their clicks first.** Rejected: a dry run repeats every other side effect of the script.

## Consequences

The probe resolves plain CSS selectors only; a click on an accessibility token or a `text=`/`role=` locator is judged by its label alone, without content. The guard confines the agent's scripts, not the page: a page that kept references to the native methods, or a script that calls a framework's handler directly, is not stopped by it. The Chrome DevTools tools keep the label and script-text rules, with the stricter leading-verb label match.
