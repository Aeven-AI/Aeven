# Agent Note: Absorb the coding-subscription plugin as an experimental package

Status: implemented

English | [中文](2026-09-09-subscription-auth-into-the-harness.zh.md)

## Problem

Coding-subscription OAuth for Grok Build, ChatGPT Codex, and Claude Code lived in a separate repository and reached the harness only as a profile bundle resolved by a filesystem link. Nothing in this repository named it, so its packaging was verified by its own gates rather than these.

That separation cost more than it bought. The plugin pinned an exact 19-package `@aeven/*` bill of materials and re-verified it on every build, because a harness release could move underneath it. Every harness version bump therefore required a lockstep release there, and a drift between the two was only detectable through that hand-maintained manifest. The plugin also filled harness seams — `ctx.media` image and video providers, an LLM adapter, a Settings section — while being unable to use workspace resolution to reach them.

Two defects followed directly from the split. The plugin's committed `lib/` is the artifact `dsh web` loads, and it had fallen behind `src/` without any gate noticing. Its release verifier asserted a client-bundle marker for a settings flag the product had already retired, so the build refused the very change that removed it.

## Decision

The plugin lands as `packages/experimental/subscription-auth`, npm name `@aeven/experimental-subscription-auth`, `private: true`. It is a single package for now, and is expected to split along its product roles — OAuth sessions, LLM adapter, media providers, tools, client UI — before promotion out of `experimental/`.

It keeps its `dsh.bundle` and `dsh.client` manifest declarations, because those are how a profile discovers a bundle and its browser half. It keeps `dsh-coding-oauth-core` as an exact external dependency: that package owns the route and path identifiers this one implements, and pinning it is what the ABI gate checks.

The move is a copy, not a fork. The standalone repository is retired rather than maintained in parallel; a second live copy would reintroduce exactly the drift this note removes.

### What the harness required that the standalone repository did not

The package compiles under two faces. `src/client/**` is a browser program and everything else is a Host program, so it carries `tsconfig.host.json` and `tsconfig.client.json` leaves plus a solution-only root, registered in the matching aggregates. Tests follow the same split: a spec that reaches into `src/client/**` is named `*.client.spec.ts`, which is how the root aggregates route it to the client program. A cross-face spec is split rather than named for one side.

Three repository gates rejected the package as it arrived, and each was resolved by conforming rather than by exemption. `src/bin.ts` was deleted: only `dsh` profiles launch applications, and a package bin is forbidden. The three DNS-pinning `undici` agents in the Imagine SSRF guard carry the `proxy-exempt:` marker the dispatcher gate defines for a call site that owns per-request transport state. The generated tsconfig alias is hand-written, because the package name does not match its directory.

### Behaviour settled during the move

Media generation is not a deployment choice. Image generation, image edits, and video are fixed on with their limits at the provider maximum, spread in after the user patch so no stored document can turn them down, and removed from the schema and the Settings page entirely.

Tool advertisement is gated on credential readiness rather than on a setting. A tool whose backend holds no usable credential is withdrawn, not offered and failed — a refusal the model can only discover by spending a turn. Readiness is a cached view refreshed on sign-in, sign-out, and credential change, published through the existing `CapabilityRuntimeState.refresh()`.

Quota reporting is one projection over three unrelated vendor payloads: remaining percent per window and epoch-second resets, whatever each vendor reports. A refusal is cached far longer than a reading, because only a sign-in change can alter it. A signed-in provider card discloses that reading from its header, as a Plugins card discloses its settings.

The OAuth adapter registers the route list this package owns — `grok-build`, `codex-oauth`, `claude-code-oauth` — rather than core's `CODING_OAUTH_ROUTES`, which also names `kimi-code-oauth`. `llm.registerAdapter` validates the whole set before committing any route, so one route the adapter cannot describe leaves every subscription route unregistered; `tests/llm-registration.spec.ts` boots the plugin against the real LLM registry to hold this.

A Claude plan that serves a model only against usage credits answers HTTP 429 `rate_limit_error` with `error.details.error_code: "credits_required"`. The alias adapter maps that refusal to `QUOTA`, which the route retry policy excludes, and replaces the JSON body with a message naming the model: buying credits is an account action that no retry can perform.

Claude has no device flow, so a pending Claude browser sign-in also accepts the pasted address of the provider's final page, for a browser that cannot reach the Host's loopback callback. Codex and Grok cover that case with their device flows and show no paste field.

## Consequences

The bill-of-materials mechanism is now redundant — workspace resolution makes cross-repository drift impossible — and is kept only until the package settles, then removed with `AVN_EXACT_BOM`.

Existing installs point a profile at the standalone package name. Repointing a profile at the workspace directory works, and the `workspace:^` peer ranges resolve through the harness's own `node_modules`; a profile that has not been repointed keeps loading the retired copy and will not receive changes.

The suite moved with the code: 527 tests across 45 files, updated to the settled behaviour rather than deleted. Removing seven feature areas in the same change — the local API gateway, Antigravity, CLI credential import, Kimi, model selection, the saved-accounts list, and the version footer — is what most of that update covers.

## Alternatives considered

**Split into role packages during the move.** Rejected for sequencing, not for merit: splitting while also changing repositories leaves nothing compiling or running until the very end. Landing whole and splitting inside the harness makes each step verifiable by these gates.

**Keep the standalone repository as the source and vendor a build.** Rejected. It preserves the lockstep release and the bill of materials, and it keeps the committed-artifact staleness that hid a feature from the running product.
