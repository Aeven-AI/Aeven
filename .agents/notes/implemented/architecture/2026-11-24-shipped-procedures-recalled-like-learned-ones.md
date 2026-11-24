# Agent Note: Shipped procedures are recalled like learned ones, and Enter in a post composer is not a send

Status: implemented

English | [中文](2026-11-24-shipped-procedures-recalled-like-learned-ones.zh.md)

## Problem

Aeven needed site know-how for every user, starting with LinkedIn posting: the link preview card hides the Media button, two different controls are both labelled `Dismiss`, and one video never goes with images. A preset skill would carry it, but every skill puts its description into every session's catalog, so each new site makes every conversation longer. Learned procedures avoid that cost because memory recall offers only the ones a request matches, but they exist only per owner, as what that owner's agents learned.

Recording the LinkedIn procedure also showed the send guard misreading the post composer: Enter there adds a line, yet the guard asked "Send this message on linkedin.com", and the approval card read the same for that Enter as for a click on Post, so the person could not tell a line break from publishing.

## Decision

### Shipped procedures

- `ctx.memory.ship(procedures)` registers procedures a composition ships for every owner and returns the disposer; `shipped()` lists them, one per name, earliest live registration first. Each carries the id `shipped:<name>` (`shippedProcedureId`), a description, a summary of at most 950 characters, the full procedure, and a domain.
- The memory service adds them to every turn-start `recall` as `shipped`. `@aeven/memory-memos` scores them with the owner's procedures (embedding of name and description, then shared words) and delivers a chosen one as an `active` procedure hit with its summary, except one whose name a non-archived procedure of the owner uses. When a shipped procedure qualifies but none ranks among the first `procedureCandidates`, the best one takes the last place: in the recorded check, an owner's own single-run LinkedIn procedure otherwise outranked the shipped one. An offered shipped procedure then leads the recall's hits: in the same check the unjudged block filled its 16,000 characters with retrieval hits and left out the shipped procedure, which arrived after them.
- The service answers a `trace` `detail` of a shipped id itself, so `memory_get` reads the full procedure, and declines `edit`, `forget`, and `setProcedureStatus` for one without reaching the provider. `procedures()` still lists only the owner's own, so Settings → Memory shows no shipped procedure.
- `@aeven/tool-capability` reads them from `shippedProcedures` (absolute directories, one Markdown file per procedure with `name`, `description`, `summary`, optional `domain` frontmatter) at load, fails the load on a malformed file, and registers them. The learner offers a shipped procedure the owner has no procedure of its name for as an active one it may update; an update is stored as the owner's own procedure of that name and supersedes the shipped one for that owner, with the status an update of an active procedure gets.
- The Aeven preset ships `procedures/` beside its composition; `linkedin-post` is the first procedure. Its steps come from a recorded run of every composer case in the sidebar browser, with nothing published.

### Send guard and approval card

- The outbound probe treats a plain Enter in a multi-line editor (`textarea` or `contenteditable`) as adding a line when the editor's dialog, form, or article shows a control whose label opens with a Post verb and none with a Send verb. Chat composers show Send and single-line inputs submit their form, so both keep asking, and so does Enter with Control, Meta, or Alt, which publishes in X's composer; `preview_press` passes that chord to the probe.
- `ApprovalOutbound.trigger` names the input that publishes, `{ kind: 'key', key }` or `{ kind: 'click', label }`; `preview_*` approvals set it from the probe, and the approval card shows it as an Action line in zh, en, and es.

## Alternatives considered

- **One preset skill per site.** Rejected because each skill's description enters every session's catalog, whatever the request.
- **Copying shipped procedures into each owner's memory.** Rejected because every account would hold a copy, Settings → Memory would list procedures the owner never made, and a shipped update would have to tell an untouched copy from one the learner revised.
- **Delivering a procedure when the sidebar browser shows its site.** Rejected because a request such as "post this on LinkedIn" made while the browser shows another page would get nothing.

## Consequences

- A shipped procedure costs a turn nothing unless recall chooses it; adding one is a Markdown file in the preset's `procedures/`.
- A shipped procedure changes only with a release, and an owner's learned copy of the same name stops receiving those changes.
- Enter in a post composer whose Post control is not labelled with a known Post verb in the page language still asks.
