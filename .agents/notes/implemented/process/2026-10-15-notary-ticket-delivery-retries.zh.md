# Agent Note: Apple 票据投递改为重试，而不是让发布失败

Status: implemented

[English](2026-10-15-notary-ticket-delivery-retries.md) | 中文

## 问题

一个签名 macOS 发布连续两次在钉票阶段失败，而不是在签名或公证阶段失败。Apple 接受了两次提交——日志中有 `• notarization successful`，紧随其后的深度严格检查也验证了 Developer ID 身份——随后 `xcrun stapler` 在向 `api.apple-cloudkit.com` 查询票据时以退出码 68 失败：`NSURLErrorDomain Code=-1005 "The network connection was lost."`、空响应，以及 `CloudKit's response is inconsistent with expections: (null)`。一次是 electron-builder 为应用钉票时丢失了查询，另一次是 DMG 钩子校验已钉票的磁盘映像时丢失了查询。两个产物本身都是正确的，但每次发生仍会丢弃一个已完成的 macOS 构建，并且由于 release 作业需要每个目标都成功，整个发布也随之作废。

## 决定

- **Apple 票据投递由 `apps/desktop/scripts/macos-notarization.mjs` 负责。** 它从 Apple 自身的输出中识别票据查询失败，只重试这类失败；其他任何失败——签名无效、票据记录不存在、Apple 拒绝公证——都在第一次尝试时判定构建失败。一次 `staple` 或 `validate` 最多尝试三次，间隔 15 秒。
- **已获接受的提交永不重提。** `notarizeMacOSArtifact` 只提交一次；当 Apple 接受提交而随后的票据查询失败时，它会再次为产物钉票，因为对同一产物重复钉票不会改变任何东西，而再次提交又要在 Apple 队列里等上完整的一轮。
- **after-sign 钩子负责应用公证。** electron-builder 的 `mac.notarize` 选项在不重试的单次调用里钉票，因此 `mac.notarize` 设为 `false`，由 `notarizeMacOSApplicationAfterSign` 提交应用、为其票据钉票、要求该票据存在并验证发布身份，全部发生在用该应用构建 DMG 与 ZIP 目标之前。
- **磁盘映像这条路径保持原有契约。** `notarizeMacOSDiskImageArtifact` 仍然为每个 DMG 公证、钉票并做资格检查，`verifyMacOSDiskImage` 内的 `stapler validate` 步骤走同一套重试投递。

## 考虑过的替代方案

**重试整个公证调用。** `@electron/notarize` 把提交与钉票耦合在同一个函数里，因此在查询丢失后重试它会第二次提交一个已经公证过的产物，再在 Apple 队列里等待一轮：为一次重新钉票几秒就能修好的故障，付出几分钟到一小时的代价。

**保留 electron-builder 的公证选项，事后修补钉票。** 该选项的钉票失败会在 electron-builder 的签名步骤内抛出，早于 after-sign 钩子运行，因此没有钩子能观察到它、更无法修补。

**给 `app-builder-lib` 打补丁。** 本仓库已经为该包打过补丁，但这样的补丁会把上游从未要求的重试策略一并带走，而同一策略必须覆盖的 DMG 路径本就在本仓库的代码里。

**把退出码 68 一律视为瞬时故障。** Apple 从未签发票据的产物同样报 68，重试它会掩盖真正的公证缺陷。只有 Apple 输出中的票据查询诊断会被重试。

## 后果

- 票据投递打嗝的代价最多是 30 秒延迟，而不是重建一个 macOS 目标；三次尝试都失败的查询仍会让构建失败，其日志会同时指出丢失的查询与随后的钉票。
- Apple 拒绝的公证、无效签名、票据记录不存在都会在第一次尝试时就终止发布，因为票据查询是唯一被重试的失败。
- 应用公证从 electron-builder 转移到 after-sign 钩子，因此由一个脚本拥有给应用定资格的顺序——提交、钉票、要求票据、验证身份——DMG 与 ZIP 都由已携带票据的应用构建而成。
