# Agent Note: Browser pointer arrival and reference motion

Status: implemented

English | [中文](2026-10-10-browser-pointer-arrival-and-reference-motion.zh.md)

## Problem

Browser input could land before the visible cursor arrived. A fixed quadratic path, discarded stretch transforms, repeated idle wobble, and synthetic scroll drift differed from the extracted Codex desktop cursor. Unbounded arrival waits can stall when Electron throttles background rendering, as recorded in the [pane pointer decision](2026-10-01-sidebar-browser-agent-pointer.md).

## Decision

Discrete guest input waits for a numbered acknowledgement from its owning app renderer, bounded to 1500ms. Hidden panes acknowledge immediately. Cancellation releases waiters and invalidates queued chrome actions. Direct pane navigation and history controls await the same overlay arrival method before acting.

Long journeys select among 20 cubic and segmented-arc candidates using bounds and smoothness scores. Path metrics determine timing. Short scoots, lengthwise stretch, compensated sprite rotations, visibility blur, and finite idle wobble follow the reference. Layout corrections jump without starting a journey; scrolling neither waits for arrival nor adds pointer drift.

## Alternatives considered

**Unbounded renderer arrival.** Background throttling can prevent progress; arrival has a fixed upper bound.

**Fire input immediately and draw afterward.** This disconnects page reactions from the visible cursor.

**Retune the quadratic curve.** This omits the reference's candidate selection, approach direction, and path-dependent timing.

## Consequences

The Electron preload and pane share cursor acknowledgement and cancellation messages. The pane retains its portal, control lookup, and pointer-only presentation. Build and TypeScript evidence do not establish frame-by-frame visual parity; live rendering remains unverified under the requested validation limit.
