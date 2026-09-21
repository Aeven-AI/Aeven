# Agent Note: Shared route vocabulary between the DeepSeek and Aeven LLM routes

Status: implemented

English | [中文](2026-09-21-shared-route-vocabulary-llm-aeven-deepseek.zh.md)

## Problem

`@aeven/llm-aeven` is the Aeven gateway route: the same `DeepSeekAdapter` transport, registered under the provider key `aeven-cloud`, over Aeven's own identity authority. It was forked from `@aeven/llm-deepseek`, and the fork carried three copies of things that belong to the adapter and the registry rather than to either route: the catalog-entry schema, the connection-field vocabulary of the plugin config schema, and the registration ceremony that publishes a configurable route and answers its model listing. The duplication gate (`pnpm run duplication`, jscpd, `exitCode: 1`) reported all three as cross-file clones.

Each copy was a place the two routes could drift apart silently. A field added to the adapter's connection facts, a validation change in the catalog schema, or a change in how a route is announced would reach whichever route was edited and not the other, and nothing would fail — the schemas would simply describe different sets. The copies are also not free to remove: each route's config schema is a gated documentation artifact, pasted verbatim into `docs/config-catalog.md`, and the generator that produces it walks the exported `Config` as a literal schemastery call.

## Decision

The registration ceremony is shared. `@aeven/llm-deepseek` exports `registerProviderRoute(ctx, route)`, which performs `registerConfigurableProviders` for a route and then answers `registerModelDiscovery` from the catalog the route already advertises rather than from a live listing — that answer is the decision the helper carries, because a provider's listing is entitlement-scoped and so discloses strictly less than the entries the route ships. `@aeven/llm-aeven` calls it with its own provider key, display name, settings namespace, and catalog source. `@aeven/llm-deepseek` was already a `devDependencies` and `peerDependencies` entry of `@aeven/llm-aeven`, and the Aeven route already extends `DeepSeekAdapter`, so no manifest changed.

The two schemas stay literal, one per route. The config catalog generator (`scripts/gen-config-catalog.ts`) collects one top-level key or nested path per assignment in the exported `Config` declaration: it understands `z.object({…})` — behind chained refinements — and `z.intersect([…])`, and hard-errors on anything else, because a schema it cannot see would silently thin `docs/config-catalog.md` instead of failing the gate. A `Config` built by a factory is invisible to it, and a spread would drop the shared field paths from the generated page. So `catalogModel` and `Config` remain `z.object({…})` literals in both routes, where they were.

The two copies that remain are enclosed in the duplication gate's policy-sanctioned exception. `/* jscpd:ignore-start -- <reason> */` … `/* jscpd:ignore-end */` wraps only the duplicated assignment lists — the catalog-entry schema and the connection-field block in each file — with a reason naming the two owners and pointing here, and it never covers the `Config` interface, the route's own defaults, its credential resolution, or any surrounding logic. No entry was added to `.jscpd.json`.

Each route keeps what genuinely differs about it: its default model catalog, its thinking and effort defaults, its endpoint and credential fields, its `resolveApiKey` and its error text. `AevenAdapter`, the shipped `DEFAULT_MODELS`, and both `Config` interfaces are untouched, and the `@aeven/llm-aeven` and `@aeven/llm-deepseek` sections of `docs/config-catalog.md` are unchanged.

## Alternatives considered

**Build each schema from one shared factory.** This is what a reader expects from "the same vocabulary declared once", and it removes both copies outright: a factory in `llm-deepseek` owning the connection fields, parameterized by the route's own `thinking`, `reasoningEffort`, and `models` schemas. It lost to the config catalog gate. Accepting a factory would mean teaching the generator to walk an arbitrary function call — following it into another package and resolving its parameters back to a route's own values — which makes the generated page depend on the analyser understanding each factory's contract, and makes a schema the analyser cannot follow a silent hole in a gated artifact. The literal is also what makes the generated page readable: `docs/config-catalog.md` shows each route's config as that route's own code.

**Compose the schema with `z.intersect([shared, routeOwned])`.** The generator already walks `intersect`, so this is the one composition it accepts. It lost on the emitted schema instead: the root node becomes `type: 'intersect'` with a `list` rather than `type: 'object'` with a `dict`, and the settings surface walks object nodes (`nodeAtPath` in `packages/client/ui-settings/src/client/schema.ts` reads `node.dict`), so the route's config fields would stop rendering — a silent regression in the surface whose schema this is. It also drops the field paths from the catalog page.

**Mark the whole config block, including the factory call, with an ignore range and keep the factory.** Narrower diff, and the gate would pass. It lost because the range would then cover the route's own defaults and endpoint fields rather than the duplicated assignment list, which is exactly what the exception is not for.

**Share only the catalog-entry schema, and leave the connection-field copy.** Smaller change, and it clears one clone. It lost because the connection vocabulary is the part where a second copy actually drifts: a knob added to `DeepSeekConnectionOptions` would exist in one route's schema and not the other's, and only a request-time refusal would say so.

## Consequences

- The registration ceremony and the catalog-sourced discovery answer are declared once, and a route cannot announce a settings namespace without also answering its model listing.
- The two schema copies remain, so the drift they permit is now a recorded decision rather than an accident. The exception is scoped to the assignment lists and names both owners, so a reader who edits one block is told the other exists; the duplication gate stays quiet about them.
- Adding a field that both routes need still means editing two files. The config catalog gate is what keeps them in step, because both are gated artifacts.
- Both literals stay walkable, so the generator exits clean rather than reporting a violation, and the two routes' generated catalog sections are byte-identical to what they were before this change.
- A future change to the config catalog generator — teaching it to follow factory calls — would let the factory approach land; nothing else blocks it.
