# Static gates report, they do not block

## Problem

The `static` CI lane runs forty-four repository-hygiene gates: constraints, package
manifests, licenses, the Cordis config resolver, the client surface checks, and every
generated documentation catalogue compared byte for byte against its source. It failed a
pull request whose unit suite, typecheck and build all passed, with "docs/config-catalog.md,
docs/config-catalog.zh.md stale" — a verdict that the same commit did not reproduce on a
developer machine, where the generator rewrote nothing and the check exited zero. A lane
whose outcome depends on which machine ran a generator, and which has no failing test behind
it, held a fix open for half an hour and would have held a release the same way.

## Decision

`static` is advisory. The `Static gates` step carries `continue-on-error: true`, so the lane
publishes its result without deciding whether the pull request can merge. The unit suite
(`test`), the whole-workspace compile (`types-lint`) and the build plus artifact verification
(`build-verify`) still block: each of them fails only when the product is broken.

The generator's source checks stay blocking, because they never read the committed artefact.
`gen-config-catalog.ts --validate` runs the passes that reject a package with no config
classification, a referenced type that does not resolve, and — the one that matters most — a
schema key missing from its declared config type. The `test` lane runs it as `verify-config-schema`,
so a real defect still stops a merge, while the byte comparison that disagreed between CI and a
developer machine is only advisory.

The catalogue also records the source line of each declaration it documents, so editing a
plugin's `src` without regenerating makes the comparison stale by construction. That is the
reason the comparison cannot decide anything: it reports which generated file is behind, and
the remedy is always the same regeneration.

A stale generated artefact is fixed in the pull request that made it stale, not by stopping
an unrelated one. When this lane goes red, its own result is the work item: read which gate
failed and regenerate that artefact.

## Alternatives

**Fix the catalogue divergence instead.** It is the right next step and not a substitute:
the divergence is one instance of a class — generated files compared against the machine
that generated them — and the lane would keep holding unrelated work every time it recurs.

**Keep the lane blocking and re-run it.** A re-run of a nondeterministic comparison returns
a different answer without changing anything, which teaches everyone to ignore the lane.

## Consequences

A green `static` still means what it meant; a red one now costs a follow-up instead of a
blocked merge. Nothing hides: the lane's conclusion stays visible on the pull request, and a
schema field that its type does not declare still fails the `test` lane. Repository hygiene
keeps a named task when the lane goes red, instead of a closed door.
