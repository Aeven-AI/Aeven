# Agent Note：每个 Aeven 主目录共享一个 GUI Host

Status: implemented

[English](2026-10-07-desktop-waits-for-booting-host.md) | 中文

## 问题

独立的 Web 与 Electron Host 可以读取同一份持久数据，却在内存中持有不同的 Session、序号游标和工作区文档。并发追加会产生重叠序号；领域文档的整份写入会替换另一个 Host 的工作区成员关系。启动完成后才发布发现记录会留下启动竞争窗口。仅供参考的 PID 记录与就绪超时无法阻止竞争执行。

## 决策

GUI 启动器在挂载有状态插件之前认领 `runtime/host.lock` 的内核锁。CLI 检查组合后的 profile 是否包含 HTTP 服务器；headless 与 stdio profile 保持独立执行。Electron 子进程使用相同的认领操作。所有者在完整启动后，将已认证端点原子发布到 `runtime/host.json`。竞争者接入该端点，或报告就绪失败；活进程绝不因探测失败或期限到达而失去所有权。锁文件保持原位，进程死亡会释放内核认领。升级期间，已有活进程的发现记录也会阻止新的写入者启动。

Electron 与普通浏览器使用同一个已认证 HTTP 应用。Electron 子进程默认使用回环端口 3080，提供匹配的前端与工作区文件路由。Electron IPC 接受其应用来源，接入 Host 的登录发现使用 Electron 自带 Cookie 管理的 session。提供服务的 profile 与插件能力属于第一个启动器；再次启动仅报告现有端点，不应用新的参数或 patch。

[桌面 Host 的生命周期取决于客户端租约](../architecture/2026-10-15-desktop-host-lifetime-follows-leases.zh.md) 取代了本笔记的退出行为：桌面启动的 Host 会在其桌面壳与所有客户端租约都离开后停止。显式关闭会在应用完成销毁后释放所有权。销毁失败时，内核认领保持到进程退出。Desktop 启动不会替换被接入 Host 的包依赖图，包验证或激活会拒绝外部拥有的 Host。[逐 Session 写入锁](2026-10-10-session-writer-ownership.zh.md) 对独立的非 GUI 进程仍然必要。

## 考虑过的替代方案

**延长就绪探测或仅发布 PID。** 两个启动器都找不到提供服务的 Host 时，这两种方式都无法串行化启动决策。活着但停滞的 Host 可能在超时后恢复写入，因此启动竞争后端并不安全。

**多个 Host 共享 Session 文件。** Session 锁能够防止损坏的追加，但无法向两个客户端提供同一份实时执行与账户领域状态。

**Electron 退出时停止 Host。** Electron 只是共享应用的一个客户端。它离开并不授权中断另一个客户端的工作。

## 后果

先启动 Web、先启动 Electron，以及同时启动 GUI，都会选择一个提供服务的 Host。非 GUI 进程保持逐 Session 互斥。更新外部拥有的后端需要先停止其 Host。运行中的旧进程必须重启才能参与协调。按用户要求，验证仅包含 TypeScript 与仓库构建；启动顺序、崩溃、Windows 锁定及可见客户端行为尚未在运行时验证。
