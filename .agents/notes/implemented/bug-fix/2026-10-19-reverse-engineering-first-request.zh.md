# Agent Note: 逆向工程初始化在后台安装

Status: implemented

[English](2026-10-19-reverse-engineering-first-request.md) | 中文

## 问题

已安装的 `reverse-engineering` 账户技能的首次请求初始化，运行在 `@aeven/account-integrations` 的 `agent/pre-step` 监听器里，并在 `next()` 之前被等待。因此，凡是账户启用了该技能的 agent，其每个模型请求都要等待一整套私有工具链安装完成——570 MB 的 Ghidra 归档与 200 MB 的 JDK、`npm install rea-agents`、解压以及一次 doctor 运行——预算为 900 秒。任何一步失败都会从监听器抛出，于是整个回合以 `turn/end {reason: {kind: error}}` 结束；而失败的那次尝试会删除暂存目录，所以下一回合又把一切重新下载一遍。

凡是走到这一步的运行都失败了。就绪判定把 `rea doctor` 的非零退出码当作初始化失败，但该 doctor 对本集成永远不会满足的信息性检查也会返回非零：可选引擎（Hopper、IDA、jadx、Kuna）、REA 自己安装的技能副本，以及其他客户端的 MCP 注册。因此即使 Ghidra 完全正常也无法通过，而抛出的原因还是空的——`reverse-engineering setup failed (/path/to/node): `——因为消息只带上了子进程的 stderr，而点名失败检查的 doctor JSON 报告写在 stdout。

`$AVN_HOME/sessions` 中有一个会话记录下了代价：它的第 11 回合正常完成，而第 12、13 回合各运行约 130 秒，以那个空原因的错误结束，并重新下载了归档。这段对话里的每条消息都挂起两分钟然后失败。

## 决定

`agent/pre-step` 只在后台启动工作，不再等待它。`ReverseEngineeringRuntime.start(agent)` 在后台开始共享安装，通过 `ctx.logger('account-integrations')` 记录失败，并记下失败时刻。后续请求只有过了 `reverseEngineering.retryDelayMs`（默认 600 000 毫秒；为零时每个请求都重试）才会再次尝试。不会因为初始化失败而让请求失败：安装完成后，`mcp__rea__*` 工具才会为该 agent 连接；在此之前由技能的 shell 路由作答。

共享安装不再继承首个调用者的请求 signal。`prepare` 只在运行时的生命周期与 `timeoutMs` 之下运行 `install()`，调用者的 `signal` 只结束该调用者自己的等待，不会取消与其他 agent 共享的工作。

就绪判定改为解析 doctor 的 JSON 报告，要求所请求的 provider 检查项 `ghidra` 为 `available` 且没有失败的 provider 检查。进程退出码被忽略，因为信息性检查总会把它置为非零，而它们并不代表这次部署的就绪状态。初始化失败现在会带上子进程的 stdout 与 stderr；若 doctor 没有打印可解析的报告，错误里会引用其输出，而不是留下空原因。

## 备选方案

**继续等待安装，只修 doctor 判定。** 否决，因为首个请求仍会为一个可能永远用不上的下载等待数分钟，真正的失败仍会让回合失败。

**把分析工具链随应用一起发布。** 否决：这次部署不发布 REA 或 Ghidra，安装是按账户私有地写入 `$AVN_HOME` 的。

**失败后每个请求都重试。** 否决，因为每次重试都要重复失败尝试删掉的全部下载，正是它把一次坏掉的初始化变成了每条消息两分钟的开销。

## 结果

- 启用技能后的首个请求在返回时不带 REA 工具；它们会在该 agent 之后的某个请求出现，期间由技能的 shell 路由覆盖这些工作。
- 初始化失败只出现在宿主日志里，不出现在对话中，因此记录不会告诉使用者工具不可用及其原因。
- 在 darwin/arm64 上，官方 `Ghidra_12.1.4_build` 归档只在 `os/linux_x86_64` 与 `os/win_x86_64` 下提供原生反编译器，因此 doctor 的 `native_decompiler` 检查失败，在 REA 提供 macOS 构建之前初始化无法认证 Ghidra。运行时通过同一条后台日志与重试路径报告这一点。
- 启用技能会在后台下载约 770 MB。禁用技能不会取消已经在进行的下载。
