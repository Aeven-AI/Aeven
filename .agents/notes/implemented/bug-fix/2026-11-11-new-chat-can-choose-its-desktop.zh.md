# Agent Note：新对话可以选择桌面

Status: implemented

[English](2026-11-11-new-chat-can-choose-its-desktop.md) | 中文

## 问题

2026-11-11，用户报告 chat.aeven.io 上的新对话在选项中没有“选择桌面”一行。`SessionCommands.placement` 调用 `sessionHandoff.placementOf`，后者对不在账户同步索引中的会话返回 undefined，而新对话按设计就不在其中：`publishSession` 会在对话有活动之前不发布它，因此未发送的草稿不会到达其他设备。`moveTo` 也拒绝这样的会话。

## 决策

在始终在线设备上，`SessionMirror.placementOf` 对尚未发布的会话返回账户的各台桌面，其归属设备是首个输入将去往的地方：用户的选择，否则是运行了最近对话的在线桌面。对尚未发布的会话调用 `moveTo` 会把选择保存在内存中（一台桌面，或以 null 表示本设备），`homeOf` 据此路由首个输入。一旦 `publishSession` 写入该会话的索引条目，选择即被丢弃，此后由条目的写入者说明它在哪里运行。

## 考虑过的替代方案

在选择时发布草稿，会把一个空对话放到每台设备上。把选择留在客户端，则负责转发首个输入的 Host 路由并不知道它。

## 影响

桌面应用对未发送的对话仍不提供这一行，因为它不路由首个输入。在某个浏览器中做出的选择由 Host 进程持有，若在第一条消息之前重启就会丢失，此时采用默认路由。

## 验证

类型检查与完整构建通过。尚未在有桌面的环境中实际验证。
