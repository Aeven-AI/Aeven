# Agent Note: Lasting knowledge reaches every conversation through a profile and recorded dates

Status: implemented

## Problem

On 27 October 2026, the owner's birthday, a new chat opened with "goodmorning" and the assistant did not know it was his birthday, then gave his age as 48 instead of 49. His birth date had been stored about thirty times since 2 October. Turn-start recall reaches a memory only when the turn's words match it, plus the person's memories from the last `recentPersonHours` (168); a greeting matches nothing, so in practice a plain message saw one week of the person's life. The same chat showed three related faults: a memory recorded two days earlier was read as last night, an age stored as "48" was repeated on the day it changed, and `memory_get` returned the assistant's own earlier reply as the trace body without a label, so it read as a fact about the person.

## Decision

Lasting knowledge no longer depends on the turn's words. `ctx.memory.profile({ scope })` reads from all of the owner's person memories regardless of age, following the pattern of an always-present core memory beside a searched archive (Letta's `human` block, ChatGPT's saved memories):

- Recorded dates are read deterministically on every profile read: a day and month shortly after a word such as born, birthday, married, or died, or in a birthday list, with the year when stated. A date in the current year or later records an arrangement and is left out ([`dates.ts`](../../../../packages/memory/memory-memos/src/dates.ts)).
- A profile text is distilled in the background on the asking session's route, folding newer person memories into the stored profile in batches with a resumable cursor ([`profile.ts`](../../../../packages/memory/memory-memos/src/profile.ts)). It writes birth dates, never ages, and dates each current situation.
- `@aeven/memory-context` renders both as a `<memory_profile>` block on a session's first turn and the first turn of each later day: today's date in the browser zone, dates falling today or within `upcomingDays` with the birthday count or years since, other birth dates, and the profile. Birth dates are stated as birthday counts and "born N years ago", never as an age, because a recorded parent may have died.
- The first conversation of the owner's day that states a date falling today marks it; later conversations that day are told it was marked, found in-process or, after a Host restart, through a person memory recorded today that mentions a birthday or an anniversary. A second chat on a birthday therefore does not congratulate again.

Recall lines state how long ago each memory was recorded, the guidance says an age or "now" inside a line is as of that day, and the relevance judgment no longer says recent memories matter most without qualification: lasting facts matter however old they are. `memory_get` labels a trace's parts `User message:` and `Assistant answer:` as `memory_search` does.

### Verification

- `tsc --noEmit` passes for `memory`, `memory-memos`, `memory-context`, `tool-memory`, and `api-memory-manager`.
- Live on the owner's account (1180 person memories): a new chat's "goodmorning" received the birthday line and the reply opened with a happy 49th birthday; a later chat after a Host restart received "already marked in an earlier conversation today" and did not congratulate again; "how old is Alan now?" was answered as 9 from the recorded birth date. The profile was distilled from memories dating back to the owner's school years.

## Alternatives considered

- Widening `recentPersonHours`: rejected; a window of any length still loses what lies outside it and floods the relevance judgment with recent detail.
- Storing the profile as a confirmed invariant: rejected; invariants are statements the owner confirmed, and the profile is derived and changes as memories arrive.
- Letting the distilled profile carry dates alone: rejected; a model-written date can be wrong, while the recorded dates come from the memories verbatim.

## Known limitations

- The profile is bounded by `profile.maxChars` (6000), so minor details from long ago reach a turn only when recall matches them.
- The day-mark lookup after a restart depends on the capture summary of the marking conversation mentioning a birthday or an anniversary.
