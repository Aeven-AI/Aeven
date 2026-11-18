# Agent Note：发给子代理的消息会加载其父级

Status: implemented

[English](2026-11-18-subagent-messages-load-their-parent.md) | 中文

## 问题

`subagent.prompt` 只在子级的直接父级 Agent 在线时接受浏览器消息，目录的 `parentAvailable` 也正好报告这一点。Host 在有人向某个 Session 发送消息时才加载其 Agent，浏览器显示它时不会加载；因此每次 Host 启动后，未打开的父级下的每个可继续子级都显示 "This subagent is read-only for now — The parent session is offline; reopen it to continue sending messages"。打开父级并不能改变这一点，所以这段文案指出的操作没有帮助。

## 决定

- `SubagentRuntime.registerPromptPreparer(preparer)` 接受一个随 effect 生命周期注册的准备器，使发给可继续子级的浏览器消息可在本设备投递，并返回在线的父级。`subagent.prompt` 对每条消息调用它，然后执行原有的所有权检查与投递。
- `@aeven/api-session-controller` 注册该准备器。它先用 `SessionCommandController.claimSession()` 认领子级 Session：Host 启动后，包括子级在内的每个 Session 在本设备认领前都是只读的同步副本，恢复未认领的子级会以 `subagent/not-resumable` 失败。随后它返回在线的父级，或用 `claimAgent()` 加载父级：认领父级，并按与直接发给父级的消息相同的所有权规则、预设与初始化加载它。由账户的另一台设备运行的子级或父级，或 Session API 无法加载的父级——例如属于其他账户或本身是子代理的父级——返回 `subagent/parent-unavailable`，Host 会记录原因。
- 注册了准备器后，目录对每个父级都报告 `parentAvailable: true`，因此可继续子级总是显示常规输入框。只读输入框保留给一次性子级以及没有准备器的部署。

## 考虑过的方案

- **打开子级会话时加载父级。** 已拒绝：每次查看子级都会加载一个读者可能从不发消息的 Session。
- **只改写横幅文案。** 已拒绝：读者仍需先在别处发送消息，才能回复子级。
- **由 `@aeven/subagent` 直接调用 Session API。** 不可行：`@aeven/api-session-controller` 已依赖 `@aeven/subagent`，所以依赖通过注册反向建立。

## 影响

向未加载父级下的子级发送第一条消息时，需要等待父级 Agent 加载。若父级无法加载，发送会通过输入框的常规错误行为失败，而不是事先被阻止。父级由模型发出、发给不在线子级的 `send_message` 不认领子级，因此不具备这一行为。
