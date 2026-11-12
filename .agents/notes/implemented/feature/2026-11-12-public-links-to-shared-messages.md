# Agent Note: Public Links to Shared Messages

Status: implemented

English | [中文](2026-11-12-public-links-to-shared-messages.zh.md)

## Problem

A user could copy a response but had no way to show it to someone outside Aeven with its formatting and images intact. Sessions live on the user's own device, so a link anyone can open has to be served by the Aeven API, and the user must be able to see and revoke every link they created. Chat apps and social sites also need a preview card in the page head, read without running script.

## Decision

The assistant-message action strip gets a lucide `share-2` action at order 30, after feedback and read aloud and directly before branch. It opens a `Modal` that says the link makes the response public, shows a half-size inert copy of the turn's rendered closing response row, and offers Manage and a black Create link button that keeps its width while a spinner replaces its link glyph, then copies the link and reads Copied. Manage lists the account's links newest first, loads the next page when a sentinel enters the list's scroll area, deletes links one at a time, and deletes all of them after a confirmation.

The Host's `messageShare` Remote, in `@aeven/host-message-share`, builds the snapshot from the persisted log: the closing assistant message alone, titled by its first line. The prompt is never sent, so neither the question nor injected context reaches a public page. Images travel base64-encoded beside the Markdown as `share-image:n`; a Markdown image is published only when its real path is inside the Session's working directory or a registered workspace. Every call carries the user's own `AEVEN_TOKEN`, like the connector broker.

The Aeven API stores one `shared_links` row per account, Session, and message, so sharing a message again refreshes its snapshot under the same `shareId` and bumps a version that names its stored files. The web server renders `/s/<shareId>` as the response alone under the sign-in screens' header band: Markdown converted with `marked` and sanitised with DOMPurify, `noindex`, and Open Graph and Twitter tags pointing at a 1200×630 card. The API draws the card with `canvas` in the brand face when the link is created; the face is shipped as TrueType because `canvas` cannot read WOFF2. The page's only script is one fixed inline line allowed by its CSP hash: it reads the aeven.io web app's `userId` from local storage and relabels Try Æven as Go to Æven, since the auth cookies are scoped to `/api` and never reach `/s/`.

## Verification

The API's unit suites cover per-account ownership of create, list, delete, and delete-all, snapshot refresh under the same link, image re-encoding and file pruning by version, refused snapshots, the page's preview tags and sanitising, and the card's size and wrapping. The harness change passes the Host and Client type checks and builds.

## Alternatives considered

**Generate the card with satori and resvg.** Both run without a browser, but the API already ships `canvas`, which draws the card with less code and no new native dependency.

**Render the card in the browser and upload it.** The API could not trust the image, and each client would draw it differently.

**Send the response text from the browser.** The Host already holds the log; building the snapshot there keeps a page from publishing text the Session never contained.

## Consequences

Links are stored per account on the Aeven API, so they appear on every device of the account. A deleted link's page answers that it no longer exists, but preview cards that sites already fetched stay in their caches. Only the closing step of a turn is published, matching the copy action.
