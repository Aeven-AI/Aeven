# Agent Note: A cold session is listed with its title

Status: implemented

English | [中文](2026-09-13-a-cold-session-is-listed-with-its-title.zh.md)

## Problem

Session rows in the navigation occasionally read `project` — the basename of the session's working directory — instead of a name, and reloading the page brought the names back. The display chain is `displayTitleOf(title, cwd, id)` (`packages/api/session-controller/src/client/sessions/service.ts`): durable title, then the cwd basename, then the raw id. So `project` was never a lost name; it was the fallback for a row the client believed had no title.

Tracing it showed two different causes:

- **Sessions that never received a message.** Their logs hold only `session`, `permission/preset`, `sandbox/mode`, and `approval/policy` — no `user/message`, so no title producer ever had input (titles come from an eligible `user/message`: an LLM provider or the deterministic first-words fallback). Nine of 126 cached sessions were in this state. These keep the basename and are not this note's subject.
- **Titled sessions listed without their title.** Reported from the running GUI, and reproduced in the code: a row's title is read from the client's per-session projection store, which is fed by the control baseline (attached sessions), live `projection` frames, and a list pull. For a **cold** session — visible in the list, not attached to an agent — only the list pull can carry it, and that pull was served from the projection cache's hint block. Those hints are partial by design: only version-matching wire cells survive (`projectionsFor`'s comment: "Listing hints contain every currently cached wire value but remain partial: missing cells and cache rows are never materialized here"). A cached, non-blank row whose block had `sessionListMetadata` but no `title` cell therefore sailed past the existing completeness test — which only asked whether the row was *blank* — and was listed nameless. Clicking the row attached the session and materialized the title; a reload re-pulled the list, which is why both made the name appear.

## Decision

`ApiSessionList.summarizeCold` treats a hint block without a title cell as incomplete and takes the bounded cold observation it already had for the blank case (`probeSmallCold`: one `observeSession` over an artifact under `coldBlankProbeMaxBytes`, per-session failures tolerated and logged). The new `coldHintsComplete` states what a list row needs: `sessionListMetadata.blank === false` **and** a `title` string. A blank row still needs nothing — the navigation labels it with the localized New Session copy — and a row whose probe is unavailable (large artifact, no persistence, read failure) keeps the old behaviour and falls back to the cached block.

The client was left alone. A client-side heal was written first — re-pull the list when a title-less row moves, debounced and budgeted per session — and withdrawn: it guessed at how long a pull takes, healed only rows that happened to move afterwards, and papered over a host that was answering incompletely. With the host answering completely, a page load, a reconnect, and any later list pull all carry the title, and a title that appears while the page is open reaches the row through the projection frame the live session already broadcasts.

## Alternatives considered

**Re-pull the list from the client on a timer or on row activity.** Withdrawn as above: unbounded in the wrong direction (a session that never gets a title would keep asking) and bounded in the wrong direction too (a title that arrives without later activity would never heal). The host knows whether it has a title; the client was guessing.

**Fold the title from the log for every cold row on every list.** Rejected: reading a body per row per pull is what the projection cache exists to avoid. The probe stays gated by `coldBlankProbeMaxBytes`, which is exactly the size a body read is acceptable at.

**Show a localized untitled label instead of the cwd basename — done, and for both cases.** The basename is not "at least true": it is a plausible-looking name for the wrong thing. The chain now ends at the Session id and the renderer labels those rows as untitled, so a row that has no title says so, and no row can ever be mistaken for one named after a directory.

**Carry the title outside the projection block (a dedicated summary field).** Rejected: the title already is a projection, `titleProjectionDefinition` already declares its wire view, and a second channel would have to be kept in step with it. The block was incomplete, not the wrong shape.

**Keep the hint block as-is and let the client ask per session.** Rejected: there is no per-session projection read on the wire, and every client would have to implement the same repair.

## Consequences

- A cold session with a title is listed with it, on the first pull after this change, without a click and without a reload. Rows that were previously basename-named because their cache lost the cell become named as soon as the list is pulled again.
- Sessions that never received a message have no title to show, and the display chain no longer pretends otherwise: `displayTitleOf` is `title ?? id`, with the working-directory basename removed, and the renderer labels a row whose Session has no durable title with the localized untitled copy. A folder name is never a session's name — it reads exactly like a real title, and it cannot be told apart from a session someone actually called "project".
- Cold listing now performs one bounded observation for non-blank rows whose cache lacks a title cell. That set is small and historical (caches written before the cell existed, or invalidated by a version gate) and the probe is the same one the blank case already ran, under the same byte budget; a row whose probe yields nothing keeps its cached hints.
- Nothing changes for attached sessions: they already carried titles, through `summaryFor`'s live snapshot.

## Testing

`packages/api/session-controller/tests/session-cold.host.spec.ts` pins it: a cold session whose cached hints hold `sessionListMetadata` but no `title`, over a log carrying a `session/title` event, is listed with that title — the case fails against the previous completeness test with `expected undefined to be 'Fix the sidebar labels'`. The same spec's cached-non-blank fixture now carries a title cell, which states the other half of the rule: complete hints are not re-read, and its inspection count stays at three. `manager.client.spec.ts` keeps the client's own contract unchanged — the withdrawn heal's cases are gone with it.
