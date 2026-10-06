# Agent Note: The desktop shell waits for a booting Host instead of starting a second one

Status: implemented

English | [中文](2026-10-07-desktop-waits-for-booting-host.zh.md)

## Problem

The desktop shell adopts a Host that already serves its Aeven home, because two Hosts on one home overwrite each other's domain documents. It decided once, at launch: read `runtime/host.json`, probe the advertised URL for 1.5 seconds, and start a Host of its own on any miss. A web Host writes that lease only after its whole boot, about nine seconds on a development machine, and a restarting Host removes its lease on shutdown first. A shell launched in that window found no lease and started a second Host on the same home; in development every session then failed to load its history with `gateway/internal`, and the sidebar showed every session as ungrouped.

## Decision

The CLI entry claims the lease for a profile run before it loads the boot graph ([`apps/cli/src/host-claim.ts`](../../../../apps/cli/src/host-claim.ts)), recording only its pid and start time, so the unclaimed window is Node startup alone. After boot, a Host with an HTTP surface adds its tokenized URL to that claim ([`apps/cli/src/profile-boot.ts`](../../../../apps/cli/src/profile-boot.ts)); a Host without one gives the claim back, so a headless invocation still leaves the home free for a GUI. A live lease held by another process is never overwritten by the claim.

`planDesktopBackend` ([`apps/desktop/src/attached-host.ts`](../../../../apps/desktop/src/attached-host.ts)) re-reads the lease every 250 ms while its process is alive, until the lease carries a URL that answers or 30 seconds pass. It starts a Host of its own only when the home has no lease, the leased process has exited, or the wait runs out, and the shell logs which of those applied.

## Alternatives considered

**Lengthen the single probe.** A longer timeout covers a slow answer but not a Host that has not advertised yet, which is the window that produced the second Host.

**Make the shell refuse to start while any lease is live.** A Host that hangs before advertising would leave the user with no window; the bounded wait falls back to today's behavior instead.

**Claim the lease only for the web profile.** Whether a tree serves HTTP is known only after its plugins mount, so the claim is taken for every profile and returned by trees without a web server.

## Consequences

A shell launched while a web Host boots or restarts adopts it once it serves; one whose check lands before the new process has started Node still finds no lease. A shell launched while a headless run boots waits until that run finishes booting and returns its claim, then starts its own Host. A Host that stays alive without ever answering delays the shell by 30 seconds before it starts its own. The adoption specs in `apps/desktop/tests/attached-host.spec.ts` that expect an immediate fallback for an unanswering or URL-less live lease describe the replaced single-probe behavior.
