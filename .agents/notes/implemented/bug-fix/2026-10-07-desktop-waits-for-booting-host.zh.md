# Agent Note: 桌面外壳等待正在启动的 Host，而不是启动第二个

Status: implemented

[English](2026-10-07-desktop-waits-for-booting-host.md) | 中文

## 问题

桌面外壳会接管已在服务其 Aeven home 的 Host，因为同一 home 上的两个 Host 会互相覆盖领域文档。它只在启动时决定一次：读取 `runtime/host.json`，对公布的 URL 探测 1.5 秒，任何一次未命中就启动自己的 Host。Web Host 只在整个启动完成后才写入该租约，在开发机上约需九秒；而正在重启的 Host 会先在关闭时删除租约。在这段窗口内打开的外壳找不到租约，于是在同一 home 上启动了第二个 Host；在开发环境中，每个会话随后都以 `gateway/internal` 加载历史失败，侧边栏把所有会话都显示为未分组。

## 决策

CLI 入口会在加载启动依赖图之前为 profile 运行占用租约（[`apps/cli/src/host-claim.ts`](../../../../apps/cli/src/host-claim.ts)），只记录其 pid 和启动时间，因此未占用的窗口只剩 Node 启动本身。启动后，具有 HTTP 服务面的 Host 把带令牌的 URL 补充到该占用记录中（[`apps/cli/src/profile-boot.ts`](../../../../apps/cli/src/profile-boot.ts)）；没有 HTTP 服务面的 Host 会交还占用，因此 headless 调用仍为 GUI 保留该 home。占用永远不会覆盖其他进程持有的有效租约。

`planDesktopBackend`（[`apps/desktop/src/attached-host.ts`](../../../../apps/desktop/src/attached-host.ts)）在租约所属进程存活期间每 250 毫秒重新读取租约，直到租约带有可响应的 URL 或 30 秒过去。只有当 home 没有租约、被租约记录的进程已退出或等待超时时，它才启动自己的 Host，外壳会记录是哪一种情况。

## 考虑过的替代方案

**延长单次探测。** 更长的超时能覆盖响应慢的情况，却覆盖不了尚未公布 URL 的 Host，而正是这段窗口产生了第二个 Host。

**只要有有效租约就让外壳拒绝启动。** 在公布 URL 之前挂起的 Host 会让用户没有任何窗口；有上限的等待则回退到原有行为。

**只为 web profile 占用租约。** 一棵树是否提供 HTTP 只有在其插件挂载后才能知道，所以每个 profile 都会占用租约，没有 Web 服务器的树再交还。

## 影响

在 Web Host 启动或重启期间打开的外壳，会在其开始服务后接管它；若外壳的检查早于新进程启动 Node，仍然找不到租约。在 headless 运行启动期间打开的外壳，会等到该运行完成启动并交还占用，然后启动自己的 Host。一直存活却从不响应的 Host 会让外壳延迟 30 秒后再启动自己的 Host。`apps/desktop/tests/attached-host.spec.ts` 中期望对无响应或没有 URL 的有效租约立即回退的接管规格，描述的是已被替换的单次探测行为。
