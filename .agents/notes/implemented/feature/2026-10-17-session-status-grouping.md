# Agent Note: Session Status Grouping

Status: implemented

English | [中文](2026-10-17-session-status-grouping.zh.md)

## Problem

The sidebar's second grouping mode, **In one list**, merged every Session into one recency-ordered list. Recency answers "what did I touch last", not "what needs me now": a Session blocked on an approval looked like any other row apart from its status dot, and with several Sessions in flight the reader had to scan every row to find the one waiting on them.

## Decision

### By status replaces In one list

`SessionGroupBy` is `'workspace' | 'status'`. The view options offer **By workspace** (the default) and **By status**; the flat list, its `deriveFlat` projection, its browser-local order account (`FLAT_SESSION_ORDER_KEY`), and its promotion branch are deleted rather than kept beside the new mode. The persisted viewing store moves to `avn.workspace.view.v6`, so a stored `flat` preference degrades to the By workspace presentation instead of seeding a mode the actions cannot produce.

### Three derived buckets

`deriveStatusBuckets` projects every visible Session into **Needs input**, **Working**, and **Completed work**, in that order. `sessionBucket` reads only the facts a row already carries: a pending interaction wins over every other fact (a Session waiting on the reader is blocked, not working), then the Session's own run, its running subagent descendants, and its live background jobs are work in flight, and everything else is settled. Membership is a pure function of the live list projection, so a row changes bucket when its Session starts, waits, or settles with no event or stored state recording the move; a reload rebuilds the same arrangement.

Each bucket lists its rows newest first and keeps the Workspace section's five-row fold behind **Show all**. Buckets open on their rows until the reader folds them — they are the whole list rather than sections a reader opted into, and folding is persisted per bucket key in the same expansion record the Workspace groups use. Buckets take no reorder drag and the order options are absent while they show, because activity decides the order; the Workspace accounts keep theirs untouched.

A provisional blank **New Session** row waits in **Needs input** until its first prompt: the chat is waiting on the reader, so status grouping shows it instead of leaving a new chat reachable only through the Workspace view. Selecting a Session never reopens a folded bucket: the reader's fold holds until they reopen it, and only a reveal whose row sits past the five-row fold expands that bucket's **Show all**. `GroupNode.bucket` carries the bucket discriminant so the header row draws dictionary copy instead of a Workspace title, and the Archived section carries `bucket: 'archived'` through the same field.

## Alternatives considered

**Keep In one list beside By status** — a third grouping entry preserves a list that recency already answers inside every bucket; its only distinct product was a hand order, which status membership invalidates as soon as a Session moves. Deleting the mode removes `deriveFlat`, one order account, and one promotion path.

**Show only the non-empty buckets** — an empty **Needs input** bucket is the answer a reader wants ("nothing waits on me"); hiding it turns absence into ambiguity, and the folder set would shift under the reader as work starts and ends.

**Leave the blank New Session row out of the buckets** — the Workspace view that minted it lists it, but a chat started in status grouping would then vanish from the view the reader is looking at until its first turn started.

**Keep drag and the order options inside the buckets** — a hand order inside a bucket is discarded the moment its Session changes bucket, so the gesture would promise something the derivation cannot keep.

**Open buckets collapsed like Workspace groups** — the buckets are the list itself, so collapsing them by default would render the mode as three empty folders.

## Consequences

- The sidebar answers "what needs me" first: pending approvals, plan reviews, and questions lead the list whatever else is running.
- Status grouping ignores Workspace membership for the first time; Sessions from every Workspace, including managed ones the Show automations option controls, appear in the buckets.
- `apps/web` e2e specs (`workspace-management`, `schedule-after`) still drive the removed **In one list** menu item and were left untouched as stale.

## Testing

`tree.client.spec.ts` pins bucket membership and order, the classification precedence (pending over running, descendants and jobs as work), the new chat joining Needs input, archived/hidden/subagent exclusion, and fold behavior with `containsCurrent`. `workspace-browser.client.spec.tsx` pins the menu swap and its hidden order options, a row moving between buckets as its Session starts and settles, buckets open by default with a fold that survives a selection and reopens on the reader's click, the new chat moving from Needs input to Working on its first prompt, and the overflow expansion a reveal triggers. `browser-styles.client.spec.ts` drops the deleted flat-list spacing rule.
