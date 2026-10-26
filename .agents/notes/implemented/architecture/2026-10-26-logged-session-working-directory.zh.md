# Agent Note：会话工作目录是日志状态，不是头部元数据

状态：已实现

[English](2026-10-26-logged-session-working-directory.md) | 中文

## 问题

会话在某个目录中创建，并把该目录记录在不可变的头部元数据里。所有 shell 与文件工具都从头部解析工作目录，因此目录在整个会话生命周期内固定：agent 只能通过在 shell 命令内加 `cd` 前缀来换目录，而这对下一次调用无效，也没有工具能把会话移入检出或工作树。

移植目标为 DeepSeek Harness 的 `working_directory` 工具及其 Git Worktrees 插件。它们的会话目录是可变更字段；Aeven 的目录是头部元数据，`SESSION_FORMAT_VERSION` 固定为 `0` 且没有兼容承诺。只复制工具而不复制它所改变的状态，会得到一个报告目录、而 harness 其余部分无视该目录的工具。

## 决策

`@aeven/working-directory` 以容量形式拥有生效目录：`session/cwd` 事件记录绝对目录，只进日志、非 surface、按最后一条重放，服务回答

```
of(session) = last logged session/cwd ?? session.header.cwd
```

`resolve` 对绝对路径做规范化，对相对路径相对于 `of()` 解析，因此连续变更像 shell 的 `cd` 那样叠加。`change` 要求目录存在、追加事件并返回绝对路径；空目标、缺失路径或普通文件会抛错并点出该路径，目标已在生效状态时不追加任何事件。

`@aeven/tool-working-directory` 将其作为模型可见的 `working_directory` 工具暴露，四个 shell 工具通过 `ctx.get('workingDirectory')?.of(session)` 解析，并以头部作为回退，因此没有该插件的组合行为与之前完全一致。

## 考虑过的替代方案

**会话对象上的可变更字段。** 它最贴近移植来源，但既不持久也无法重建：恢复会丢掉它，分叉不会继承它，重放的会话会作用在日志无法解释的目录里。harness 的规则是模型可见状态来自日志。

**在终端会话里持久化一个 shell 专属的 `cd`。** 它只覆盖 `bash` 与 `pwsh`，文件、搜索与 MCP 工具各自解析；它还把目录变成终端的属性而不是会话的属性，于是有两个终端的会话会有两个答案。

**把目录放进请求头部。** 头部按请求比较缓存键身份；在一个回合内改变的目录会为一个模型从未看见的事实使 KV 缓存失效。把它排除在请求之外，也让会话移动时提示保持不变。

## 影响

- `session/cwd` 进入持久化目录与已知事件类型；`SESSION_FORMAT_VERSION` 保持 `0`，因为没有信封或格式变化。
- 投影单元 `workingDirectory` 为客户端而存在，因此重新加载或分叉的会话渲染日志记录的目录。
- 仍直接读取 `session.header.cwd` 的消费者固定在创建目录。四个 shell 工具已迁移；文件、搜索与 MCP 工具是机械后续工作，并记录在包 README 的局限中。
- `change` 不强制沙箱限制。受限组合在拥有限制的策略中拒绝根外目标，那是该判断本就归属的地方。
- Git Worktrees 工作依赖于此：`create_worktree` 在 `git worktree add` 之后用 `change` 移动会话。
