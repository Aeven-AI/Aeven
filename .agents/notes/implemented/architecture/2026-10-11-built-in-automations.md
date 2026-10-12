# Agent Note: Built-in local automations

Status: implemented

English | [中文](2026-10-11-built-in-automations.zh.md)

## Problem

Users need repeatable agent work without managing plugins, cron expressions, or a live source conversation. Schedules must survive restarts without silently replaying work that may already have changed an external account.

## Decision

Automations are a default product capability in the Web composition. `/automations` is an addressable, wide management page above the ordinary composer. Creation and task expansion use conversation approval; the page adds no separate creation form. Registered start addresses dispatch keyed pages, so Automations and Imagine retain independent content. Management RPC uses `/automation-control`, separate from the page URL, and the desktop carrier forwards that owned channel to the serving Host. Action controls are 30px high with fully rounded corners.

## Rationale

Session-local Schedule delivers reminders into a live conversation and does not own standalone work. It retains that scope. Automations persist definitions and immutable occurrence records through storage domains and execute ordinary fresh root sessions. The calendar arithmetic is adapted from titanwings/dsh-automation at commit 0d73a4e03639d4f63d0771ae4490e2718b7e7aa0, preserving MIT attribution; its coding-only executor, workspace-only UI, and upstream API assumptions are not copied.

## Alternatives considered

The existing session Schedule serves reminders inside a live conversation and does not own standalone execution. Copying the upstream executor would restrict tasks to coding tools and bypass Aeven's current account and connector integration. A separate scheduling process would duplicate the existing Host and storage lifecycle.

## Consequences

A deterministic occurrence identity and durable admission watermark prevent replay after history pruning. Restart reconciles admitted run records into the watermark before pruning. The version-2 domain records local runner identity, retains a bounded number of finished records per account, always retains active work, and rejects version-1 data. Restart marks unfinished work failed because external side effects may already exist. Overlap and late occurrences are visible skipped records. Each new task or expanded task requested by the model requires ordinary approval. Session approval grants are not inherited, and connector-write guards remain authoritative. Management tools receive the identity authority from the service’s declared injection; they never resolve it through an agent context. Tool contributions belong to both the service and agent lifetimes. Failed runs support explicit confirmation or a linked retry, with retries refused during active work. A completed turn is shown as finished, not as verified success.

## Verification

Validation follows the user’s instruction: TypeScript and a green build, without test suites. Browser inspection verifies direct navigation and refresh at `/automations`, independent Imagine content, the wide layout, and 30px rounded controls. The user’s approved 13:00 Europe/Amsterdam headlines task is created through the real conversation tools and read back in the management page. That verifies management and persistence; it does not establish tomorrow’s timed execution or every external effect. Hosted execution, external notification delivery, durable approval continuation, and OS startup supervision remain unimplemented.
