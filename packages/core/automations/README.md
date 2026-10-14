---
description: "Built-in local task scheduling and durable execution history."
kind: "package-reference"
---

# @aeven/automations

English | [中文](README.zh.md)

## Summary

Automations execute confirmed tasks in fresh Aeven conversations. The Web and desktop compositions include the service by default. Users create and adjust tasks through the ordinary composer; the `/automations` page shows their schedules and results. Definitions belong to their creating account; each run retains the approved task revision, execution settings, and result.

## Execution

One-time, interval, daily, and selected-weekday schedules with optional end times use an explicit IANA time zone. Intervals must be at least five minutes. Calendar arithmetic is adapted from [titanwings/dsh-automation](https://github.com/titanwings/dsh-automation/tree/0d73a4e03639d4f63d0771ae4490e2718b7e7aa0/src) under MIT; the included LICENSE preserves attribution. Nonexistent DST wall times are skipped. The service admits an occurrence durably before starting an agent and skips overlapping work. A late Host considers only the latest occurrence; it records that occurrence as skipped when it falls outside the configured grace window. Interrupted queued or running records become failed on restart and are never automatically replayed.

The Host uses its existing account identity, agent presets, model selection, workspace, connector and credential services. Every run conversation belongs to the built-in Automations workspace, which the service declares at startup; like Chats it has no directory, cannot be renamed, moved, or deleted, and each account sees only its own run conversations there. Every run has its own session titled with the automation's name and explicit plugin provenance. The run conversation stays open after the run settles, so the owner can inspect and continue it. A finished run requires a completed durable turn; it does not establish that the requested work or an external side effect succeeded. Deliberate retries create a linked run from the original approved task and are refused while the automation has active work. Creation and task expansion through agent tools require approval. A run asks approvals through the owner's open client. A scoped approval the owner gives in a run conversation — during the run or afterwards — is saved on the automation, and later runs answer the same tool and scope without asking. Without an open client or a saved approval, the request fails closed. Files may be read or edited according to the confirmed permission selection.

## Configuration

The composing profile supplies `maxConcurrentRuns`, `runTimeoutMinutes`, `misfireGraceMinutes`, `historyLimit`, and `workspaceTitle`. The built-in Web profile supplies two concurrent runs, a sixty-minute timeout, fifteen minutes of catch-up grace, two hundred retained finished records per account, and the workspace title `Automations`. The service retains at most `historyLimit` finished records per account, always keeps queued and running records, and preserves scheduled admission watermarks independently of retained history. Definitions and runs use the existing storage-domain provider; no separate scheduler process or database is required. An account may remove one finished record or clear its finished history explicitly, which keeps queued and running records. No removal deletes a run conversation: the conversation of each removed record, whether removed explicitly or beyond `historyLimit`, joins the registry-global archive set, so it leaves the sidebar while its log stays readable and restorable from the Archived section. At startup the service also archives any unarchived conversation in the Automations workspace that no retained record names. Archiving goes the other way too: run history leaves out a run whose conversation is archived, and lists it again once the conversation is unarchived.

## Model Experience

### Management tools

#### What the model sees

The root conversation of an account receives the five tool definitions `automation_create`, `automation_list`, `automation_update`, `automation_run_now`, and `automation_retry`; a run conversation receives none of them. Each result is one text block holding `JSON.stringify` of the service value. Create, update, and retry are held for the owner's approval before they run, with a fixed ask reason: `Confirm this automation’s task, schedule, and allowed file access before enabling unattended work.` or, for a retry, `Inspect the earlier run before retrying: external changes may already exist.`; a pause that names only `id` and `status` is not asked. The `automation_create` description is the guidance the model reads while turning a request into a task:

##### Create description

```markdown
Create a built-in automation after human confirmation. Translate the user’s request into a self-contained task and explicit local schedule. Ask only for missing requirements. Future runs start fresh conversations with this account’s capabilities. An external action that needs approval asks the user in the run conversation; once the user approves it there, later runs perform it without asking.
```

#### Token effect

Five fixed definitions on every request of that root conversation, independent of how many automations the account owns. A call's arguments and its JSON result stay in the transcript until compaction; `automation_list` is bounded by `historyLimit` finished records per account plus every queued and running record.

#### KV Cache effect

Prefix-stable while the account's root conversation keeps the same tool set in the same order; the definitions do not change with the automations it manages. Call results are append-only.

### Run task message

#### What the model sees

A run is a fresh conversation whose first message is a notice from the `automations` plugin, carrying the saved task and its own identity and verification instruction. The conversation's title is the automation's name, and the run reuses only approvals saved on the automation; it inherits no source conversation history or that conversation's approval grants:

##### Run notice

```markdown
Automation: <name>
Run: <run id>
Scheduled for: <ISO timestamp>

<the approved task>

Report completed work with evidence. Do not claim an external action succeeded without confirmation.
```

#### Token effect

The notice is the run's first user message, resent with the rest of the run's conversation at every later step until compaction. Each run also uses its saved provider and model selection.

#### KV Cache effect

Append-only: the notice follows the prefix the run's agent preset assembled, and it does not change while the run stays open.

### Run-time refusals

#### What the model sees

A run conversation may not create more unattended work or ask interactive questions: a call to any `automation_*` tool or to `ask_user` is denied by a guard, and the model reads the denial as `Error: Automations cannot create more unattended work or ask interactive questions.` The run's permission preset and its approval policy are its own, both set when the run conversation is created.

#### Token effect

A denied call adds this single-line error to the transcript, once per call, retained until compaction.

#### KV Cache effect

Append-only; the denial arrives as a tool result after the reusable request prefix.

## Known Limitations and Deferred Work

The serving Host must be running and the computer awake. Hosted execution, OS startup supervision, event triggers, hybrid handoffs, notification delivery, and durable approval continuation are not implemented. A run has no project directory. Approvals without a requester scope are asked in every run, and saved approvals have no revocation surface yet. Tasks whose external-write approval is neither saved nor answered fail closed; they can prepare artifacts but cannot bypass those approvals. The version-3 domain rejects older data. Recurrence supports an optional inclusive end instant; monthly, yearly, custom-rule and hour-bounded hourly schedules are not supported.

- **No invariant companion** — No invariant companion is published because management and scheduling both read the same durable domain records, so the service holds no second observation those records could diverge from.
