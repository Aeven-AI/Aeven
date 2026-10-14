---
description: "内置的本地任务调度与持久执行历史。"
kind: "package-reference"
---

# @aeven/automations

[English](README.md) | 中文

## 摘要

自动任务在新的 Aeven 对话中执行已确认的工作。Web 和桌面组合默认包含此服务。用户通过普通输入框创建和调整任务；`/automations` 页面展示计划和结果。任务定义属于创建账户；每次执行保留已批准的任务版本、执行设置和结果。

## 执行

一次性、间隔、每日及指定星期的计划可设置结束时间，且使用明确的 IANA 时区。间隔至少为五分钟。日期计算代码依据 MIT 许可改编自 [titanwings/dsh-automation](https://github.com/titanwings/dsh-automation/tree/0d73a4e03639d4f63d0771ae4490e2718b7e7aa0/src)；附带的 LICENSE 保留署名。夏令时转换中不存在的本地时间会被跳过。服务在启动智能体之前持久记录执行，并跳过重叠的工作。Host 延迟运行时仅考虑最近一次计划执行；若该次执行超过配置的宽限时间，则记录为已跳过。重启后，被中断的排队或运行记录标记为失败，绝不自动重放。

Host 使用现有的账户身份、智能体预设、模型选择、工作区、连接器和凭据服务。每次执行的对话都属于服务在启动时声明的内置 Automations 工作区；它与 Chats 一样没有目录，不能重命名、移动或删除，每个账户在其中只能看到自己的执行对话。每次执行拥有以任务名称命名的独立会话和明确的插件来源。执行结束后对话保持打开，用户可以查看并继续该对话。执行结束要求持久记录的轮次正常完成，但不能证明预期工作或外部操作成功。主动重试基于原始已批准任务创建关联执行，且同一任务有活跃执行时禁止重试。通过智能体工具创建或扩大任务需要批准。执行通过用户已打开的客户端请求批准。用户在执行对话中（执行期间或之后）给出的带范围批准会保存到该任务，之后的执行遇到相同工具和范围时无需再次询问。没有打开的客户端也没有已保存的批准时，请求会拒绝执行。文件可以按照已确认的权限选项读取或编辑。

## 配置

组合配置提供 `maxConcurrentRuns`、`runTimeoutMinutes`、`misfireGraceMinutes`、`historyLimit` 和 `workspaceTitle`。内置 Web 配置允许两个并发执行，超时六十分钟，补执行宽限十五分钟，每个账户最多保留两百条已结束记录，工作区标题为 `Automations`。服务总是保留排队及运行记录，并独立保留计划执行的接纳水位。任务定义和执行记录使用现有的 storage-domain 提供者，无需独立调度进程或数据库。账户可主动移除单条已结束记录或清除已结束的历史记录，排队及运行记录始终保留。任何移除都不会删除执行对话：每条被移除记录（无论是主动移除还是超出 `historyLimit`）对应的对话会加入全局归档集，从而离开侧栏，其日志仍可阅读，并可从“已归档的对话”恢复。服务启动时还会归档 Automations 工作区中所有未被保留记录引用且尚未归档的对话。反之亦然：执行对话已归档的记录不会出现在执行历史中，对话取消归档后该记录会重新列出。

## 模型体验

### 管理工具

#### 模型看到什么

账户的根对话获得五个工具定义 `automation_create`、`automation_list`、`automation_update`、`automation_run_now` 和 `automation_retry`；执行对话一个都不会获得。每个结果都是一个文本块，内容为服务返回值的 `JSON.stringify`。创建、调整和重试在运行前会请求用户批准，并使用固定的请求理由：`Confirm this automation’s task, schedule, and allowed file access before enabling unattended work.`，重试则使用 `Inspect the earlier run before retrying: external changes may already exist.`；仅包含 `id` 和 `status` 的暂停不会询问。模型在把请求转成任务时所读到的指引就是 `automation_create` 的描述：

##### 创建描述

```markdown
Create a built-in automation after human confirmation. Translate the user’s request into a self-contained task and explicit local schedule. Ask only for missing requirements. Future runs start fresh conversations with this account’s capabilities. An external action that needs approval asks the user in the run conversation; once the user approves it there, later runs perform it without asking.
```

#### Token 影响

该根对话的每个请求都带有这五个固定定义，与账户拥有多少自动任务无关。一次调用的参数及其 JSON 结果会留在上下文中直到压缩；`automation_list` 受每个账户 `historyLimit` 条已结束记录加上全部排队及运行中记录的限制。

#### KV Cache 影响

在账户根对话的工具集合及其顺序不变时前缀稳定；这些定义不随其管理的自动任务变化。调用结果为追加式。

### 执行任务消息

#### 模型看到什么

每次执行都是一个全新对话，其第一条消息是来自 `automations` 插件的通知，携带已保存的任务以及自身的身份和验证指令。对话标题即任务名称，且执行只复用保存在该任务上的批准；它不继承源对话历史或该对话的批准授权：

##### 执行通知

```markdown
Automation: <name>
Run: <run id>
Scheduled for: <ISO timestamp>

<the approved task>

Report completed work with evidence. Do not claim an external action succeeded without confirmation.
```

#### Token 影响

该通知是执行对话的第一条用户消息，在此后每个步骤中都会随对话其余内容一起重新发送，直到压缩。每次执行还使用已保存的提供者和模型选择。

#### KV Cache 影响

追加式：通知位于该执行所用智能体预设组装出的前缀之后，并在对话保持打开期间不变。

### 运行期拒绝

#### 模型看到什么

执行对话不能创建更多无人值守的工作，也不能提出交互式问题：调用任何 `automation_*` 工具或 `ask_user` 会被守卫拒绝，模型读到 `Error: Automations cannot create more unattended work or ask interactive questions.`。执行的权限预设和批准策略都是它自己的，二者都在创建执行对话时设定。

#### Token 影响

被拒绝的调用会把这一行错误加入上下文，每次调用一次，并保留到压缩。

#### KV Cache 影响

追加式；该拒绝作为工具结果出现在可复用的请求前缀之后。

## 已知限制和后续工作

提供服务的 Host 必须运行，电脑必须保持唤醒。托管执行、操作系统启动管理、事件触发、混合交接、通知投递及持久批准续执行尚未实现。执行没有项目目录。没有请求方范围的批准会在每次执行时询问，已保存的批准暂时无法撤销。外部写入批准既未保存也未被回答的任务会拒绝执行；它们可准备文件，但无法绕过批准。版本 3 的存储域拒绝更早的数据。计划支持包含边界的结束时间；暂不支持每月、每年、自定义规则或限制时段的每小时计划。

- **无不变式伴生入口**——不发布不变式伴生入口，因为管理和调度读取相同的持久领域记录，服务不持有第二个可与之发散的观测。
