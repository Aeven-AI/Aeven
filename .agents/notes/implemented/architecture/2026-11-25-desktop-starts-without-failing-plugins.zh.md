# Agent Note：桌面端在插件启动失败时仍能启动

Status: implemented

[English](2026-11-25-desktop-starts-without-failing-plugins.md) | 中文

## 问题

`boot()` 把任何应用或激活失败的条目视为整棵树的致命错误：事务化的 Loader 回滚该组，桌面端宿主退出，应用无法打开。单个插件拒绝另一个版本存储的数据（2026-11-25 的连接器结构）就让整个桌面应用无法启动。

## 决定

`app-boot` 新增 `bootTolerant()`。启动失败后，它从错误中读出失败的条目（`failedEntries()`：每条原因链上最内层的 `failed to apply loader entry <id>`，以及激活审计现在通过 `EntriesNotActivatedError` 报告的条目），用 `{ id, disabled: true }` 补丁行停用它们并再次启动，最多 `maxAttempts` 次，因此依赖已停用条目的条目会在下一轮被停用。组的包装错误不被记录，因为停用一个组会关闭其中健康的子条目。

桌面端宿主使用它启动。`connection`、`typert-gateway`、`modules`、`webserver` 与 `desktop-http-frontend` 是必需条目，失败仍然致命；对连接、网关、客户端模块与 Web 服务器服务的现有检查也是如此。每个被跳过的条目都会记入日志，作为 `skippedPlugins` 随 `ready` 事件传出，并在外壳显示的非阻塞警告中列出。

CLI、headless 与托管配置仍使用 `boot()`：在那里缺少插件应让运行或部署明确失败。

## 考虑过的替代方案

**让内置的 Loader 不再事务化。** 这会改变上游 Cordis 对所有使用方的语义，并需要记录的 vendor 修改；重试逻辑留在自有代码中。

**在每个插件内部捕获失败。** 每个插件都需要自己的保护，没有保护的新插件会再次让应用无法启动。

## 影响

失败的插件不再阻止桌面应用启动；它提供的功能在其正常启动前不可用，警告会说明是哪些。每次重试都是一次完整启动，因此失败的启动耗时更长，上限为五次启动。
