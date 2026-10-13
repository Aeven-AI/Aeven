# Agent Note: Session reveal on address navigation

Status: implemented

English | [中文](2026-09-07-session-reveal-on-address.zh.md)

## Problem

The reveal that exposes a selected Session's row was reachable only through search. Addressable conversations give the reader three other ways to select a Session the sidebar never scrolled to: a pasted `/c/<id>` link, Back, and Forward. Each leaves the same question unanswered — where the open conversation sits in the Workspace hierarchy — while the owning Workspace can be closed, the row can sit beyond the five-row fold, and either browsing mode can place it outside the scrollport.

## Decision

[`WorkspaceBrowser`](../../../../packages/client/ui-workspace/README.md) arms the reveal from the current Session id rather than from the search transition, so every selection reveals its row and the address path needs no separate mechanism. Search keeps its extra work — clearing the query and collapsing the panel — because only search has a filtered view to leave.

Revealing on every selection rather than only on address arrivals is deliberate. A row the reader can already see costs nothing: an expanded group stays expanded, an unfolded remainder stays unfolded, and `block: 'nearest'` scrolls only a row that is actually out of view. The alternative required the browser to know which selections came from the address bar.

## Alternatives considered

**Plumb a navigation-origin signal from the URL policy into the browser.** The reveal would fire only for address arrivals. This threads a new fact through the navigation service, the Session list store, and the component for a distinction the reader cannot observe, because revealing an already-visible row changes nothing.

**Reveal only on the initial mount and on popstate.** A pasted address entered into a running client selects a Session without either event. The current Session id covers all three arrivals with one dependency.

**Give the URL policy its own scroll.** The policy holds no row element. The row that owns the DOM node already performs and acknowledges the scroll, and a second scroller would race it.

## Consequences

Selecting a Session by any route opens its owning Workspace and scrolls its row into view. A group the reader explicitly collapsed reopens when a Session inside it becomes current, which is the same exposure search navigation already performed. Creating a Session reveals its new row for the same reason.

jsdom implements no `scrollIntoView`, so a client spec that renders a selected Session row supplies one. This is a test-environment gap, not a product guard: the method is present on every element in a browser.

## Testing

A `WorkspaceBrowser` test selects a Session hidden behind the fold of a closed Workspace without touching search, and asserts the group opens, the row mounts, and the row is the scroll target. The existing search-path, pending-baseline, reconnect, cancellation, and flat-mode reveal tests continue to pin the shared mechanism.
