# Agent Note: A repeated wall time fires on its first instant

Status: implemented

[English](2026-11-01-fall-back-first-instant.md) | 中文

## Problem

日历类重复按 IANA 时区指定一个墙上时间，而 `localCandidate` 用 `DateTime.fromObject({ …hour, minute… }, { zone })` 把该墙上时间变成一个瞬间。秋季回拨时同一个墙上时间会出现两次，Luxon 把这种歧义输入解析到较晚的偏移：在 `America/New_York` 时区，2026-11-01 的 `01:30` 返回 `06:30Z`，即第二个瞬间，而 `05:30Z` 才是第一个。在任何一次构建里都能在本机复现，因为该解析只取决于时区规则，与测试运行当天无关。暴露它的是失败的边界规范：`recurrence-boundaries.spec.ts` 期望该调度只触发一次，且落在第一个瞬间。

## Decision

`localCandidate` 向 Luxon 索取携带该墙上时间的所有瞬间 —— `getPossibleOffsets()` —— 并返回最早的一个。两条扫描路径都继承这一规则：`nextOccurrence` 与 `latestDueOccurrence` 共用 `localCandidate`，因此日期边界、错失窗口与补算路径对“哪一次触发”的判断一致。被春季前拨抹掉的墙上时间仍然返回 `null`：现有的有效性与墙上时间比较让该分支保持显式。

## Alternatives considered

- **保留 Luxon 的较晚偏移解析，改动规范。** 第二个瞬间比调度指定的墙上时间晚一小时，日重复会在回拨日漂移一小时，中断后的补算也会重跑已经运行过的行。
- **手工比较偏移**，用 `zone.offset(timestamp)` 在候选日附近推算：这重复了 `getPossibleOffsets()` 已经给出的信息，而且代码还得猜转换瞬间。
- **用进程时区解析歧义**：调度自带时区，本机时区甚至可能并不重复该小时。

## Consequences

回拨日对每种日历类型 —— `daily`、`weekly`、`monthly`、`nth-weekday`、`yearly`、`hours` 与 `cron` —— 都只在第一个瞬间产生一次触发，因为它们都归约为墙上时间。较晚的那个瞬间永不被调度，因此回拨之后的日节奏是 25 小时而不是 24 小时，这正是墙上时间的含义。`getPossibleOffsets()` 每个候选墙上时间多一次时区查询；回溯扫描每次求值最多调用它几次。
