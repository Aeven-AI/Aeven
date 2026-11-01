# Agent Note: A repeated wall time fires on its first instant

Status: implemented

English | [中文](2026-11-01-fall-back-first-instant.zh.md)

## Problem

A calendar recurrence names a wall time in an IANA zone, and `localCandidate` turned that wall time into one instant with `DateTime.fromObject({ …hour, minute… }, { zone })`. During the autumn fall-back the same wall time occurs twice, and Luxon resolves the ambiguous input to the later offset: for `01:30` in `America/New_York` on 2026-11-01 it returned `06:30Z`, the second instant, while `05:30Z` is the first. A machine-local check reproduces it on every build, because the resolution depends on the zone rules alone, not on the day the test runs. The failing boundary spec is what surfaced it: `recurrence-boundaries.spec.ts` expects the schedule to fire once, on the first instant.

## Decision

`localCandidate` asks Luxon for every instant that carries the wall time — `getPossibleOffsets()` — and returns the earliest. Both scans inherit the rule: `nextOccurrence` and `latestDueOccurrence` share `localCandidate`, so the day boundary, the misfire window, and the catch-up path agree on which occurrence fired. A wall time the spring-forward hour erases still returns `null`: the existing validity and wall-time comparison keeps that branch explicit.

## Alternatives considered

- **Keeping Luxon's later-offset resolution and changing the spec.** The second instant is an hour after the wall time the schedule names, so a daily automation would drift an hour on the fall-back day and a catch-up after an outage would re-fire a row that already ran.
- **Comparing offsets by hand** from `zone.offset(timestamp)` around the candidate day: it re-derives what `getPossibleOffsets()` already reports, in code that has to guess the transition instant.
- **Resolving ambiguity from the process time zone**: the schedule carries its own zone, so the machine's zone may not even be the one that repeats the hour.

## Consequences

A fall-back day now produces one occurrence at the first instant for every calendar kind — `daily`, `weekly`, `monthly`, `nth-weekday`, `yearly`, `hours`, and `cron` — because they all reduce to wall times. The later instant is never scheduled, so the daily cadence after a fall-back is 25 hours rather than 24, which is what the wall time means. `getPossibleOffsets()` costs one extra zone lookup per candidate wall time; the lookback scan calls it at most a few times per evaluation.
