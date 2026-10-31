# Agent Note：Subagent 嵌套的用户开关

Status: implemented

[English](2026-10-31-subagent-nesting-switch.md) | 中文

## 问题

随附预设给两个委派工具都组装了 `maxDepth: 1`，因此子 agent 都是叶子：会话 agent 的深度 1 子 agent 无法再启动自己的 subagent。递归深度因此只是部署级决定，只能通过编辑 `agent.cordis.yml` 并重启 Host 来改变；而用户拥有的其他委派选择（模型选择、后台策略）都已经有设置入口。

## 决定

`avn-tool-subagent` 新增 `nestingSettings` 标志，在每次委派启动时读取宿主所有的 `subagent-nesting` 用户设置。该设置只有一个布尔值 `enabled`，由 `@aeven/tool-subagent/nesting-settings` 提供，并在插件设置页编辑。关闭时，工具把每次启动固定到深度一，这正是把子 agent 变成叶子的原因；开启时，组装的 `maxDepth` 就是上限。随附预设给 `subagent` 与 `subagent_fork` 两行组装 `maxDepth: 2` 与 `nestingSettings: true`，因此开启开关后，深度 1 的子 agent 可以启动深度 2 的子 agent，后者再无可委派。

开关是实时读取的，而不是按顶层 Session 采样。模型选择之所以采样并记录为 `subagent/model-selection-policy`，是因为它改变面向模型的工具 schema：运行中的 Agent 定义必须保持固定，恢复的 Session 必须重建同一 schema。嵌套既不改变 schema 也不改变提示文本：它只决定某次启动是否被接受，而这件事会话记录已经以工具调用及其结果的形式记下。因此实时读取无需 Session 事件，保存后立即作用于已在运行的 agent 及其随后启动的子 agent。子 agent 继承父级的预设，其自身的委派工具因此解析同一个宿主单例，无需把开关副本穿过日志。

能力本身仍在原处。提供方依据 `request.maxDepth` 执行深度上限，工具只决定发送哪个数值。`nestingSettings` 要求数值型 `maxDepth` 以及宿主作用域内的设置服务，否则在挂载时失败：进程外提供方拥有自己的递归预算，而未组装的服务会让开关静默失效。

## 考虑过的替代方案

**只把深度上限留在部署配置里，通过预设暴露。** 否决，因为需求是一个面向用户的开关，而预设改动只有经过 Host 重启才能到达用户。

**按顶层 Session 采样开关，并像模型选择那样继承。** 否决为无用机制：该设置不改变任何面向模型的定义，记录策略只会重复实时读取已经给出的答案，而且设置编辑会毫无用户可见理由地只对新 Session 生效。

**把「关闭」表达为调用方 agent 的 `maxDepth: 0`。** 否决，因为上限是针对子 agent 解析出的深度执行的，而不是父级的，零会禁止顶层 agent 自己的委派，而不是子 agent 的。

**关闭时保留组装的深度上限，只在提示中约束嵌套。** 否决：提示不是强制手段，而告诉模型忽略一个已配置的上限，是提供方无法兑现的谎话。

## 后果

嵌套现在是用户决定，并且作用于已在运行的 agent，因此子 agent 能到达的深度不再取决于它由哪个 Session 启动。想要固定叶子的部署把预设上限改为一并去掉 `nestingSettings`，即可完整重现此前的组装。预设的 `maxDepth: 2` 是开关只能向下收紧的上限，因此切换时任何现存子 agent 都无需重新组装。

因为开关不写入日志，还原某次启动当时被允许什么，需要部署的设置文档：会话记录只记下启动及其结果，不记下放行它的策略。开启的部署也会为孙 agent 花掉真实 token——两层委派会让一个任务扇出的 Session 成倍增加，而每个子 agent 都拥有自己的上下文窗口——因此约束失控递归的仍是上限，而不是开关。
