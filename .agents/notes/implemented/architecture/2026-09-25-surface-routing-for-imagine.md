# Agent Note: Full-page surfaces own a path root; the chat owns only `/` and `/c`

Status: implemented

English | [中文](2026-09-25-surface-routing-for-imagine.zh.md)

## Problem

Imagine needs a page of its own at `/i/<id>`, separate from chat Sessions. Nothing in the client could show one. The center column always rendered the `conversation` slot, and the chat's address projection (`BrowserSessionUrlNavigation` in ui-workspace) treated the whole address bar as its own: an address it could not read as `/c/<uuid>` was rewritten to the current chat, and a Back or Forward onto such an address started a New Session. The Host also served the application only for its listed client route roots, so `/i/<id>` answered 404.

## Decision

**ui-layout owns surface routing.** `ctx.layout.surfaces` is a small router over the History API. A surface registers the one-segment path root it owns (`register({ id, root })`, returning the disposer; a malformed root or a colliding id or root throws at registration). `current` is a hook source naming the surface that owns the current path, or undefined for none; it follows popstate and the router's own `push`/`replace`, since History writes raise no event. AppFrame renders the keyed, root-scoped `surface` slot under that id in place of `conversation`, and reads the `details` and `rightbar` columns as closed while a surface shows, because both belong to the current chat Session. Their stored state is untouched, so the chat reopens as the reader left it.

**The chat states its own address space instead of consulting the router.** `BrowserSessionUrlNavigation.ownsAddress()` is true for `/`, `/c`, and `/c/…`. On any other address the projection reads no Session and writes nothing, and `navigateFromUrl` ignores it, so Back into Imagine does not start a New Session. Session reconciliation itself keeps running on an Imagine address: boot still selects or creates a chat Session, which is what `whenInitialDataReady` and the page preloader wait on.

**Imagine is one surface among possible others.** `@aeven/client-ui-imagine` claims `/i`, rewrites a bare `/i` or a non-UUID id to a fresh `/i/<uuid>` in place, and registers its page under the `imagine` key. The id names no Session. `frontend-static` lists `/i` among its client route roots.

## Alternatives considered

**Teach the chat navigation about Imagine.** ui-workspace could special-case `/i` or query the router. Rejected: the chat would then know every surface, and a new surface would edit chat navigation. Owning only `/` and `/c` needs no dependency and holds for any later surface; the application never boots on the authentication routes, which move the reader to their destination before the plugin graph starts.

**Keep the conversation mounted under the surface.** Hiding it would keep its scroll position, but the chat composer claims focus when it mounts and would keep taking keystrokes behind the page. The conversation unmounts; its drafts live in Session state, not in the component.

**A chain slot for the whole center column.** Making `conversation` one entry of a chain would let a surface elect itself, but it changes the conversation's registration and its session-maybe scope for every deployment. A keyed `surface` slot beside the unchanged `conversation` slot leaves the chat untouched.

## Consequences

A surface is a path root plus a page: adding one needs no change to ui-layout, ui-workspace, or the chat. The Host's route-root list stays a fixed list, so each new root is one line there. The chat Session stays selected underneath a surface, so the corner's right-sidebar toggle still acts on that Session's panel while it is hidden. The Imagine start page restates the chat hero composer's CSS until the two composers share a component; its README lists this.
