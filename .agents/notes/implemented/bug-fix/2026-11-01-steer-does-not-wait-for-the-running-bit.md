# Agent Note: A Steer preference does not wait for the running bit

Status: implemented

English | [中文](2026-11-01-steer-does-not-wait-for-the-running-bit.zh.md)

## Problem

The composer chose queue or steer from `running`, read from the list entry and the snapshot the Host streams. That bit arrives at turn boundaries and can lag a step: a message sent while the agent was between steps reached `ComposerSubmissionPolicy.resolve()` with `running === false`, was admitted as a queue item, and needed a second gesture to become a steer — the session log shows the pair: a `next-turn` splice, its cancellation, and the same text entering `next-step` a moment later.

The downgrade was not protecting anything. `Agent.steer()` splices into `next-step` and wakes the driver, so it accepts a message on an idle agent as well; the delivery window belongs to the Host, not to a browser flag that can be one step stale.

## Decision

Plain Enter uses the busy-Enter preference whenever steering is available, whatever `running` reports. The accelerated chord still inverts that preference, but only against a running turn; an idle send delivers the same content either way, so it keeps the preference. Without steering support — an addressed subagent — both gestures stay Queue.

The prompt path stays as it was: `Agent.steer()` splices into `next-step` and wakes the driver, so the Host already accepts a steer on an idle agent — the recorded ACP scenarios replay exactly that shape — and no server change is needed for the client to stop second-guessing it.

## Alternatives considered

**Keep the client check and repair the running bit** — the bit is a relay of Host state over the event stream, so making it exact means waiting for a round trip before every send, which is the pause the optimistic send exists to avoid.

**Send every submission as a steer** — queue and steer differ in what the reader asked for: a queued message must not interrupt a running turn, and the preference is the only signal that says which one is meant.

**Drop `running` from the resolve signature** — the value still distinguishes an idle send for the accelerated chord, and removing it would touch the slot contract for no gain in behaviour.

## Consequences

A message typed while the agent works reaches the running turn as a steer even when the snapshot has not caught up. When the turn has genuinely ended, the Host's own splice decides what happens, so nothing is lost or held behind a second gesture.

The client can no longer report a delivery mode it knows is impossible: the mode it sends is a request, and the agent decides what it interrupts.
