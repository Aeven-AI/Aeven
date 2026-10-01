# Agent Note: 能力可以从保留的版本恢复

Status: implemented

[English](2026-10-01-capability-rollback.md) | 中文

## Problem

每一次能力写入本就已经保留其过程：`CapabilityStore.write` 把该版本的 `SKILL.md` 存到 `versions/<revision>.md`，从而让每次执行都能对应到它所遵循的文本。但没有任何东西能读这些文件。当某个能力的当前版本结果比早前版本更差时——比如学习器在因无关原因失败的一次运行之后重写了可用的过程——只能手工在磁盘上修复，或凭记忆重写过程；而 `capability.json` 只描述当前版本，早前版本的描述甚至不可见。

## Decision

`@aeven/capability` 读取它保留的版本，并恢复其中一个：

- `CapabilityStore.version(owner, name, revision)` 读取一个保留的过程及其 frontmatter 中携带的描述，`versions(owner, name)` 按由旧到新列出它们。当没有任何保留内容时两者都返回空而不是抛错，因为对调用方而言，“从未写入的版本”与“过程已丢失的版本”是同一事实。
- `Capabilities.versions(owner, name)` 与 `Capabilities.rollback(owner, name, revision, sessionId)` 对外暴露它们。恢复会把保留的过程与描述写成一个**新**版本，使历史保持只追加，并在溯源中记录 `action: 'rollback'` 与 `restored: <revision>`。恢复后的版本随后和其他版本一样接受自身证据的裁决：`settle` 可能使其降级或停用，恢复不会继承信任。
- `@aeven/api-memory-manager` 通过 `memoryManager` Remote 提供 `capabilityVersions(name)` 与 `rollbackCapability(name, revision)`，让设置页面能够提供历史，而不只是当前过程。

## Alternatives considered

- **另建一份版本台账文件。** 过程本就按版本存在磁盘上；第二份副本意味着第二处需要保持一致的东西。
- **就地恢复并复用旧版本号。** 那会改写历史，使后续执行无法对应到它实际运行的文本。
- **把信任带过恢复。** 被保留的版本在它当时可能是可信的，但周围的过程与文件已经变化；被替换版本的证据说明不了恢复回来的版本。
- **当目标版本已不存在时拒绝恢复。** 恢复是用户显式发起、并点名目标的操作；一个点名缺失版本的错误优于静默无操作。

## Consequences

能力目录会保留每个版本的 markdown，因此其体积随版本数量增长，而不是随当前过程的大小增长。没有任何清理机制：一个被编辑一百次的能力会保留一百个 `versions/<n>.md` 文件。

能力的设置界面正由另一个代理重新设计，因此本次变更没有把恢复操作接入界面；两个 Remote 方法就是它所需的接缝。

## Verification

`packages/capability/capability/tests/versions.spec.ts` 针对真实临时目录覆盖六个用例：两次写入按由旧到新读回各自携带的描述；未知能力对两种读取都返回空；未写入的版本号返回空；回滚把过程与描述恢复为第 3 版并记录溯源 `{ action: 'rollback', restored: 1 }`，被替换的版本仍保留，恢复后的过程成为当前内容；对未知版本号的回滚按名称被拒绝；对未知能力的回滚被拒绝。`npx tsc -b packages/capability/capability` 与 `npx tsc -b packages/memory/api-memory-manager` 均无错误，宿端构建重新生成了带这两个新方法的 Remote 面。
