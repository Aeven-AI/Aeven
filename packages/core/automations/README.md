---
description: "Built-in local task scheduling and durable execution history."
kind: "package-reference"
---

# @aeven/automations

## Summary

Automations execute confirmed tasks in fresh Aeven conversations. The Web and desktop compositions include the service by default. Users create and adjust tasks through the ordinary composer; the `/automations` page shows their schedules and results. Definitions belong to their creating account; each run retains the approved task revision, execution settings, and result.

## Execution

One-time, interval, daily, and selected-weekday schedules with optional end times use an explicit IANA time zone. Intervals must be at least five minutes. Calendar arithmetic is adapted from [titanwings/dsh-automation](https://github.com/titanwings/dsh-automation/tree/0d73a4e03639d4f63d0771ae4490e2718b7e7aa0/src) under MIT; the included LICENSE preserves attribution. Nonexistent DST wall times are skipped. The service admits an occurrence durably before starting an agent and skips overlapping work. A late Host considers only the latest occurrence; it records that occurrence as skipped when it falls outside the configured grace window. Interrupted queued or running records become failed on restart and are never automatically replayed.

The Host uses its existing account identity, agent presets, model selection, workspace, connector and credential services. Every run has its own session and explicit plugin provenance. A finished run requires a completed durable turn; it does not establish that the requested work or an external side effect succeeded. An explicit owner confirmation records a verified result. Deliberate retries create a linked run from the original approved task and are refused while the automation has active work. Creation and task expansion through agent tools require approval. External connector write approvals remain enforced, and unattended runs cannot answer them. Files may be read or edited according to the confirmed permission selection.

## Configuration

The composing profile supplies `maxConcurrentRuns`, `runTimeoutMinutes`, `misfireGraceMinutes`, and `historyLimit`. The built-in Web profile supplies two concurrent runs, a sixty-minute timeout, fifteen minutes of catch-up grace, and two hundred retained finished records per account. The service retains at most `historyLimit` finished records per account, always keeps queued and running records, and preserves scheduled admission watermarks independently of retained history. Definitions and runs use the existing storage-domain provider; no separate scheduler process or database is required. An account may clear its finished history explicitly, which keeps queued and running records.

## Model Experience

The root conversation receives `automation_create`, `automation_list`, `automation_update`, `automation_run_now`, `automation_retry`, and `automation_confirm_result`. Schemas add a stable model-request prefix, and canonical JSON results append to the ordinary tool history. A run starts with the saved task, occurrence identity, and verification instruction, recorded as an `automations` plugin notice. It inherits no source conversation history or approval grants. Each run uses its saved provider/model selection.

## Known Limitations and Deferred Work

The serving Host must be running and the computer awake. Hosted execution, OS startup supervision, event triggers, hybrid handoffs, notification delivery, and durable approval continuation are not implemented. Tasks requiring interactive external-write approval fail closed; they can prepare artifacts but cannot bypass those approvals. The version-2 domain rejects version-1 data. Recurrence supports an optional inclusive end instant; monthly, yearly, custom-rule and hour-bounded hourly schedules are not supported. The service has no independent invariant installer because management and scheduling read the same durable-domain records.
