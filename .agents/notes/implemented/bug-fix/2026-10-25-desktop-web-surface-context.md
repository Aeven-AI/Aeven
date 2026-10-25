# Agent Note: Desktop web-surface context

Status: implemented

English | [中文](2026-10-25-desktop-web-surface-context.zh.md)

## Problem

The desktop shell disables the `web-runtime` row because it serves and opens the GUI itself, and that row also registered the model's surface context. Desktop sessions therefore lacked the `app:web-surface` section, which states that replies render as Markdown and that an image is shown by embedding its absolute local path. A desktop session asked for screenshots took and inspected them, replied with none, and then opened a page in the in-app browser instead.

## Decision

`@aeven/web-app/surface` owns the surface context: the `app:web-surface` section, the `app:web-url` runtime context, the `AVN_WEB_URL` shell variable, and the developer-only `harness:source` section. The `web-app` row mounts it while `surfaceContext` is true, so `avn web` is unchanged, and the desktop patch inserts it as its own `web-surface` row beside the disabled `web-runtime`. The desktop renderer already loads absolute local image paths through `/api/file` on `avn-app:` pages.

## Alternatives considered

**Re-enabling `web-runtime` on desktop** would also mount the static frontend owner, LAN trust, the URL line and the browser handoff, which the desktop shell replaces. **Copying the section into the desktop host** would give the same prompt text two owners.

## Consequences

Desktop sessions gain one prompt paragraph and the URL runtime context, the same cost as `avn web`. The section text calls the surface the Aeven Web GUI, which is the GUI the desktop window renders. The host build entry list gains `surface`, and `@aeven/desktop-host` depends on `@aeven/web-app` to resolve the row.
