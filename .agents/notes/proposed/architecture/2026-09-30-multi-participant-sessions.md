# Agent Note: Multi-participant sessions

Status: proposed

English | [中文](2026-09-30-multi-participant-sessions.zh.md)

## Problem

Per-account isolation made a signed-in account the unit of ownership: a Session header carries one `owner` account id (`packages/core/session/src/types.ts:136`), set from the caller that created it (`packages/api/session-controller/src/agent.ts:549-556`), and reachability is strict equality through `IdentityUsers.mayAccess(owner, caller)` (`packages/identity/user/src/index.ts:121-124`). [Per-account isolation](../../implemented/architecture/2026-09-30-per-account-isolation-on-a-shared-host.md) chose that on purpose, including its sharp edge: state recording no owner is reachable by no signed-in caller, and another account's session answers exactly as absent state does, so a caller cannot probe which identities exist.

That model answers "whose is this?" and cannot answer "who else may join?". There is no membership, participant, role, or sharing field on `SessionHeader` (`types.ts:99-137`) or on `CreateSessionOptions.meta` (`types.ts:156-165`), no operation that adds a caller to an existing session, and no way for the transcript to say which human said what. Whether one assistant can hold a conversation with several people is therefore not a feature gap that can be filled in the client; it is a question the durable model currently has no room for. The hosted case is a separate question with its own note, [serving the Web surface remotely](2026-09-30-hosted-web-surface-and-sync.md).

## What the session model provides today

| Concern | State | Where |
|---|---|---|
| Ownership | One account id on the header, written once, inherited by forks and subagent children | `packages/core/session/src/types.ts:136`, `packages/core/session/src/index.ts:1189` |
| Reachability | One binary predicate, `owner === caller.id`, applied at roughly two dozen sites | `packages/identity/user/src/index.ts:121`, `packages/api/session-controller/src/agent.ts:212-220` |
| Authorship | Not durable: a user message's source is `{ kind: 'user' }` plus an RPC correlation id and client time zone | `packages/llm/llm/src/message.ts:103`, `packages/api/session-controller/src/types.ts:444-449` |
| Turn driving | One Agent per `SessionId`, queueing through an Inbox, with `edit` cancelling the live turn and rewinding for whoever calls it | `packages/core/agent/src/index.ts:252`, `packages/api/session-controller/src/commands.ts:427-455` |
| Live delivery | Already audience-based: every event and scoped waterfall goes to each client whose user may reach the audience, and the first result settles it | `packages/api/gateway/src/index.ts:483-486`, `:562-621` |

## What a shared thread requires

- **Membership as durable state**, with roles rather than one boolean: read, submit, approve, administer. The predicate that replaces `mayAccess` must stay fail-closed, so an empty or missing membership joins nobody.
- **Attribution in the log.** A message from a person must be durably attributable, which means a new or extended session event, because anything model-visible must be reconstructable from the log, and the model-visible `user/message` currently carries no actor.
- **Turn arbitration.** Two people prompting one session need an order, a rule for interrupting a running turn, and a decision on who may rewrite history through `edit`.
- **An approval policy.** The transport already delivers one request to several clients and lets the first answer win; what is missing is who is allowed to answer, whether one participant's approval suffices, and a durable record of who approved.
- **A rule for per-user state.** The model credential is resolved from the session owner (`packages/llm/llm-aeven/src/index.ts:420-425`), memory and learned capabilities are keyed per account, so a shared turn must state whose memory it reads and whose account it bills.
- **Client work.** A participant roster, per-message authorship in the transcript, invitation and removal, presence, notification routing for approvals, and locale-owned copy for all of it.

## Proposal

**P0 — decide the product questions first.** Who may be invited, who may approve, whose account pays, and whether a participant sees tool output produced on the owner's machine. A shared transcript exposes file contents and command output, so this decision precedes any code.

**P1 — membership and a scoped authorization decision.** Add a durable membership record for a session (owner plus participants with roles), and replace the binary predicate with a scoped one at the single chokepoint `ApiSessionAgentController.resolve` (`agent.ts:212-220`) plus the sites that read ownership directly. Keep the current fail-closed rule for state that records no owner.

**P2 — durable authorship.** Extend the session vocabulary so a human message names its author, on both the submission path (`packages/api/session-controller/src/commands.ts:67-78`) and the loop's append of `user/message` (`packages/core/agent-loop/src/agent.ts:292`), and decide whether the model sees authorship as a prompt input.

**P3 — arbitration and approvals.** Define queue order across participants, who may interrupt, and whether `edit` is owner-only; then implement the approval policy on top of the existing first-answer-settles delivery, with an audit append naming the answering account.

**P4 — clients.** Participant roster, per-message attribution, invite and remove, presence, and approval notification routing, with copy routed through the locale dictionaries.

**P5 — revisit what the isolation note left shared.** State whether shared sessions change the per-account billing and memory keys, or whether the owner's account keeps paying and providing memory for every turn in a shared session.

## Acceptance criteria

- Two signed-in accounts reach one session, and a third account that is not a member gets the same answer as for a session that does not exist.
- The durable log answers who authored each human message, and a replayed or exported session preserves that attribution.
- A second prompt arriving during a turn follows the stated order rather than racing; a non-permitted `edit` is refused by the executor, not by the UI.
- An approval reaches the participants the policy names, and the audit record names the account that answered.
- Removing a participant takes effect for reads, submissions, and approvals without restarting the Host.
- Snapshot and end-to-end coverage exists for a two-account transcript, including the isolation case.

## Risks

- **A shared transcript is a data-exfiltration surface.** Tool results carry file contents, command output, and paths from the owner's machine, so membership without a visibility decision leaks the host's state to every participant.
- **Authorship is a format change.** The log's members are required-on-read by default, so a new event type or a new required field is a durable-format decision, and an older build must refuse the log rather than misread it.
- **Arbitration is easy to get subtly wrong.** The existing single-writer rule has no cross-process enforcement, so two clients already race through the same Inbox; adding a second account multiplies the cases without adding a mechanism.
- **Billing and memory become ambiguous.** Whoever owns the session supplies the model credential and the memory keys today, which is surprising rather than wrong in a shared thread and must be stated where the session is created.
- **The client is not a boundary.** Every rule above must be enforced in the Host's executor, since the browser can be modified by any participant.
- **What this gives up:** the single-owner rule is one line of code with no ambiguity, and every replacement predicate is a place where reachability can regress. The isolation work's clean property — another account's state answers as absent — survives only if membership is explicit and non-empty.

## Alternatives considered

**Share one account among several people.** Give every participant the same Aeven credentials, which needs no code at all. Rejected because the model's answers describe the arrangement: no attribution in the transcript, one wallet paying for everyone, and revocation that costs every participant at once. It also makes an audit of who approved a destructive tool call impossible.

**Shared workspace, separate session per person.** Let each person keep their own session and add a shared place to see the others. Rejected as the default, because the requested outcome is one conversation with one assistant, and the assistant's context is the session: separate sessions would give each participant a different conversation and duplicate work. Worth keeping as the cheaper first step if arbitration and approval policy prove more expensive than expected.

**Membership on the session header.** Put the participant list beside `owner` on `SessionHeader` instead of in a separate record. Rejected for the durable format: the header is the versioned physical first record of every log (`packages/session/session-persistence-jsonl/src/format.ts:52-105`), while membership changes at runtime and has its own lifecycle. Keeping membership out of that record keeps the format decision separate from the sharing decision.

**Let the assistant arbitrate.** Accept prompts from everyone and let the model decide whose turn it is. Rejected because it puts a security and ordering decision in the model's hands, where it is neither auditable nor enforceable, and because the loop's single-writer queue already needs a Host-owned answer before the model is called.
