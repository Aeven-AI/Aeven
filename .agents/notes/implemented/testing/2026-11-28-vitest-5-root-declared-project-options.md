# Agent Note: Declare shared Vitest project options once at the root

Status: implemented

English | [中文](2026-11-28-vitest-5-root-declared-project-options.zh.md)

## Problem

The unit suite ran on Vitest 4.1.8 in 144 s on a 12-core macOS host, and Vitest 5 is faster for isolated fork pools. Vitest 5 also changes how `vitest.config.ts` resolves: an inline project now extends the config file that declares it, and Vite concatenates array options during that merge. The 4.x config repeated `resolve.alias`, `plugins`, `setupFiles`, `pool`, `execArgv`, `include`, and `exclude` on the root and on both projects, because 4.x projects did not inherit them. Under 5.x that repetition would apply each setup file and plugin twice and add the root `include` to every project, so `process-bound` would collect the whole inventory.

## Decision

The repository runs Vitest 5.1.2. The root `test` config declares every option the `thread-safe` and `process-bound` projects share: aliases, the standard-decorator plugin, `execArgv`, `pool: 'forks'`, `setupFiles`, and the platform, host-privilege, and coverage-exempt excludes. Each project declares only `name`, `include`, and its own extra `exclude`. The root declares no `include`, so a project's file set is exactly its own `include`. `vitest list --filesOnly` resolves the same 1461 `thread-safe` and 7 `process-bound` files as on 4.1.8.

Vitest 5 enables its file-system module cache (`fsModuleCache`) by default, so the config does not set it. `test:snapshot:record` passes `--update=all` rather than a bare `--update`, because 5.x's `--update [type]` consumes the next argument and resolves any unrecognized value to `all`, which would turn an appended file filter into a full-suite update.

Vitest 5 stricter checks required three test corrections: an unawaited `.rejects` assertion now fails its test, `expect.poll` passes `{ signal }` to its callback (so a reader with an optional parameter is wrapped), and a custom matcher's `Assertion` declaration merge uses the two-parameter `Assertion<R, T>`. Vitest 5 removes the quotes around string values in `test.each`/`test.for` title placeholders, so snapshot keys built from those titles were renamed without changing their values.

## Alternatives considered

- **`extends: false` on each project.** Rejected: it keeps the 4.x repetition, so adding a setup file or exclude would again require editing three places, and the projects would no longer share the root Vite server that 5.x creates for extending projects.
- **Non-isolated workers (`isolate: false`) for `thread-safe`.** Measured on 4.1.8 and rejected. One shared worker per file sequence reached 114–122 s, but seven full runs each surfaced a different cross-file leak. The leaks came from module mocks loaded before registration, one jsdom window reused across files, Node-environment client specs assigning browser globals, Host registries, and koffi type names registered twice. One run ended when a worker exhausted its heap.
- **Staying on 4.1.8.** Rejected: 4.x receives only maintenance releases, and the 5.x module cache and shared project server reduce the transform cost that every run pays.

## Consequences

On the same host, the full unit suite measured 138 s on the first run after the upgrade and 128 s on the next run, when the module cache was warm, against 144 s on 4.1.8. An option added to the root `test` config now reaches every project. An option meant for one project must be declared on that project, and an array option there is appended to the root's value rather than replacing it. `vitest doctor`, which compares alternative pool and isolation settings, did not produce a recommendation because a heavy streaming spec timed out while another full run shared the host. It needs an otherwise idle machine.
