# Agent Note: One shared GUI Host per Aeven home

Status: implemented

English | [中文](2026-10-07-desktop-waits-for-booting-host.zh.md)

## Problem

Independent Web and Electron Hosts can read the same durable data while holding separate Sessions, sequence cursors, and workspace documents in memory. Concurrent appends produce overlapping sequences; whole-document domain writes replace another Host's workspace membership. An advertisement published only after boot leaves a startup race. An advisory PID record and a readiness timeout cannot prevent competing execution.

## Decision

GUI launchers claim a kernel lock at `runtime/host.lock` before mounting stateful plugins. The CLI inspects the composed profile for its HTTP server; headless and stdio profiles retain independent execution. Electron's child uses the same claim. The owner publishes an authenticated endpoint atomically at `runtime/host.json` after complete boot. A contender attaches to that endpoint or reports a readiness failure; a live process never loses ownership because a probe or deadline expires. Lock files remain in place, and process death releases the kernel claim. Existing live advertisements also block a new writer during upgrades.

Electron and ordinary browsers use the same authenticated HTTP application. The Electron child defaults to loopback port 3080 and serves the matching frontend plus workspace-file routes. Electron's IPC admits its application origin, and adopted sign-in discovery uses Electron's cookie-aware session. The serving profile and plugin capabilities belong to the first launcher; another launch reports the existing endpoint without applying new flags or patches.

[Desktop Host lifetime follows client leases](../architecture/2026-10-15-desktop-host-lifetime-follows-leases.md) supersedes this note's quit behavior: a desktop-started Host stops once its shell and every client lease are gone. Explicit shutdown drains the application before releasing ownership. A failed teardown keeps the kernel claim until process exit. Desktop startup does not replace an adopted Host's package graph, and package validation or activation refuses an externally owned Host. The [per-session writer lock](2026-10-10-session-writer-ownership.md) remains necessary for independent non-GUI processes.

## Alternatives considered

**A longer readiness probe or PID-only advertisement.** Neither serializes the decision to boot when two launchers find no serving Host. A live but stalled Host may resume writing after a timeout, so starting a competing backend is unsafe.

**Separate Hosts with shared session files.** Session locks prevent corrupt appends but cannot provide one live execution and shared account-domain state to both clients.

**Stop the Host when Electron quits.** Electron is one client of the shared application. Its departure does not authorize interrupting another client's work.

## Consequences

Web-first, Electron-first, and simultaneous GUI launches select one serving Host. Non-GUI processes keep per-session exclusion. Updating an externally owned backend requires stopping its Host first. Old running processes must restart to participate. Validation is limited to TypeScript and the repository build at the user's request; launch-order, crash, Windows-lock, and visible-client behavior remain unverified at runtime.
