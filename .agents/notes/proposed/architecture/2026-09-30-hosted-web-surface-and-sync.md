# Agent Note: Serve the Web surface from a remote Host and sync it with a local home

Status: proposed

English | [中文](2026-09-30-hosted-web-surface-and-sync.zh.md)

## Problem

`avn --profile web` is the only long-lived listening surface Aeven ships: the shipped profiles are base + web-app, base + headless, base + sdk-app, base + acp-app, and the standalone sdk-minimal (`packages/boot/app-boot/src/profile.ts:136-158`), the SDK and ACP surfaces are stdio-only, and the desktop shell "opens no listening port" (`apps/desktop/README.md:3`). That surface binds loopback only and refuses anything else deliberately: `--host 0.0.0.0` exits with "intentionally not supported yet for safety: it would expose remote code execution to the network" (`packages/bundle/web-app/src/startup.ts:74-76`), the webserver's host type is the closed union `'127.0.0.1' | '0.0.0.0'` (`packages/host/webserver/src/index.ts:64`), and the subsystem page states the posture: "The carrier itself owns no TLS, authentication, or Origin policy, so a non-loopback bind exposes the server unless the composition supplies those controls" (`docs/subsystems/web-server.md:47`).

The Web bundle is nevertheless composed for a signed-in public page. It mounts `@aeven/identity-user` and `@aeven/identity-user-aeven` (`packages/bundle/web-app/cordis.patch.yml:116-145`), defaults provider sign-in to `oauthFlow: redirect` with `webUrl` and `mediaUrl` configured, and once an authority is mounted the per-process launch token is bypassed rather than extended: `requestRejection` answers 403 for an untrusted Host, then either resolves the identity authority or checks the launch token, and `authorizeIndex` serves the index to anyone while `authenticatedUrl` returns the clean URL (`packages/client/connection/src/rpc-host.ts:138-144`, `:224-240`). The caller's own bearer is republished per request so the model route bills the signed-in account (`rpc-host.ts:171-190`).

So the request this note answers is: run that page where the user is not, keep one Aeven account's work reachable from a browser and a desktop shell, and let the history they already have locally reach the remote side. Sharing one session between several people is a separate question with its own note, [multi-participant sessions](2026-09-30-multi-participant-sessions.md). Today no supported path exists for any part of that, and the parts that do exist are designed for one operator on one machine.

## What the shipped surface already provides

| Concern | State | Where |
|---|---|---|
| Browser client | Served SPA, Typert Remote over `/api/remote.mux`, reconnect with backoff, ping heartbeat | `packages/api/gateway/src/stream-protocol.ts:5`, `packages/api/gateway/src/client/stream-client.ts:304-310` |
| Sign-in | Aeven access bearer and refresh cookie verified locally against the API's signing secrets | `packages/identity/user-aeven/src/index.ts:217,229` |
| Reachability | `IdentityUsers.mayAccess(owner, caller)` fences sessions, workspaces, jobs, terminals, devices, Cordis plugins, forwarded events | `packages/identity/user/src/index.ts:121`, `packages/api/gateway/src/index.ts:483-486` |
| Session storage | Backend-neutral service with four pinned invariants: append-only, contiguous `seq`, lossless JSON, `append` resolving only after durability | `packages/session/session-persistence/src/index.ts:122-305`, `packages/session/session-persistence/README.md:72-75` |
| Execution world | A seam designed to move fs and subprocess together, with adapters written and no composition mounting them | `packages/e2b/README.md`, `docs/architecture.md:115` |
| Browser request trust | Host/Origin fence accepting loopback plus declared `trustedHosts`, cross-site fetches refused, `X-Forwarded-Proto` honoured | `packages/client/connection/src/api-request-trust.ts:91-117`, `packages/host/webserver/src/origin.ts:45-55` |

## What is missing

- **A supported bind.** Loopback is the only serving posture; the printed URL is composed as `http://127.0.0.1:<port>` for display, for `AVN_WEB_URL`, and for the surface prompt (`packages/bundle/web-app/src/index.ts:173-177`).
- **TLS, and any story for a split origin.** No `createSecureServer` or `node:https` in the serving stack, no CORS anywhere outside a third party's consent page, so a hosted deployment must terminate TLS at a reverse proxy and serve the page same-origin with the Host.
- **A cookie fit for a public origin.** The browser-session cookie is host-only, `HttpOnly`, `SameSite=Strict`, authority-bound, and deliberately omits `Secure` because the shipped server is loopback HTTP (`packages/client/connection/src/browser-auth.ts:106-122`); [browser token authentication](../../implemented/architecture/2026-08-24-browser-token-authentication.md) owns that exchange, and this note proposes only the deployment options it would need.
- **Per-account secrets.** The two Aeven signing secrets are read from `process.env` for the whole process, and one Host's stored provider keys serve every signed-in account; [per-account isolation](../../implemented/architecture/2026-09-30-per-account-isolation-on-a-shared-host.md) lists stored provider API keys among the state that deliberately stays shared.
- **State that can move.** Session logs, domain KV documents, settings, credentials, memory, learned capabilities, the Chrome profile, and the host lease all live under `$AVN_HOME`; spill defaults to a per-process temp root (`packages/spill/spill-local/src/store.ts:37`), jobs are process memory (`packages/jobs/README.md:12`), and the full-text index is `:memory:` in the shipped base row (`packages/bundle/base/cordis.patch.yml:126-130`).
- **An execution boundary worth the name.** The sandbox seam confines writes only and says so: reads pass through untouched in every mode (`packages/fs/fs-sandbox/src/index.ts:8`), the vocabulary covers file effects with "network and process visibility outside this vocabulary" (`packages/sandbox/sandbox/src/index.ts:26-29`), `workspace-write` grants the server's `/tmp` and `os.tmpdir()` (`packages/sandbox/sandbox/src/roots.ts:52-55`), every model shell call is handed the shared `AVN_HOME` (`packages/shell/shell-env/src/index.ts:101,154`), one E2B sandbox is created per harness process rather than per session (`packages/e2b/e2b/src/index.ts:106`), and one Chrome profile on port 9333 is shared by every session (`packages/web/browser-chromium/src/index.ts:97`, `packages/bundle/web-app/cordis.patch.yml:248-253`). The repository states the gap itself: "A container-class backend would provide a hard multi-tenant boundary for both code and shell execution" (`packages/code-runtime/code-runtime/README.md:142`).
- **An approver.** Approval falls through to `unavailable` with no answerer composed (`packages/interaction/user-approval/src/index.ts:55,274-282`); the only production answerers are the browser client and the ACP bridge (`packages/client/ui-approval/src/client/index.ts:1`, `packages/acp/acp/src/index.ts:155`), so a headless Host cannot run a tool that asks.
- **A way to move history.** Export exists as a client-side ZIP of the log and nothing imports it (`packages/client/ui-conversation/src/client/export-session.ts:14-52`); the backend README pins "One live writer per session" (`packages/session/session-persistence-jsonl/README.md:149`), and no advisory lock exists in that provider — appends are plain `open(path, 'a')` (`src/index.ts:801-804`) while only materialization is collision-safe through `link()` and `EEXIST` (`src/index.ts:686-705`).
- **A backend for the cloud.** `PersistenceRevision` is a filesystem stat identity, `dev:ino:size:mtimeNs:ctimeNs` (`packages/session/session-persistence-jsonl/src/index.ts:142-159`), and `locate()` answers an absolute path that `AVN_SESSION_JSONL`, the session-log download, and raw-artifact reads treat as the transcript path, so a database provider re-implements the JSONL provider's durability story rather than supplying a connection string.
- **Any deployment plumbing.** The repository runs no GitHub Actions (`docs/development.md:123`), `.gitlab-ci.yml` is gated on a `python-v*` tag and publishes Python wheels only, and the one container file builds a desktop packaging host (`apps/desktop/linux-builder.Dockerfile`).

## Proposal

Six stages, each usable on its own. Stage 1 is the whole of "reach my Aeven from a browser"; later stages exist so the first one does not have to pretend to be a product.

**Stage 1 — serve the surface off loopback behind TLS.** Widen the serving posture: a proxy-trust mode in `packages/host/webserver` (or a public hostname in the host union), an overlay row stating the public authority in `trustedHosts`, a `Secure` cookie option in `packages/client/connection/src/browser-auth.ts`, a configured public URL instead of the hardcoded loopback one in `packages/bundle/web-app/src/index.ts`, and the `--host 0.0.0.0` refusal replaced by an explicit deployment statement. Accept the consequence in writing: the browser session reaches an agent with the operator's filesystem and network.

**Stage 2 — answer the two gating questions.** Who answers approvals (the browser client, or a policy that never asks), and whether argv is wrapped by the local `ctx.sandbox` or by the execution world's own provider. Both are cheap decisions that every later stage depends on; leaving them implicit is what produces a Host that runs nothing.

**Stage 3 — per-account credentials.** Replace the process-wide environment secrets with a per-account source so one Host's stored keys stop serving every signed-in account, and give revocation a mechanism stronger than local JWT verification inside the access-token lifetime.

**Stage 4 — move what is portable, then history.** Sync settings, learned capabilities, and memory first, keeping per-machine histories separate; then add session import so the existing export becomes a round trip, and only then consider a replication service. A hosted backend for `ctx.sessionPersistence` may be built at this stage, but it must invent the revision token and synthesize crash-closing events, not just store bytes.

**Stage 5 — a Host per account, with a real boundary.** Provision one home and one execution world per account: per-account home resolution in `packages/util/home-paths`, per-session sandbox lifetime in the E2B family, `processPathFromHostPath` for remote file reads, separate temp roots, per-tenant browser profiles, and quotas. This stage is the multi-tenant product; Stage 1 is not.

**Stage 6 — deployment plumbing.** A runtime image, a hosting manifest, and a documented service posture, none of which exist today.

## Acceptance criteria

- Stage 1: a browser not on the operator's machine signs in with an Aeven account over HTTPS and completes a turn, with the settings UI persisting to the Host rather than degrading to memory (`packages/client/ui-settings/src/client/index.ts:72`).
- Stage 1: the Host refuses a request whose Host or Origin is neither loopback nor declared, authenticated or not.
- Stage 2: a turn that needs approval either reaches an answerer or is refused by a stated policy, and a Bash call executes in the world the deployment declared.
- Stage 3: two accounts signed into one Host present distinct model credentials, and removing one account's credential stops its turns without restarting the Host.
- Stage 4: a session exported from one host imports on another and resumes with contiguous `seq`; a second writer to a live session is refused rather than interleaved.
- Stage 5: two accounts on one Host cannot read each other's home, temp files, browser profile, or prior sessions, and each account's commands run in its own execution world.
- Stage 6: one command builds and one document describes running the Host as a service.

## Risks

- **The first stage is a remote code execution surface.** Loopback-only is a safety property, not an oversight; exposing it without per-tenant isolation means one credential is the whole machine. The stage exists because the alternative — waiting for full tenancy — ships nothing, and the mitigation is a written single-operator statement plus the Stage 2 decisions.
- **Read confinement is mistaken for isolation.** Every mode permits reading, and `AVN_HOME` is exported into model shells, so a "read-only" deployment still exposes every other account's state on that Host. Anyone reading the mode names will assume otherwise.
- **Sync invites two writers.** With no advisory lock and a stat-tuple revision, a local and a remote Host on one home interleave appends; the failure is silent data loss in a log the product treats as the transcript.
- **A database backend is underestimated.** The seam blesses third-party providers, but a provider owes the revision token, the crash-closing events, and a transcript path, which is a re-implementation rather than an integration.
- **The seams designed for this are unwired.** E2B, `DeviceHost`, and `storage-sqlite` all ship without a composition, so each looks cheaper in a plan than it is in a branch.
- **What the change gives up:** loopback-only remains the honest default for a single machine, and any hosted mode has to be opt-in with a deployment that states who its users are.

## Alternatives considered

**Per-account cloud Hosts first.** Build the tenancy product before the single-operator one, on the grounds that Stage 1 is throwaway. Rejected because Stage 1 is not throwaway: it produces the TLS, trust, cookie, and configured-URL work every hosted shape needs, it is validated in days instead of months, and it retires the risk that the multi-tenant design is wrong before anything runs.

**A relay or tunnel instead of widening the bind.** Keep the Host loopback-only and reach it through a reverse tunnel, which needs no change to the serving stack and inherits the machine's own authorization. Rejected as the shipped answer, not as a technique: it leaves the operator to run and secure the tunnel, gives the Host no configured public authority, and still hits the statistics the desktop shell relies on — the attach lease is a local file and the advertised URL is loopback (`packages/util/home-paths/src/host-lease.ts`), so no client can be told where the relay is. Worth documenting as the interim path for one operator.

**Log replication as the sync mechanism.** Stream session events between hosts, since the log is append-only and `seq`-ordered. Rejected for now: compaction and rewind produce surface-replacing events, the single-live-writer rule has no cross-process enforcement to build on, and the failure mode is a corrupted transcript. Session handoff delivers most of the value at a fraction of the risk; replication can supersede this note later.

**A split-origin web client.** Serve the SPA from one origin and the Host API from another so a hosted Host could serve several front ends. Rejected because the upgrade carries no header and authenticates by cookie alone, and the bundle states the constraint: AVN must be served from the same site as the API. Adding CORS and a token-based upgrade path is a larger change than hosting itself.

**Treat the existing local sandbox as the tenancy boundary.** Reuse `sandbox-local` for per-account confinement, since it already confines subprocess argv. Rejected on the code: the seam is same-world by contract, reads are unrestricted, both temp roots are shared, and on macOS the profile is `(allow default)` with `deny file-write*` selected without a probe (`packages/sandbox/sandbox-local/src/profiles.ts:52`, `src/index.ts:151-157`). It confines a cooperating agent's writes; it does not separate tenants.

**A database session backend now.** Replace the JSONL provider early so the hosted Host stores sessions in Postgres or object storage. Rejected as the first step: the shipped `storage-sqlite` backend is unmounted and untried, the JSONL provider's revision and crash-recovery behavior has to be reproduced first, and nothing in Stage 1 requires a backend change at all.
