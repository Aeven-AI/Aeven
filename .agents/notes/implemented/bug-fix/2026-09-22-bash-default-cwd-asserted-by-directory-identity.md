# Agent Note: Bash's default cwd is asserted by directory identity

Status: implemented

English | [中文](2026-09-22-bash-default-cwd-asserted-by-directory-identity.zh.md)

## Problem

`packages/shell/bash-local/tests/executor.spec.ts` asserted that the shell's default working directory equals the process's own, as path text: `expect(result.stdout.text.trim()).toBe(process.cwd())`.

`pwd` prints the logical path — bash keeps an inherited `PWD` when it names the same directory as `getcwd(3)` — while `process.cwd()` is the physical path. On a case-insensitive filesystem, entering the checkout through a differently-cased spelling makes the two strings differ by case while naming the same directory, so the case failed deterministically against a correct executor: `expected '/Users/Mac/Projects/Nodejs/aeven/aeven' to be '/Users/Mac/Projects/Nodejs/Aeven/aeven'`.

`fs.realpathSync` does not repair this: it resolves symlinks, not case, and returns each spelling as given. Both spellings stat as device `16777234`, inode `173691567`.

## Decision

The case asserts the directory the two paths name: it stats the shell's `pwd` output and `process.cwd()`, then compares `dev` and `ino`.

```ts ignore-check
expect({ dev: shellCwd.dev, ino: shellCwd.ino }).toEqual({ dev: processCwd.dev, ino: processCwd.ino })
```

Nothing product-side changes. Inheriting the parent environment, `PWD` included, is correct for a subprocess, and a POSIX shell is entitled to print a logical path; the conflict was in the assertion, not the executor.

## Alternatives considered

**Skip the case on macOS.** Rejected: this is the platform where the spellings diverge, and a skipped case asserts nothing about the executor's default working directory.

**Relax it to a substring or basename match.** Rejected: every directory named `aeven` shares that basename, so the case would pass for a wrong default.

**Rewrite `process.env.PWD` before the run.** Rejected: it removes the condition under review, namely which path the executor was actually given.

**Compare through `fs.realpathSync`.** Rejected: realpath does not canonicalise case here, so the mismatch survives the normalization.

## Consequences

- The case keeps its claim — the shell defaults to the process's working directory — and holds for both spellings, on a case-insensitive filesystem and a case-sensitive one.
- The comparison is not vacuous: with the expectation pointed at `/tmp`, the case reports inode `175817587` against the checkout's `173691567` on the same device, so a default pointing elsewhere still fails the case.
- Both directories must exist, so a default naming a missing directory fails through `statSync`'s `ENOENT` instead of a text mismatch.
- Verified green for the focused case from both spellings, `/Users/Mac/Projects/Nodejs/Aeven/aeven` and `/Users/Mac/Projects/Nodejs/aeven/aeven`, and for the whole file in one invocation.
