# Agent Note: Lockfile importers must name exactly the workspace packages

Status: implemented

English | [中文](2026-09-22-lockfile-importers-match-the-workspace.zh.md)

## Problem

Merged `main` carried a `pnpm-lock.yaml` importer for `packages/experimental/browser-devtools`, a directory that existed only as an untracked stub in one shared checkout. `bc12e4bc42` (PR #58) committed the lockfile a partial `pnpm install` there had produced, and `363e6d83d7` (PR #61) removed the two lines again with a `pnpm install --lockfile-only` run in a checkout without that directory ([issue #59](https://github.com/Aeven-AI/Harness/issues/59)).

Two measured install behaviours decide what a gate has to own:

- A lockfile importer with no workspace directory passes `pnpm install --frozen-lockfile`. In a synthetic workspace, with and without resolved dependencies in the lockfile, that command exited 0, printed `Already up to date`, and rewrote `pnpm-lock.yaml` without the foreign entry. `.gitlab-ci.yml` installs with `--frozen-lockfile`, so CI silently drops such an entry in its own checkout and reports nothing; only a repository gate can report the committed file.
- A workspace package with no importer fails the same command with `ERR_PNPM_OUTDATED_LOCKFILE` when the package declares specifiers (measured with one dependency added: exit 1), and is silently given an empty importer when it declares none.

No gate read the importer key set. [`verify-vendored-links`](../../../../scripts/verify-vendored-links.ts) reads `pnpm-lock.yaml` but only the resolution of vendored names, while [`check-workspace-constraints`](../../../../scripts/check-workspace-constraints.ts) and [`verify-package-dependencies`](../../../../scripts/verify-package-dependencies.ts) read manifests, source, and the directory hierarchy. `pnpm run verify-package-dependencies` reported PASS on the commit that carried the foreign entry.

## Decision

[`verify-package-dependencies`](../../../../scripts/verify-package-dependencies.ts) owns the agreement, because it already owns `pnpm-lock.yaml`: it is the gate that regenerates the file, so the check and its repair share one home. Its check `lockfile workspace importers` runs inside `pnpm run verify-package-dependencies`, a leaf of `pnpm run hygiene`, `pnpm run check:all`, and both static CI aggregates.

- Workspace directories come from the `packages` member globs in `pnpm-workspace.yaml`, the repository's own source of truth, never from a list in the gate. A directory is a workspace package when a glob matches it *and* it holds a `package.json`, which is pnpm's own member rule, so a matched directory without a manifest is correctly neither a package nor an expected importer. A negated glob (`'!packages/experimental/*'`) removes what it matches, and `.` is a member although no glob names it.
- Both directions are violations. Each line names the offending directory and the direction: an importer with no workspace package (`pnpm-lock.yaml names this directory as a workspace importer, but no workspace package exists here`) or a workspace package with no importer (`workspace package has no pnpm-lock.yaml importer`). Each line also names the repair.
- The reader throws rather than passing when the workspace file declares no members, when the member globs match no manifest, and when the lockfile declares no importers: an empty set on either side would otherwise agree with everything.
- `--fix` repairs both directions through the refresh it already performs; `pnpm install --lockfile-only` drops a foreign importer and records a missing one.
- The lockfile check reports whatever the dependency policy said, so one run names every failing check. On success the gate prints the check's name and the package count it agreed with.

[`verify-package-dependencies.spec.ts`](../../../../scripts/verify-package-dependencies.spec.ts) covers the check in its own `lockfile workspace importers` block: derivation from the member globs plus the root, glob negation, a directory a glob matches without a manifest, the rejected case in each direction with the offending path asserted verbatim, both at once, a matching lockfile accepted, the repository's own committed lockfile accepted, and the three loud failures. Its fixtures write into `mkdtemp` directories, so no compiled-tree probe window applies.

## Alternatives considered

**A second gate script with its own `package.json` script and `run-gates` leaf.** Rejected: the workspace definition and the lockfile would then be read by two scripts, and the gate that regenerates `pnpm-lock.yaml` is the one whose `--fix` repairs this defect. The name the check needs is available inside the owning gate without giving the repository a third home for install facts.

**The `constraints` gate (`scripts/check-workspace-constraints.ts`), which owns the workspace member set.** Rejected: that gate is documented as package-manager-independent — its invariants are stated over manifests and the `packages/<group>/<pkg>` hierarchy — and it reads no lockfile. A `pnpm-lock.yaml` reader there would trade a documented property for adjacency.

**Hardcoded member globs, as both neighbouring scripts carry.** Rejected: a list in a gate drifts from `pnpm-workspace.yaml` silently, which is the failure class this check exists to report.

**Only rejecting an importer with no workspace package.** Rejected: a workspace package with no importer fails `pnpm install --frozen-lockfile` on a fresh clone, so one committed lockfile would break the CI install in the other direction while the gate stayed green.

**Letting `pnpm install --frozen-lockfile` be the check.** Rejected: it does not reject the foreign importer at all, it needs a populated store or a network, and it rewrites the file it is asked to assert about.

**Asserting the repository's own lockfile from a spec only.** Rejected: the check would report through the test lane, which names neither the offending directory nor a gate the reader can re-run.

## Consequences

- Adding or removing a workspace package now carries a lockfile obligation that fails loud: run `pnpm install`, or `pnpm run verify-package-dependencies -- --fix`, so the importer set follows. A package directory without an importer is rejected even when it declares no dependencies and the install would have repaired it silently, because the committed lockfile is a repository fact rather than an install artifact.
- On this tree the check reads 300 workspace package directories and 300 importers and passes; the spec asserts that same agreement against the repository root, so a later divergence fails a named case with the path in its message.
- The gate reads two more files. That cost is paid once per run, and the check reports after the dependency policy instead of replacing it.
- The check sees only directories the member globs describe. A package committed outside every `pnpm-workspace.yaml` glob stays invisible to it, as it does to the `constraints` gate's own hardcoded walk; declaring the member area in `pnpm-workspace.yaml` is what brings both gates to bear.
