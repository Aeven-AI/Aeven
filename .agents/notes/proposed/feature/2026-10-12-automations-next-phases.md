# Agent Note: Automations beyond a running Host

Status: proposed

English | [中文](2026-10-12-automations-next-phases.zh.md)

## Problem

Aeven ships durable local automations: a user describes recurring work, the service admits each occurrence durably, and a fresh root session executes it with the user's own presets, model, workspace, and connectors. The service lives inside the serving Host, so the package's own limitation list is honest and binding — the Host must be running and the computer awake, and nothing executes independently of that process.

Six gaps keep the shipped capability short of the product it is meant to become. Closing the desktop application stops the Host that owns the schedule, so an automation runs only while Aeven is open, and a machine that sleeps stops its timers. A run that reaches an external write fails closed, because an unattended run carries approval policy `never` and no answerer exists for it, which removes exactly the recurring work a user would want to schedule: sending the report, filing the reply, updating the record. A result is visible only to whoever opens Aeven, so an automation that finishes at 03:00 produces nothing the user notices. Time is the only trigger. Cloud placement does not exist, which leaves the account, credential, and permission questions it raises unanswered rather than answered. And the surface that would present scheduled work is a placeholder, so nothing an ordinary user sees suggests that a recurring task is something they could have.

## Proposal

This note plans the remaining phases. It fixes outcomes, the seams each phase uses, the evidence that proves a phase works, and what each phase risks. It deliberately does not prescribe internal structure: the packages, services, storage domains, session lifecycle, and composition rows that already exist decide how each phase is built, and every phase is expected to land as an extension of those abstractions rather than as a parallel mechanism.

This proposal extends the [built-in automations](../../implemented/architecture/2026-10-11-built-in-automations.md) and [hosted web surface and sync](../../proposed/architecture/2026-09-30-hosted-web-surface-and-sync.md) contracts; it supersedes none of them, and the shipped local service stays the authority for what exists today. No active Agent Note is archived when this proposal lands.

The following constraints are not open for trade during implementation.

- Automations execute real agent work in a fresh session, never a scheduled prompt and never a resumed source conversation.
- Local and hosted execution are one model with two execution targets. The execution target is fixed when the definition is created, or explicitly left as "the machine I am on", and the management surface never grows a second set of concepts for the second target.
- Reliability requirements are outcome verification, durable admission, no duplicate external side effects, an explicit missed-run policy, and crash recovery that never silently replays work that may already have written.
- Permission and approval decisions survive a restart, and an unattended run never widens its own authority.
- Creation and management stay composer-first and conversational, with the existing Automations screen as the inspection and adjustment surface.
- The model stays interchangeable; a run keeps the provider and model the user approved.
- Existing connectors, memory, skills, and learned procedures are reused; no second connector registry, no second cloud backend, and no second agent framework.

## Current state

### Verified in the shipped service

| Capability | Evidence | Verdict |
|---|---|---|
| Durable definitions and occurrence records | `packages/core/automations/src/domain.ts:38` defines domain `automations` version 1 with `definitions` and `runs` tables | exists |
| One-time, interval, daily, and weekday recurrence with an explicit IANA zone | `domain.ts:13-20`, `recurrence.ts:53-89` | exists |
| Nonexistent DST wall times skipped rather than shifted | `recurrence.ts:152-159` | exists |
| Deterministic occurrence identity | `index.ts:246-248` hashes the definition id with the scheduled instant | exists |
| Durable admission before any agent work | `index.ts:250-262` writes the run record first | exists |
| Overlap skip and misfire grace window | `index.ts:251-258` | exists |
| Restart marks unfinished runs failed instead of replaying them | `index.ts:54-59` | exists |
| Fresh owner-scoped session per run | `index.ts:281-303` | exists |
| Saved preset, model, permission, and workspace replayed into the run | `index.ts:286-303` | exists |
| An unattended run cannot create more work or ask a question | `index.ts:296-297` sets approval `never` and guards `automation_*` and `ask_user` | exists |
| Terminal outcome taken from the turn, not from a claim in the text | `index.ts:308-316` requires a `turn/end` of reason `completed` | exists |
| Account-scoped reading and mutation | `index.ts:105-109`, `index.ts:181-185` | exists |
| Management over the shared connection, plus four agent tools | `index.ts:74-82`, `tools.ts:29-62` | exists |
| Human confirmation for new or expanded unattended work | `index.ts:88-97` | exists |
| Deployment limits supplied by the composing profile | `index.ts:33-45`, `packages/bundle/web-app/cordis.patch.yml:752-759` | exists |

### Deferred, with the evidence that locates the gap

| Deferred concern | Evidence | Phase |
|---|---|---|
| Execution independent of the Host process, and OS supervision | `packages/core/automations/README.md:27`; one Host-owned timer arms the next occurrence (`index.ts:217-244`); nothing starts a Host at login, and closing the application terminates the Host child (`apps/desktop/src/host-process.ts:239-243`) | 7 |
| Hosted execution | `README.md:28` | 8 |
| Event triggers | `README.md:28` | 5 |
| Hybrid local and hosted handoff | `README.md:28` | 8 |
| Notification delivery | `README.md:28` | 4 |
| Durable approval continuation | `README.md:16`, `index.ts:296` | 6 |
| The management surface, and any starter catalogue | `packages/client/ui-automations/src/client/AutomationsPanel.tsx` is a 132-line panel over the four agent tools; nothing presents a next run, and no template catalogue exists | 2 |
| History pruning | `README.md:28`; `index.ts:107` bounds only the response, not the store | 3 |
| Run resolution after a failure | Nothing in `src/` reads, confirms, or links a failed run; the client README defers links into run conversations | 3 |
| Recurrence completeness: no end condition, no yearly form, no hour-bounded hourly form, and no monthly or custom rule | `domain.ts:13-20` maps four trigger kinds, and none of them bounds the series or the hours it runs in; `recurrence.ts` has no monthly, yearly, or custom-rule path | 3 |
| Verification of the shipped service | The [built-in automations note](../../implemented/architecture/2026-10-11-built-in-automations.md) records validation limited to TypeScript and a green build with no tests, and no snapshot under `snapshots/` names automations | 1 |

### Already covered elsewhere, and not to be rebuilt

| Concern | Owning package | What it already provides |
|---|---|---|
| Reminders inside one conversation | `packages/schedule` | Durability folded from the session log, latest-only catch-up, delivery into the live session, and no external channel (`packages/schedule/schedule/README.md:12`) |
| Background work inside a live turn | `packages/jobs` | An owner-fenced job registry behind one contract; the shipped implementation is process-local and jobs die with the process (`packages/jobs/jobs/README.md:12`, `:53`) |
| External event ingress | `packages/webhook` | A registry turning an authenticated delivery into a root session; dispatch is fire-and-forget with no queue, retry, deduplication, or completion state (`packages/webhook/README.md:12`) |
| Approval decisions | `packages/interaction/user-approval` | `approval/policy` is a session-log event, so a policy survives a restart; `never` resolves every ask to rejected before dispatch (`packages/interaction/user-approval/src/index.ts:92-97`, `:275`) |
| Connectors, skills, and their credentials | `packages/host/account-integrations` | Account-owned integrations whose credentials survive restarts, with write approvals granting a session-scoped grant (`packages/host/account-integrations/README.md:11`) |
| One Host per Aeven home | `packages/util/home-paths` | `claimOrAttachHost(home)` takes a kernel file lock on `runtime/host.lock`, advertises the serving URL in `runtime/host.json`, and returns either ownership or an attach result naming the incumbent (`src/host-lease.ts:108`, `:192`, `:211-214`) |
| A Host that is not the user's machine | The [hosted surface note](../../proposed/architecture/2026-09-30-hosted-web-surface-and-sync.md) | Six stages from a TLS front to a per-account Host and execution world |

Two negative findings matter as much as the positive ones. Background jobs are not a substrate for unattended execution: their contract passes callbacks and live `Agent` objects into `JobStart.run()`, which a restart cannot reconstruct. And the webhook runtime is an ingress, not a trigger source: it dispatches a rule and forgets, so an event-triggered automation must carry its own occurrence identity rather than inheriting one from a delivery.

## OSS evaluation

| Implementation | Version and provenance | What to take | Verdict |
|---|---|---|---|
| [titanwings/dsh-automation](https://github.com/titanwings/dsh-automation) | `@dsh-external/dsh-automation` 0.1.7, MIT, commit `0d73a4e` | Run-resolution semantics, the failure-honest session read boundary, and the executor's evidence extraction | Thin adapter; it is the ancestor of the shipped port |
| [GooDAnDReaDY/dsh-cron](https://github.com/GooDAnDReaDY/dsh-cron) | `@goodandready/dsh-cron` 0.3.0, MIT | Notification delivery semantics, and non-LLM execution runtimes as a later executor kind | Do not adopt wholesale; mine the delivery design |
| [syncended/deepseek-harness-automations](https://github.com/syncended/deepseek-harness-automations) | `@syncended/dsh-automations` 0.8.10, MIT | Explicit overlap and misfire policy, atomic claim plus watermark, an executor registry, canonical root checking | Thin adapter; take the admission and policy ideas |

The first repository is the direct ancestor of what shipped: `recurrence.ts:1` names the commit, and `LICENSE:1-3` preserves the upstream copyright line. Its value now is the parts Aeven did not port. Its resolution model treats a failed run as an open question the user closes by confirming the result or by creating a linked retry in a new session, recording `retryOfRunId`, `retryScheduledFor`, and a resolution audit, and forbidding confirmation or retry while the same automation has queued or running work. Its session compatibility work is a warning rather than a technique: a host API change made a completed run record as an executor error, and the fix was a single read boundary that prefers the current snapshot API, keeps the legacy array as a fallback, and fails loudly instead of fabricating an empty event list. The shipped executor already reads `handle.agent.session.snapshotEvents()` at `index.ts:309` and derives completion from the event stream, so what remains is the refusal to invent success when reading fails. Its 1961-line client control centre and its client protocol assume the DSH module-loader contract and are not portable.

The second repository is the broadest of the three and the most tempting to copy. Its per-task channel selection with credentials resolved by reference at send time, per-channel failure isolation so one unreachable endpoint cannot swallow the others, a delivery timeout wrapped around the whole handler, `onlyOnFailure`, and its refusal to overwrite a stored secret when the browser echoes a masked value are the right semantics for notification delivery, and they fit Aeven's existing credential service. Its non-LLM runtimes — shell, Node, Python, HTTP, SSH, Docker — describe a second executor kind that costs no tokens and matches tasks that need no judgement. Everything else it adds is a second product surface: its own REST API, its own settings file, a kanban integration, Prometheus metrics, a TTS channel, a heartbeat endpoint, and automatic retry with backoff. Adopting those would duplicate the Host's connection, settings, and connector services, and its retry default contradicts the rule that work which may have written is never retried automatically.

The third repository is the closest in spirit to Aeven's scheduler and the clearest about policy. It makes overlap and misfire explicit per job (`skip`, `queue`, `allow`; `skip`, `run-once`), admits an occurrence and advances the durable `nextRunAt` watermark in the same atomic state mutation, records a run as `running` before agent work and as `interrupted` after a crash without retrying it, canonicalises job roots with `realpath` against an optional allowed-root list, and structures execution behind a registry so a later workflow or task-graph executor needs no scheduler change. Its state file under the Harness home and its plain-JavaScript client half are not reusable: storage domains own durability here, and the client is a built package with its own design system.

Licensing and attribution. Everything taken must keep the upstream copyright line and record the inspected commit in the module that carries the adapted code, in the form the shipped port already uses. Adapted notification semantics should name its source in the delivery module's header; the policy vocabulary and the watermarked claim should do the same. No copyleft obligation attaches to any of the three.

## Prior art: two shipped implementations

Two products were inspected while this note was written, and are recorded here so the next reader does not re-derive them.

**The Codex desktop app** (`~/Projects/Nodejs/Aeven/resources/chatgtp-new`, app version 26.1007.21159, with its own `ANALYSIS.md`). Its scheduled tasks are server-side rather than local: the task record is `{id, kind: cron|heartbeat, model, reasoning_effort, plugin_template_id, target, notification_policy, auto_archive, cwds, target_thread_id, rrule}`, and the default recurrence is `FREQ=HOURLY;INTERVAL=24;BYMINUTE=0` (`ANALYSIS.md:1184`). The client authors a real recurrence rule: `schedule-fields-*` and `schedule-draft-*` under `extracted/webview/assets` carry modes once, hourly, daily, weekdays, weekly, monthly, and custom, an interval bounded to 1–23, a time of day, weekdays, a month day, an optional end date and time, and a time zone, and serialise them to RFC 5545 `RRULE` with `DTSTART;TZID=` and `UNTIL=`. The serving side declares which forms it supports, and the client filters its editor through the `allowed_frequencies` it reads from `automation_capabilities`. The application schedules nothing itself: it carries no OS service plumbing and no task or automation namespace in its app-server RPC surface. Its agent manages automations through an `automation_update` tool that requests approval, while sibling tools of the same server auto-approve (`ANALYSIS.md:461-464`). Its Scheduled page is the restraint the surface phase copies: a heading, one sentence that teaches the capability, an Active list, and a Recommended strip, with creation in the composer beneath and no next-run time on the card.

**Grok's Automations page** (`https://grok.com/automations`, inspected signed in, October 2026). An Automations tab and a Runs tab, a New Automation dialog, and a gallery of seventeen starter templates across News, Productivity, Finance, Research, and Lifestyle. The definition dialog carries an icon, a name, one trigger, instructions, connector bindings, skill bindings, a model choice with an `Auto` option, and App and Email notification switches; a template opens that same dialog prefilled, and nothing is created until Save. Its trigger catalogue has two groups. Time: once, hourly within chosen hours, daily, weekly, monthly, yearly. Connector events: Gmail and Outlook new email matching filters; twelve GitHub events (pull request opened, draft opened, pushed, merged, comment added, new push to branch, label change, checks completed, issue comment, PR review comment, PR review submitted, review thread, workflow run completed); three Linear events (issue created, status changed, assigned); finance events (new transaction matching filters by absolute amount, subscription purchased, subscription canceled); and a generic webhook trigger. A trigger is a single choice rather than a list: once one is chosen, the Add Trigger affordance is replaced by a removable chip.

## Architecture

The remaining phases extend four seams and add three.

| Concern | Seam | Provider | Consumer |
|---|---|---|---|
| Where a run executes | A definition field resolved when the definition is created, with the local Host as the only provider at first | The local Host, then a hosted Host in phase 8 | The run executor, unchanged in shape |
| What starts a run | A trigger kind on the definition, resolved to a trigger provider | The existing timer for time; each connector's declared events, with the webhook runtime as one provider among them | The admission path |
| Which triggers a target supports | A declared capability on the execution target | The running Host, and later a hosted Host | The management surface and the starter catalogue |
| Admitting one occurrence | The automation service's existing durable claim, unchanged | The storage domain | The scheduler and manual run |
| Executing one occurrence | One fresh root session with saved preset, model, permission, and workspace | Agent presets, model selection, workspace registry | The conversation the user can open |
| Telling the user | A delivery consumer over the account's connectors | The connector the user selected, with credentials resolved at send time | The run record's delivery state |
| Continuing an approval | A durable approval record owned by the run, answered by a restart-surviving answerer | The run domain and the approval service | The run session's approval gate |

Execution target is a property of the definition, not of the runtime, so the local Host and a hosted Host are two providers behind one model and the user's mental model stays "run this on this machine, or on my always-on machine". Ownership is already solved for one machine: one process owns an Aeven home at a time, because the home lease serialises starters and gives the others an attach result, so a daemon Host and an application-started Host cannot both dispatch the same occurrence. A hosted deployment needs the same guarantee expressed against shared storage, and that is the only new coordination fact cloud adds. The cloud provider must otherwise reuse the hosted surface rather than invent a backend: per-account home resolution, per-account credentials, and a per-account execution world are the hosted note's stages 3 to 5, and an automation in the cloud is that Host running the same service against the same schema. An installation identity, so a run can name the Host that admitted it, is the other fact worth fixing now.

Storage stays with the existing storage-domain provider; the definitions and runs tables remain the durable authority, and later phases add fields and at most one new table rather than a new store. The existing domain is at version 1, so each schema change states its version bump and its rejection of older on-disk data. Sessions are unchanged: a run is a root session with a saved preset, and nothing about a hosted run changes that. Approvals move from unconditional refusal to a durable record: a run keeps policy `never` unless the definition carries a pre-authorized scope for a named connector operation, in which case the run's approval gate consults that scope. Notifications are a consumer over account integrations, not a new channel registry, and a run's delivery outcome is recorded on the run itself so a restart does not send twice.

## Phases

Each phase states its outcome, the seams and packages it touches, the evidence that proves it, and its risks. The repository's [testing policy](../../../../docs/testing.md) makes two demands on every model- or product-visible phase: a non-unit REAL-composition test that boots a test-only `cordis.yml` through the Loader (`docs/testing.md:38`), and a keyless recorded-session scenario for anything model- or user-visible (`docs/testing.md:52-54`). `pnpm run test:coverage` additionally requires per-file 100% line coverage on `packages/*/*/src` (`docs/testing.md:10`), so every phase carries test files as part of its own scope.

### Phase 1 — verification baseline

Outcome: the shipped local service is exercised by real tests, so later phases have a regression signal and the current claims stop resting on a green build.

Seams and packages: no new seam. Touches `packages/core/automations/tests`, a test-only `cordis.yml` under the package or the shared test-support family, and one recorded scenario.

Evidence: a REAL-composition boot that creates a definition through the tool surface, drives one admitted occurrence with injected clock samples, and asserts the durable run record and the model-visible request; a keyless recorded-session case for create, list, and run-now; per-file 100% coverage on the package's `src`.

Risks: recurrence is deterministic but scheduling is not, and a timer-driven service resists fixtures. The mitigation is the pattern the repository already uses for time: the production path keeps the platform wall clock and tests supply explicit samples, so no production clock service appears.

### Phase 2 — the Automations surface and starter templates

Outcome: a user can see which automations exist, when each one runs next, and what happened last time, and can start one from a template instead of composing the whole instruction.

Seams and packages: this is a management surface, and creation stays in the composer. `automation_create` already requires human confirmation (`index.ts:88-97`), so the phase adds no second creation path; two creation paths would mean two places where authority is granted. Touches `packages/client/ui-automations` for the list, the next run, the last result, and the Host state, and adds the template catalogue. A card carries an instruction and writes it into the composer through the existing `InputActions` path (`packages/client/ui-conversation/src/client/contract/input.ts`, `setDraft`), and the ordinary confirmation creates the definition. The pattern to follow is the Imagine surface — a catalogue in `packages/client/ui-imagine/src/client/prompts.ts`, a grid in `ImaginePrompts.tsx`, rendered in the `conversation.start` slot while `UiConversation.startPage` is true, writing into the composer through `setDraft` — and that package is not modified here.

Card contents come from Grok rather than Codex: Grok's card shows the next run, Codex's shows only the last run, and the next run is the most useful fact on a scheduled card. The page's restraint comes from Codex's Scheduled page, which carries about 270 characters — a heading, one sentence that teaches the capability, an Active list, and a Recommended strip — with creation in the composer beneath it.

A template cannot be only text. It carries a trigger, connector and skill bindings, a model choice, and notification channels, none of which composer text expresses, so the card carries the instruction and the confirmation settles the rest. Templates are capability-gated: each declares the trigger it requires, and the surface offers only templates whose triggers the running target declares. That is why the gate lands here rather than in the hosted phase, which now references it instead of introducing it. The catalogue is a typed, localised asset in the shape of the Imagine prompts, because client copy is locale-owned and `verify-client-ui-i18n` rejects hardcoded strings. The surface states plainly whether a Host is serving and what that means for a schedule; the reference products omit that because their tasks execute server-side, and a local-first runner cannot. Later, the Recommended strip should be drawn from the user's own history through the Personal Knowledge Model rather than from a fixed catalogue.

Evidence: a REAL-composition test for the surface's management operations; a snapshot for the template catalogue where it is model-visible; a GUI test for the card-to-composer path, matching how the Imagine cards are covered.

Risks: a starter template is a promise. Every Grok template is a daily schedule, and Grok can promise that because its tasks run server-side, while an Aeven automation runs only while a Host is serving and the machine is awake. A template strip landing before the supervised Host sells a run that cannot happen, and a silently missed run costs more trust than a template that never existed. The mitigation is the capability statement on the surface plus the declared-trigger gate, and template content must not imply always-on execution.

### Phase 3 — resolution, recurrence completeness, and retention

Outcome: a failed, interrupted, or skipped run is something the user can inspect, confirm, or deliberately retry; a recurring definition can be given an end condition instead of running forever; and run history is bounded in the store rather than only in the response.

Seams and packages: the automation service's public operations, its RPC dispatch, its agent tools, and the Automations surface. The definitions table gains an optional recurrence end and the runs table gains optional resolution fields, so the domain version changes once for both. Whether the trigger model also takes the monthly and custom-rule forms Codex offers, and the yearly and hour-bounded hourly forms Grok offers, is settled here; declining any of them is a valid outcome, recorded as a decision rather than left as an omission.

Evidence: unit coverage for the pruning rule that never removes queued or running records, and for an end condition whose boundary falls between two occurrences; a REAL-composition case for a linked retry; a snapshot for the added tool result and for the trigger fields the model can set.

Risks: a retry is the one path that can repeat an external effect, so it stays user-initiated, is refused while the automation has active work, and is recorded as a linked run rather than a re-dispatch of the original. Adding fields to a version-1 domain rejects older on-disk data, which the pre-release stance permits but the change must state.

### Phase 4 — notification delivery

Outcome: a finished run reaches the user through a connector they chose, and a run that fails to notify says so instead of pretending it reported.

Seams and packages: a delivery consumer over `packages/host/account-integrations`, the credential service, the automation definition's delivery selection, and the run record's delivery state.

Evidence: unit tests against a stub connector covering per-channel isolation, the delivery timeout, and the masked-secret rule; a REAL-composition test where one channel is unreachable and the other still delivers.

Risks: a second delivery on restart, which the run's own delivery state must prevent; a selected channel whose credential was revoked, which must surface as a delivery failure on the run rather than a silent absence.

### Phase 5 — event triggers

Outcome: an automation can fire on an authenticated external event as well as on time.

Seams and packages: a trigger provider per event source, a trigger kind on the definition, and the existing admission path with an occurrence identity derived from the event rather than from a clock. Each connector declares its own event catalogue with its own filter semantics, and the webhook runtime becomes one trigger provider among them rather than the trigger provider: a centralised webhook cannot express "new email matching your filters" or a dozen distinct GitHub events with author filters, which is why the seam has to be connector-owned. Grok ships exactly that shape, and this note's prior-art section records the catalogue it exposes.

Every trigger provider supplies a stable event identity, so a redelivered event is the same occurrence rather than a second run. That requirement answers the event-identity question this note previously left open.

Evidence: a REAL-composition test dispatching a signed delivery through the webhook provider and a connector event through its own provider, each into an admitted occurrence; a snapshot for the trigger fields the model can set.

Risks: the webhook runtime is fire-and-forget, so duplicate deliveries are its normal behaviour rather than an error, and a connector's event stream may legitimately replay. The provider's event identity is what makes those replays the same occurrence, so a provider that cannot supply one is not ready to be a trigger source.

### Phase 6 — durable approvals

Outcome: a run that needs approval for a named external write can wait for it across a restart without a human being present at the moment it asks.

Seams and packages: the approval service and its answerers, a durable approval record owned by the run, and the definition's pre-authorized scope.

Evidence: a REAL-composition case that stops the process between the ask and the answer and resumes with the grant intact; a recorded scenario showing the run completing after the answer.

Risks: this is the phase that converts a read-only scheduler into something that writes unattended. The safe form is a narrow grant — one connector operation, one account, an expiry — and the default remains refusal for anything not pre-authorized.

### Phase 7 — an OS-supervised Host

Outcome: a scheduled occurrence runs while the desktop application is closed, and the machine's owner can see that it did.

What exists, and what is genuinely missing. The Host is already a separate OS process: the desktop application spawns `@aeven/desktop-host` as a child and carries its API over framed pipes on dedicated descriptors (`apps/desktop/src/host-process.ts:119`, `:132`). Closing the application terminates that child — the quit path sends `SIGTERM` and escalates to `SIGKILL` after two bounded waits (`apps/desktop/src/host-process.ts:239-243`) — and that, not the automation design, is why closing Aeven stops automations. One owner per Aeven home is already enforced: `claimOrAttachHost(home)` takes a kernel file lock on `runtime/host.lock`, publishes `runtime/host.json` with mode 0600 because the advertised URL carries a live launch credential, and returns either ownership or an attach result naming the incumbent (`packages/util/home-paths/src/host-lease.ts:108`, `:192`, `:211-214`). The Host child already serves the attach case: on an attach result it reports `ownsHost: false`, drops both pipes, disconnects, and returns, leaving the incumbent serving (`apps/desktop-host/src/index.ts:517-524`). A Host also boots without Electron today, because the launcher boots named profiles against the same home and the same lease (`apps/cli/src/args.ts:13`).

Seams and packages: no new subsystem, and no second supervisor. This phase adds an OS supervision provider — a macOS LaunchAgent, a Linux systemd user unit, a Windows service or scheduled task — plus a user-visible setting for running Aeven in the background and starting it at login, and the application-side rule that the desktop process attaches to an incumbent Host and spawns one only when it is the first starter. The supervised process runs from a stable install location outside the application bundle, because an update replaces the bundle under a running service; the home-side install area at `<home>/profiles` is the candidate anchor and must be checked before it is relied on.

Evidence: a process-level case where the supervised Host runs, a run is interrupted mid-flight, and the run record shows failure with no replay; an attach case where a second starter joins an incumbent and owns nothing; an OS-level smoke on macOS and Linux proving the unit starts after login and that a second starter never dispatches an occurrence the incumbent already admitted.

Risks: the lease already answers duplicate dispatch, which is why this phase is small; what remains is a unit that must run as the same user to keep the owner-only lease and its credential handling intact, and an update path that must not replace files under a running service. Platform supervision differs per system, so the plan expects one provider per operating system rather than one mechanism pretending to cover all three.

The honest limit of this phase: an OS supervisor fixes "the user closed the window". It does not fix "the machine is asleep or off". Sleep stops timers, and `misfireGraceMinutes` with latest-occurrence catch-up (`index.ts:250-258`) remains the mitigation. A supervised local Host is not always on, and always-on coverage is the hosted runner's job.

### Phase 8 — hosted execution

Outcome: the same automation runs on the user's own machine or on a hosted Host, with the same management surface, and the user's credential and permission scope is the same statement in both places.

Seams and packages: the hosted surface note's stages 3 to 5 for per-account home, credentials, and execution world; the api group's connection and remotes for management; the execution-target field from this note's architecture; and the trigger capabilities each target declares, which phase 2 introduces and this phase honours rather than reinvents.

Evidence: a two-Host test over separate homes showing no cross-account visibility and no double dispatch; a recorded scenario where a definition created locally executes on the hosted target.

Risks: the hosted surface is itself unbuilt, so this phase is gated on work outside automations and should not be started before phase 7 proves the single-owner claim. Hybrid handoff — a hosted run that needs something only the local machine has — is the least defensible part of the design and is deliberately left unplanned here.

## Open questions

- Does a hosted Host run the scheduler, or only execute occurrences the user's own machine admitted? The first needs a lease that survives a Host replacement; the second keeps the user's machine as the authority and makes "always on" mean "the daemon is running".
- Does notification delivery belong to the automation service or to a general run-completion capability that other producers can use? The second is more reusable and more work.
- Is `historyLimit` still the right retention control once pruning is durable, or does retention need a time bound as well as a count?
- Which of the three non-LLM runtimes is worth having, given that a shell command needs no model and no agent session?

## Unverified

- No test, snapshot, or process expectation in the repository exercises the automations service today; every current-state claim above rests on reading code, not on observed behaviour.
- The plugin clones and the DSH checkout were read only. Their behaviour under a real Host was not executed, so claims about their runtime semantics come from their README and design documents.
- The hosted surface note is a proposal, so nothing in phase 8 is verified as buildable today, and the per-account credential work it depends on does not exist.
- Whether the current `automations` domain can gain fields without a migration path was not checked against the storage provider's version handling; the plan assumes a version bump is available and that older data may be rejected, per the repository's pre-release stance.
- No OS service plumbing exists in the tree, and no launchd, systemd, or Windows service file for the Host was found; the OS supervision in phase 7 is designed here, not observed. Whether `<home>/profiles` is the right install anchor for a supervised process was not verified.
- The Grok findings in the prior-art section come from its interface while signed in, not from its source or its API, so they describe what that interface exposes rather than what its service stores. The Codex findings come from an extracted application bundle and the analysis document published with it.

## Alternatives considered

**Reuse `packages/jobs` as the execution substrate.** The job registry is the obvious home for long work, and it already owns ids, ownership, cancellation, and completion notices. It lost because its contract hands callbacks and live `Agent` objects to the producer, so nothing about a job can be reconstructed after a restart, and a durable backend would have to reshape identity, ownership, and observation before it could implement the seam. The automation service already owns durable admission and per-occurrence execution, so adopting the registry would have meant rebuilding that ground rather than building on it.

**Reuse `packages/schedule` for off-line delivery.** Schedule is durable, folds from the session log, and already handles missed intervals correctly. It lost on its stated scope: delivery is session-local, and a cold session receives nothing, which is precisely the case automations exist to cover. Its reminder framing also assumes a live owner, and its recurrence stops at fixed intervals rather than calendar rules.

**Adopt `dsh-cron` wholesale.** It is the most complete of the three by a wide margin. It lost because its completeness is a second product: its own REST API, settings file, channel registry, metrics, kanban, and voice channels would duplicate the Host's connection, settings, and connector services, and its automatic retry contradicts the rule that work which may have written is never replayed. Its notification semantics are worth taking; its architecture is not.

**Build a dedicated automation daemon as a separate product.** A process that owns its own schedule, store, and API would remove the Host dependency in one step. It lost because the Host is already a separate process with a home lease, an attach path, and a profile-booting launcher, so the missing piece is supervision rather than architecture; a second daemon would add a second owner competing for the same home and duplicate the Host and storage lifecycle the repository has already paid for.

**Ship hosted execution first, local supervision later.** Cloud is where "always on" is easiest to promise, since the machine need not be awake. It lost on dependency and risk: the hosted surface is a proposal with six stages, its per-account credential work does not exist, and it widens the trust request before the credential and permission statement for unattended work has been settled locally.

**Keep fail-closed approvals and never support unattended external writes.** This is the shipped behaviour and it is safe. It lost as a permanent answer because it excludes the recurring work users actually want to schedule; it survives as the default, with narrow pre-authorized scopes as the only way to write unattended.

## Acceptance criteria

- The Automations surface lists each definition with its next run and its last result, states whether a Host is serving, offers only templates whose triggers the serving target declares, and adds no second path for creating a definition.
- A definition created conversationally executes on schedule with the desktop application closed, and the run record shows which Host admitted it.
- A run whose external write needs approval either completes under a pre-authorized scope recorded on the definition, or stops and reports that it could not, across a restart in between.
- A finished run reaches the user through a connector they selected, exactly once per run record, and a delivery failure is visible on the run.
- A user can confirm or retry a failed run from the interface, and a retry never runs while the same automation has active work.
- The same definition, created once, can be pointed at the local Host or a hosted Host without a second set of concepts, and a hosted run never reads another account's data or credentials.
- Two processes over one Aeven home never dispatch the same occurrence twice: the second starter attaches to the serving Host instead of becoming a scheduler.
- Retention bounds the stored run history while queued and running records are always kept.
- No phase alters the rule that an unattended run inherits no source conversation, no past approval grant, and no authority beyond its saved permission selection.

## Risks

The largest technical risk is duplicate external effects. Exactly-once is not achievable across a crash and a network boundary, so the plan's answer is at-most-once dispatch with a deterministic occurrence identity, user-initiated retries, and a requirement that scheduled tasks carry their own idempotency where the target system allows it. A run that crashes after writing may still have written; the record must say so rather than claim success or failure.

The largest product risk is that approval continuation converts a safe feature into one that writes unattended under a scope the user set and then forgot. Naming one connector operation, bounding it in time, and showing it in the Automations screen before it is used is the mitigation, and the default stays refusal.

Hosted execution widens the trust statement considerably: the same service that today reads the user's files in their own process would run with an account's connectors and credentials inside someone else's machine. That risk is accepted only because the hosted surface note already plans per-account homes, credentials, and execution worlds, and this note refuses to invent a second backend for it.

Supervised execution trades one failure for another. Duplicate dispatch is already answered by the home lease, but a service that keeps running after the user believes it stopped is a new expectation to manage: a login-started Host outlives the window the user closed, so the setting that starts it, the credential it holds, and the way it stops belong in the product and not only in an operating-system file.

Every phase is larger than it appears, because each one owes a REAL-composition test, a recorded scenario where it is model- or user-visible, and per-file coverage. Planning should assume that the evidence obligations are a third of the work.

Finally, this note gives up something worth naming. It keeps automations behind the existing service and the existing abstractions, which means the phases land slower than a greenfield scheduler would and the service keeps a shape that was chosen when it was local-only. That cost is accepted in exchange for never having two schedulers, two stores, or two account models in the product.
