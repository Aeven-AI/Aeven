# Agent Note: Per-account isolation on a shared Host

Status: implemented

English | [中文](2026-09-30-per-account-isolation-on-a-shared-host.zh.md)

## Problem

One Host serves every client of one Aeven home: the browser on `avn web` and the desktop shell, which adopts a Host already serving its home instead of starting a second writer. Those clients may be signed in to different Aeven accounts, and the Host kept per-person state in Host-wide slots. The caller's Aeven access token lived in one in-memory slot per credential reference, so whichever client spoke last supplied the bearer for every model request, and one account's turns ran on another account's credit. Sessions recorded an `owner`, but no listing, read, stream, or command checked it, so every signed-in client listed, opened, followed, and drove every other account's Sessions and saw their live activity. Workspaces, the Session control stream, forwarded Host events, background jobs, subagents, terminals, devices, dynamic Cordis plugins, Session references, and the MemOS Viewer exposed the same state across accounts.

## Decision

Per-person state belongs to the signed-in account that owns it. One rule decides reachability everywhere: `IdentityUsers.mayAccess(owner, caller)` in `@aeven/identity-user`. With no identity authority mounted every caller may, so a single-user harness is unchanged. With one mounted, only the owner may, and state that records no owner is reachable by no signed-in caller. Another account's state answers exactly as absent state does (`session/not-found`, `workspace/not-found`, an empty list), so a caller cannot probe which identities exist.

### Caller identity on every transport

HTTP requests already ran inside `runAsCaller`. WebSocket streams did not: frames arrive outside any request, so `actingUser()` was undefined inside `follow`, `control`, and terminal streams. `RemoteStreamMuxServer` now runs each stream's dispatch through `IdentityUsers.runAs(user, work)` with the user its upgrade authenticated. Streams that filter per caller capture the caller when they open.

### Model credentials

`CredentialProvider.setSession(ref, user, value)` keys session credentials by account, and `resolve(ref, user?)` and `describe(ref, user?)` see only that account's session value; a call that names no user never sees one. The connection publishes each admitted bearer under the caller's user id. `llm-aeven` resolves the bearer for the owner of the request's Session (`GenerateOptions.sessionId`), falling back to the acting caller, which `DeepSeekAdapterOptions.resolveApiKey(connection, request)` now receives. The Models page describes the Aeven route for the asking account only.

### Sessions

`ApiSessionAgentController` checks ownership in its single resolver, before resuming a cold Session and again on the resolved Agent, which covers every Session command and the Typert `agent`, `session`, and agent-context lookups every other controller's `agent: Agent` parameter goes through. List, search, history `page` and `follow`, fork, attachment and file reads, queue edits, cancel, `inspect`, the skill catalog, and explicit-id adoption on `create` check the same header. The control stream delivers queue, jobs, and projection frames only to streams whose caller owns the Session.

### Workspaces

A workspace record carries `owner`, set to the account that registered it; the built-in workspace belongs to the product and every account sees it. Identity by path is `(owner, path)`: another account registering the same directory gets a workspace of its own, and a Session joins by cwd only a workspace of its own account. A record written before workspaces carried an owner answers with the one account all its Sessions belong to, so existing workspaces keep their owner without a data migration. The workspace list, feed, and every mutation reach only the caller's workspaces and list only the caller's Sessions inside them, including in the built-in workspace.

### Forwarded Host events

Every notification the API forwards to clients is classified in `packages/api/remotes`: an event about one Session (`api-session/*`, `agent-preset/selected`, `cordis/request-run`, `cordis/inspect-query`, `cordis/dynamic-package`, `cordis/dynamic-retract`) carries a `RemoteEventAudience` with that Session's owner, remembered after the Session leaves memory, and a Host-wide one carries none. The Gateway delivers an audience event only to clients whose user may reach that owner, and delivers each scoped waterfall (approval, user questions, location, browser automation) only to clients of the Agent's Session owner. `cordis/dynamic-package` and `cordis/dynamic-retract` name their Session through `agentId` for this.

### Other Session-scoped surfaces

Jobs (list, follow, kill, dismiss), subagents (list, prompt, interrupt), terminals (list, retain), devices (open, close, and the Sessions in the device state), message feedback, dynamic Cordis plugins (inventory, invoke, request resolution), and Session references (candidates and referenced reads, limited to the target Session's account) check the owner of the Session they name. Each account's memory is its own MemOS database under `accounts/<account>/memory` ([per-account memory databases](2026-10-07-per-account-memory-databases.md)), reached through the memory manager, which was already keyed by owner; the MemOS Viewer, which served every account's memory without sign-in, is gone.

### Shared by design

The machine and the Host's configuration stay shared: files on disk (`/api/file`, workspace files, the directory picker), `settings.yaml`, stored provider API keys, agent presets, plugins, speech selection, and the device list. They describe the installation, not a person, and every signed-in account on the Host reads and changes them.

## Alternatives considered

**One Host per account.** A second Host on one home is a second writer to Session logs and workspace documents with no cross-process lock, so the two overwrite each other. Separate homes per account would isolate state but give the same person on two devices two histories, and the desktop shell would stop sharing the browser's workspaces, which is the behavior users expect.

**Keep the desktop shell on a private development home.** Tried and reverted: it hid the leak instead of fixing it, and any second account reaching the same Host still saw everything.

**Filter only in the clients.** Clients cannot be trusted to drop data they received; enforcement belongs where the Host answers.

**Migrate existing workspace records by writing an owner.** It rewrites user data and needs the Host stopped; deriving the owner of an ownerless record from its Sessions leaves the files untouched and gives the same answer.

**Make ownerless state visible to everyone.** Sessions created before sign-in or by a webhook record no owner; showing them to every account would reopen the leak for exactly the state nobody can claim.

## Consequences

Two accounts can share one Host and one home, each seeing only its own Sessions, workspaces, prompts, and live activity, and each paying for its own model use. The same account in the browser and the desktop shell sees the same data. Sessions that record no owner are invisible to every signed-in account; a Session created before sign-in stays on disk but no longer lists. An ownerless workspace whose Sessions belong to several accounts is invisible until someone registers the directory again. A background job that no Session owns is still listed to every account's Sessions, and Host configuration remains writable by every signed-in account; both are deliberate until the product separates installation settings from personal ones.
