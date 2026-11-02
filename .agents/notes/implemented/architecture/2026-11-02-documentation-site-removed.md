# Agent Note: the documentation site adapter is gone

Status: implemented

## Problem

`website/` projected `docs/` into a VitePress site. It had drifted out of the product: the shell still carried the old "deepseek 技术预览" header, a DeepSeek wordmark and a Chinese-first default, while the user-facing documentation moved to the separate Docusaurus help center (`helpcenter.aeven.io`). Two sites published from one documentation tree, and the one nobody maintained owned a projection adapter (`scripts/project-doc-site.ts`), a post-build fragment verifier (`scripts/verify-doc-site-fragments.ts`), two gate leaves (`docs-site-build`, `windows-site`), and the only reason `docs:dev`, `docs:build`, `docs:check`, `website:dev` and `website:build` existed.

## Decision

Remove the adapter rather than repair it.

- `website/` and its four scripts are deleted; `docs/` stays as the canonical prose tree, published by the help center.
- `pnpm-workspace.yaml` and the root `workspaces` array drop `website`, and the `docs:*` / `website:*` scripts go with it.
- `scripts/run-gates.ts` loses the `docs-site-build` leaf, both `windows-site` gates and the now-unused `docsBuildScript` option; the Windows complete set keeps the observational gates with plain `allowFailure` and no site-specific `after` rewiring.
- `scripts/gen-third-party-notices.ts` drops the `'website/'` dev-only area and `scripts/oxlint-contract.spec.ts` drops its `website` probe case.

## Consequences

`pnpm docs:check` no longer exists, so the projection tests and the fragment verifier stop guarding documentation links: `verify-md-links` and `verify-doc-graphs` remain the gates that read `docs/` directly. Restoring a published doc site means adding a projector again, not resurrecting this one.
