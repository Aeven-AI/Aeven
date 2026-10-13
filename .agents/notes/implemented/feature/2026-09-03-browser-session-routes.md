# Agent Note: Browser Session routes

Status: implemented

English | [中文](2026-09-03-browser-session-routes.zh.md)

## Problem

The Web client selected Sessions only inside the Session Controller. The address bar stayed at `/`, so a selected Session could not be copied as a direct link, a reload carried no explicit navigation intent, and browser Back and Forward did not traverse Session selections.

## Decision

The Workspace UI navigation service projects the selected Session to `/c/:id`, where the id is the Host's own minus the `session-` it mints: the collection segment and the id prefix both said "session", on the one path the client routes. The prefix comes off on the way out and is restored on the way in, so every id the rest of the client handles is unchanged, and an address still carrying it is read as it stands rather than prefixed twice. Initial baseline reconciliation replaces the launch history entry, subsequent Session changes push entries, and `popstate` reopens the Session named by the restored path. A valid route takes precedence over the persisted current selection after the Session and Workspace baselines become ready. An unknown id is removed before the existing recent-Workspace fallback chooses a Session.

The frontend-static fallback serves the authenticated app index for missing extensionless paths under `/c/`. Static files keep direct-file semantics, existing directories remain 404, and unknown paths outside that explicit prefix remain 404. This keeps Session reloads inside the SPA without turning every typo or missing asset into an index response.

## Alternatives considered

**Keep navigation entirely in memory.** This preserved the smallest Client surface but gave browser history, reload, and copied links no Session identity.

**Store Session identity in a query parameter or hash.** Both avoid a server change, but they make primary application navigation look like incidental page state. A pathname gives Sessions a stable top-level Web address.

**Serve the index for every extensionless miss.** A broad fallback would make future client routes effortless, but it would also hide unknown path mistakes. The server therefore admits only the route prefix the Client currently owns.

## Consequences

Session navigation is now a two-way projection between browser history and the Session Controller. Every new top-level SPA route needs both Client parsing and an explicit frontend-static prefix with real-composition coverage. Session ids are percent-encoded in the pathname, while query and fragment fields unrelated to Session selection survive Client transitions.
