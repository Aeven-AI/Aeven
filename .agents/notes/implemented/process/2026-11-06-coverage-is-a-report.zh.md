# Agent Note: 覆盖率是报告，不是门禁

Status: implemented

[English](2026-11-06-coverage-is-a-report.md) | 中文

## Problem

[质量门禁决策](2026-06-11-quality-gates.zh.md)对 `packages/*/*/src` 设定了按文件 100% 的语句、分支、函数与行覆盖率，`vitest.config.ts` 通过 `coverage.thresholds` 执行它。自从[拉取请求门禁迁到 GitHub](2026-10-31-pull-request-gates-run-on-github.zh.md) 之后，没有任何 CI job 运行覆盖率，因此该阈值只会让本地的 `pnpm run test:coverage` 失败。仓库说明仍称它为门禁运行，agent 会为所属测试已经通过的改动花费多个回合补测试以达到该标准。

## Decision

`vitest.config.ts` 不声明覆盖率阈值。`pnpm run test:coverage` 和分区运行度量 `packages/*/*/src`，输出文本报告，并通过 `scripts/coverage-uncovered-locations.cjs` 列出未覆盖的位置；两者都不会因百分比失败。根目录与 client 的 `AGENTS.md`、`docs/testing.md` 以及 pre-push checks skill 都把覆盖率描述为报告。

`/* v8 ignore -- <reason> */` 注释保留其理由，使报告保持可读。

## Alternatives considered

**保留阈值并在 CI 中运行覆盖率。** 插桩 lane 是矩阵中最慢的，这正是它离开每次推送路径的原因。

**只在本地保留阈值。** 没有任何合并要求的本地标准会被 agent 当作要求，却拦不住任何缺陷。

## Consequences

一个改动的证据是其所属测试、snapshot 与 e2e 运行。覆盖率运行有助于发现死代码和未测试的分支，其输出仅供参考。
