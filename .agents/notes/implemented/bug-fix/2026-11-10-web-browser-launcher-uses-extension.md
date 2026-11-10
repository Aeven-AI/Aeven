# Agent Note: The Browser launcher on Aeven Web opens the reader's browser through the extension

Status: implemented

English | [中文](2026-11-10-web-browser-launcher-uses-extension.zh.md)

## Problem

On 2026-11-10, tapping Browser in the right sidebar of chat.aeven.io in Chrome on Android did nothing. `packages/client/ui-sidebar-browser/src/client/index.ts` registered the web page's Browser launcher only once the Host provided `remote.browserChromium`, and it only opened the Host's Chromium. The hosted bundle disables the Host browser, so on Aeven Web the launcher was never registered on any device, and the extension's install and unsupported-browser modals were reachable only from an agent's tool call.

## Decision

The web launcher is registered whenever the sidebar exists. A Host with its own Chromium still opens it; without one, the launcher opens a new tab of the reader's own browser through the Aeven extension, using the same wait that tool calls use. A browser that cannot run the extension, such as Chrome on Android, gets the unsupported-browser modal, a missing extension gets the install modal, and an installed extension opens the tab.

## Alternatives considered

Hiding Browser on Aeven Web where no Host Chromium exists would remove the one place a reader can see why the browser is unavailable, and the route through the extension is the browser Aeven Web uses.

## Consequences

Browser on Aeven Web always answers: a tab, the install modal, or the unsupported-browser modal. A declined install leaves a console warning only, since the modal already explained the outcome.

## Verification

The ui-sidebar-browser and ui-sidebar-select specs pass (18); typecheck and lint are clean.
