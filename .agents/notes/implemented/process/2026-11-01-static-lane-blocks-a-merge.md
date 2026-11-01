# Agent Note: The static lane fails a merge

Status: implemented

English | [中文](2026-11-01-static-lane-blocks-a-merge.zh.md)

## Problem

`static` ran forty-four repository-hygiene gates with `continue-on-error: true`, so the job reported success whatever it found. For one release cycle `main` required that job name anyway, which made the required check decorative: a stale `docs/config-catalog.md` reported green, and a run could pass while the lane inside it failed.

The lane was downgraded after it blocked a pull request whose unit tests, typecheck and build all passed: it claimed `docs/config-catalog.md` was stale on the runner while the same commit regenerated nothing and exited zero locally. That drift came from line-number anchors in generated source links, and it is fixed at the generator — the catalogue labels now name the file only, so an unrelated edit above a declaration no longer changes generated output.

## Decision

The static lane blocks. `continue-on-error` is gone from its step, and `main` requires `test`, `static`, `types-lint` and `build-verify` alongside `owner-only`. A merge with any of them pending or red is refused; an administrator can still bypass deliberately, which is the escape hatch for a lane broken by the host rather than by the change.

A required check that cannot fail is worse than an absent one: it spends the run's minutes and produces evidence that reads as a pass.

## Alternatives considered

**Keep the lane advisory.** Rejected: `main` already requires the job name, so advisory meant the requirement measured nothing. Either the lane gates or the requirement goes.

**Drop the lane and keep its gates in a separate advisory workflow.** Rejected for now: the gates catch real breakage — stale generated files, licence drift, manifest mistakes — and the drift that made them feel flaky is fixed at its source.

## Consequences

A generated-file or manifest mistake now stops the pull request that introduced it. When the host, not the change, breaks a gate, the failure is fixed or bypassed deliberately rather than absorbed silently.
