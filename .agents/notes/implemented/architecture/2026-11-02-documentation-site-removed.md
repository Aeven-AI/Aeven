# Agent Note: the documentation site adapter is gone

Status: implemented

English | [中文](2026-11-02-documentation-site-removed.zh.md)

## Problem

`website/` projected `docs/` into a VitePress site. It had drifted out of the product: the shell still carried the old "deepseek 技术预览" header, a DeepSeek wordmark and a Chinese-first default, while the user-facing documentation moved to the separate Docusaurus help center (`helpcenter.aeven.io`). Two sites published from one documentation tree, and the one nobody maintained owned a projection adapter (`scripts/project-doc-site.ts`), a post-build fragment verifier (`scripts/verify-doc-site-fragments.ts`), two gate leaves (`docs-site-build`, `windows-site`), and the only reason `docs:dev`, `docs:build`, `docs:check`, `website:dev` and `website:build` existed.

## Decision

Remove the adapter rather than repair it.

- `website/` and its four scripts are deleted; `docs/` stays as the canonical prose tree, published by the help center.
- `pnpm-workspace.yaml` and the root `workspaces` array drop `website`, and the `docs:*` / `website:*` scripts go with it.
- `scripts/run-gates.ts` loses the `docs-site-build` leaf, both `windows-site` gates and the now-unused `docsBuildScript` option; the Windows complete set keeps the observational gates with plain `allowFailure` and no site-specific `after` rewiring.
- `scripts/gen-third-party-notices.ts` drops the `'website/'` dev-only area and `scripts/oxlint-contract.spec.ts` drops its `website` probe case.

## Alternatives considered

**Repair the site instead of removing it.** Rebranding the shell to Æven and translating the landing page would have kept two publication surfaces fed from one `docs/` tree, and it would have kept a projector, a fragment verifier and two gate leaves alive to serve a site nobody opened. The branding drift was the symptom; the duplicate surface was the reason nobody noticed.

**Keep `website/` unbuilt but in the tree.** Leaving a disabled workspace behind preserves the option cheaply, but it also keeps a VitePress dependency set, a stale site config and a second way to publish documentation in the repository, so the next reader has to rediscover which one is real.

## Consequences

`pnpm docs:check` no longer exists, so the projection tests and the fragment verifier stop guarding documentation links: `verify-md-links` and `verify-doc-graphs` remain the gates that read `docs/` directly. Restoring a published doc site means adding a projector again, not resurrecting this one.
