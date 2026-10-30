<!-- 由 scripts/gen-tool-catalog.ts 生成——请勿手动编辑。
     运行 `pnpm run gen-tool-catalog` 重新生成。 -->

# 工具 Schema 目录

[English](tool-catalog.md) | 中文

已发布插件向 `ctx.tools` 提供的所有面向模型的工具：模型通过系统提示词组装获得的 `name`、`description` 和 JSON Schema `parameters`。本目录是[子系统页面](subsystems/core.zh.md)（类型及每页生成的 `cordis-surface` 接线区域）的补充；本页列出的是向 agent（智能体）提供的*工具*。

英文源文件由系统**生成**，并通过 `pnpm run verify-tool-catalog`（`doc-sync`（文档同步门禁）的一部分）验证新鲜度；本中文文件作为经评审对侧通过双语配对维护。与 Cordis 目录（纯源码 AST 处理）不同，英文生成器会在真实上下文中**启动**每个工具插件并读取 `ctx.tools.schemas()`，因为工具 schema 无法通过静态分析完全确定，例如运行时展开的枚举、拼接的描述、由配置决定的名称以及使用原始 JSON Schema 的 MCP 工具。完整性守卫会 glob 匹配 `packages/*/tool-*`；如果生成器的启动 manifest（元数据清单）遗漏任何包，检查就会失败，因此新工具不会在无人察觉的情况下缺少文档。参见[工具 schema 目录 Agent Note](../.agents/notes/implemented/process/2026-07-02-tool-schema-catalog.zh.md)。

范围：`packages/*/tool-*` 下已发布的产品工具，每个工具均使用其**默认**配置启动；但如果某个 Config 字段是**必填项**且没有默认值，生成器就必须作出选择，对应包的说明会记录本页展示的是哪个分支。注册的工具**名称**可以是加载时配置，例如 `tool-subagent` 的 `toolName`，因此部署可能以不同名称或额外名称提供某个包；如果存在随产品发布的别名，对应包的说明会予以记录。`examples/` 中的演示工具（例如 `echo`）不在范围内，这与 Cordis 目录仅涵盖包的范围一致。

<a id="tool-package-map"></a>

## 工具包映射

下表将模型可见的工具名称与其背后的插件包和服务 seam 对应起来。各包章节随后给出确切的 JSON Schema。

| 工具包 | 模型可见名称 | 依赖 | 写入／影响 | 随产品发布的别名 | 部署说明 |
| --- | --- | --- | --- | --- | --- |
| `@aeven/tool-ask-user` | `ask_user_question` | `ctx.tools`、`ctx.userQuestions` | `tool/call`、`tool/result after a UI/provider answers the question` | - | ask_user_question 会暂停工具调用，直到当前 UI 提供方返回人类答案。 |
| `@aeven/tools` | `run_code` | `ctx.tools`、`ctx.codeRuntime (execution time)`、`ctx.systemPrompt` | `tool/call`、`one tool/code-dispatch-start + tool/code-dispatch pair per bridged sub-call`、`tool/result` | - | 在 `mode: ptc`／`mode: both` 下，它由工具注册表所有，作为可过滤能力层之外的保留传输机制（参见 PTC mode Agent Note）。在 `ptc` 下，它是注册表对协议格式（wire format）的唯一贡献；其他可见能力在使用已加载运行时语言生成的 SDK 章节中声明。程序通过 binding 调用这些能力，调用按照原生并发约定调度：启动顺序和策略遵循提交顺序，并发安全的函数体最多重叠执行 `maxParallelSubCalls` 个。调用会重新进入完整且受守卫保护的工具流水线，并将每个嵌套执行关联到此外层结果。 |
| `@aeven/plan-mode` | `exit_plan_mode` | `ctx.tools`、`ctx.systemPrompt`、`ctx.userQuestions (execution time, opportunistic)` | `tool/call`、`plan/mode inactive on an approved review`、`tool/result` | - | 规划未激活时，exit_plan_mode 仍保留在面向模型的 schema 中，这样状态转换不会在规划策略变更之外额外造成工具目录变动。其执行路径会拒绝规划模式之外的调用；在规划模式下，它通过用户交互 seam 提交计划（批准／根据反馈继续规划），批准后会在步骤边界记录规划模式已停用。 |
| `@aeven/tool-bash` | `bash` | `ctx.tools`、`ctx.shell`、`ctx.systemPrompt`、`ctx.shellEnv`、`ctx.jobs at call time for run_in_background` | `tool/call`、`tool/result` | - | bash 工具是 bash 执行器 seam 面向模型的消费方。使用 `run_in_background` 的运行会注册到通用 `ctx.jobs` 运行时，并通过 `job_*` 工具（来自 `@aeven/tool-jobs`）收集／停止；禁用 `enableRunInBackground` 配置（默认为 true）后，该参数会被完全移除。 |
| `@aeven/tool-pwsh` | `pwsh` | `ctx.tools`、`ctx.shell`、`ctx.systemPrompt`、`ctx.shellEnv`、`ctx.jobs at call time for run_in_background` | `tool/call`、`tool/result` | - | pwsh 工具是 Windows 组合中 bash 执行器 seam 的 PowerShell 方言消费方（由 `@aeven/pwsh-local` 等 PowerShell 执行器为 `ctx.shell` 提供后端）；除沙箱接口外，它逐项对应 bash 工具调用。使用 `run_in_background` 的运行会注册到通用 `ctx.jobs` 运行时，并通过 `job_*` 工具收集／停止；托管的 `AVN_*` 环境来自 `@aeven/shell-env`。每次调用都在新进程中运行，不使用持久 PTY 会话。路径采用原生 `C:\...` 形式，变量采用 `$env:NAME`。 |
| `@aeven/tool-cordis` | `cordis_define`、`cordis_inspect_list`、`cordis_inspect_query`、`cordis_inspect_self`、`cordis_run`、`cordis_stop`、`cordis_undefine` | `ctx.tools`、`ctx.dynamicCordisRunner` | `tool/call`、`tool/result`、`process-local dynamic package lifecycle` | - | 不在任何随产品发布的树中，需要显式选择启用；动态 Package 代码可以访问真实运行时，见 .agents/notes/implemented/feature/2026-07-08-self-referential-cordis-toolset.md。该工具集注入 `@aeven/cordis-host-runner` 提供的 `ctx.dynamicCordisRunner`，后者拥有定义注册表和 vm 沙箱；组合缺少它时这些工具不会激活。运行中的 Package 在停止、undefine 或 AVN 重启前可以注册**额外的**模型可见工具；发生这类工具集变化时，系统会记录完整且有变动的请求头。 |
| `@aeven/tool-bash-persistent` | `bash` | `ctx.tools`、`ctx.terminals`、`an owning Agent at execution time` | `tool/call`、`PTY shell state`、`tool/result` | - | 一个按所有者隔离的持久 bash 工具；部署组合提供 PTY 后端，并可覆盖面向模型的环境描述。 |
| `@aeven/tool-pwsh-persistent` | `pwsh` | `ctx.tools`、`ctx.terminals`、`an owning Agent at execution time` | `tool/call`、`PTY shell state`、`tool/result` | - | 一个按所有者隔离的持久 pwsh 工具，持久 bash 工具的 Windows 对应物；部署组合提供 pwsh 方言的 PTY 后端，并可覆盖面向模型的环境描述。 |
| `@aeven/tool-str-replace-editor` | `str_replace_editor` | `ctx.tools`、`ctx.fs` | `tool/call`、`fs/observed after view presence/absence, edit absence, or successful mutation`、`tool/result` | - | 基于文件系统 seam 的独立查看／创建／唯一字面量替换／按行插入工具；可与任何 shell 或终端接口组合。 |
| `@aeven/tool-fs` | `edit`、`read`、`read_image`、`write` | `ctx.tools`、`ctx.fs`、`ctx.systemPrompt`、`ctx.attachments (image-tool registration)`、`ctx.llm + an image-capable route (image-tool execution)` | `tool/call`、`fs/write-intent or fs/edit-intent for mutations`、`fs/observed after read presence/absence or successful file operation`、`durable attachment (read_image)`、`tool/result` | - | 先读后写／编辑策略由 `@aeven/fs-observation-policy` 添加；它是一个 `fs/*` 事件门禁插件，不会改变 schema。加载这些工具的部署按预期也应加载该插件。没有 `ctx.attachments` 时图片工具不会注册；其 schema 与路由无关，执行时除非确切路由的模型声明图片输入，否则拒绝。 |
| `@aeven/tool-fs-search` | `glob`、`grep` | `ctx.tools`、`ctx.subprocess`、`ctx.systemPrompt` | `tool/call`、`tool/result` | - | glob 和 grep 是无条件可用的发现工具，通过 ctx.subprocess spawn 随包提供的 ripgrep 二进制文件（`@vscode/ripgrep`），并作为普通前台调用运行，绝不作为后台任务；无需在宿主机安装 `rg`，也不经过 shell 层。本目录使用 `sampleOverCapGlobResults: true`；部署必须显式选择该行为。结果超过上限时，会通过可选的 ctx.spillStore 后端保存完整的格式化列表；在共置部署中，如果后端公开本地路径，返回的定位信息可供后续读取／搜索。 |
| `@aeven/tool-terminal` | `terminal_close`、`terminal_list`、`terminal_open`、`terminal_read`、`terminal_send`、`terminal_signal` | `ctx.tools`、`ctx.terminals`、`ctx.systemPrompt`、`ctx.jobs at call time for run_in_background` | `tool/call`、`tool/result` | - | 这 6 个终端工具需要选择启用，用于补充一次性 bash／文件系统工具。`terminal_send(run_in_background: true)` 会注册到 `ctx.jobs`；schema 不包含 TUI、具名按键序列、BEL、调整尺寸、自动启动和跨 agent 共享。 |
| `@aeven/tool-goal` | `create_goal`、`get_goal`、`update_goal` | `ctx.tools`、`ctx.agents`、`ctx.goals`、`ctx.systemPrompt`、`a calling Agent in an authorized open turn` | `tool/call`、`goal/change for mutations`、`tool/result` | - | create、edit、pause 和 resume 要求直接来自人类的根权限；complete 和 blocked 也接受确切的当前 Goal Round。blocked 的默认下限是 3 个获准的 Round。 |
| `@aeven/schedule` | `schedule_create`、`schedule_delete`、`schedule_list` | `ctx.tools`、`ctx.sessions`、Session 持久化、未来创建的 live 根 Agent | `tool/call`、`schedule/change create or delete`、`tool/result` | - | 仅在选择启用的 Schedule 插件加载后创建的 live 根 Agent scope 内注册。版本 1 接受 after_seconds、显式绝对 at 和有界固定速率 every_seconds，并披露 session-local 交付；管理读取与变更必须通过共享的 Session 持久化 barrier。 |
| `@aeven/tool-lsp` | `lsp` | `ctx.tools`、`ctx.lsp`、`ctx.systemPrompt` | `tool/call`、`tool/result` | - | lsp 工具将提供方选择和语言服务器子进程置于 ctx.lsp 之后，因此其模型可见 schema 在更换提供方时保持稳定。运行时要求已注册提供方，例如 `@aeven/lsp-stdio`；如果没有提供方，查询会返回结构化 `LSP_UNAVAILABLE` 错误，而不会改变 schema。 |
| `@aeven/tool-vcs` | `git_branch`, `git_commit`, `git_diff`, `git_log`, `git_merge`, `git_remote`, `git_status` | `ctx.tools`, `ctx.vcs`, `a calling Agent with a session working directory` | `tool/call`, `tool/result` | - | The git tools keep provider selection and git subprocesses behind ctx.vcs, so their model-visible schemas stay stable across providers. Requires a registered provider (e.g. `@aeven/vcs-git`) at runtime; without one, every call returns the structured `VCS_UNAVAILABLE` error rather than changing the schema. |
| `@aeven/tool-ralph` | `ralph` | `ctx.tools`、`ctx.workflowEngine`、`ctx.subagents`、`ctx.systemPrompt`、`a calling Agent (exec.agent parents every fresh round)` | `tool/call`、`tool/result`、`workflow and child session events during execution` | - | 固定的前台工作流会在每个 Round 启动一个全新的结构化子级；模型只能选择不可变目标和可选的 Round 上限。 |
| `@aeven/tool-skill` | `skill` | `ctx.tools`、`ctx.agents`、`ctx.skills` | `tool/call`、`tool/result`、`user/message replacement catalogs via agent.inject()` | - | - |
| `@aeven/tool-search` | `tool_search` | `ctx.tools`、`ctx.systemPrompt`、`mcp/servers listeners (opportunistic)`、`ctx.codeRuntime (opportunistic, for run_code declarations)` | `tool/call`、`tool/result`、`one plugin user message when the deferred tool index changes` | - | 只有在至少有一个工具被延迟、或至少一台执行延迟的 MCP 服务器未在服务时才呈现给模型。关键词查询只列出工具而不加载它们；`select:` 把 schema 加载到后续请求中，或在该请求呈现 `run_code` 时返回 SDK 声明；`restart:` 重新连接一台 MCP 服务器。 |
| `@aeven/tool-session-query` | `session_event_read`、`session_event_search`、`session_event_trace`、`session_search`、`session_trace` | `ctx.tools`、`ctx.systemPrompt`、`ctx.sessionQuery`、`a calling Agent for workspace authority` | `tool/call`、`tool/result` | - | 这 5 个只读工具会隐藏提供方游标，并根据不可变的调用 agent 会话为每个结果授权。该包需要选择启用；需要强制截止时间或限制行内输出的组合还会挂载通用超时或 spill 策略。 |
| `@aeven/tool-subagent` | `list_subagent_models`、`subagent` | `ctx.tools`、`ctx.subagents`、`ctx.systemPrompt`、`用于模型发现和所选路由校验的 ctx.llm` | `tool/call`、`tool/result`、`child session events through the chosen provider` | `subagent`、`subagent_fork` | 注册的委派工具名称取决于加载时 `toolName` 配置（默认为 `subagent`）；上述默认 schema 关闭模型选择，而发现 schema 则展示为已启用 Session 中可用的固定配套工具。Web preset 会在每个新顶层 Session 创建时读取插件页偏好，并为其子 Session 保留该决定；`subagent_fork` 始终使用固定路由。每个实例通过 `modelSelectionSettings`、`backgroundMode` 与 `enableRunInBackground` 独立控制是否读取模型选择设置及其后台行为。 |
| `@aeven/tool-subagent-control` | `interrupt_agent`、`list_agents`、`send_message` | `ctx.tools`、`ctx.subagents`、`ctx.agents and ctx.sessionProjections (list_agents only)` | `tool/call`、`tool/result`、`child session events through ctx.subagents` | - | 这些是控制可继续后台 subagent 的全局命名工具：绑定提供方的 `tool-subagent` 实例注册不同的委派工具；本包注册一次 `send_message` 和 `interrupt_agent`，另由 `list_agents` 通过单独加载的 `/list-agents` 插件提供，其目录行使用 sessionProjections 和实时 Agent 注册表。 |
| `@aeven/tool-jobs` | `job_kill`、`job_list`、`job_output` | `ctx.tools`、`ctx.jobs`、`ctx.systemPrompt` | `tool/call`、`tool/result`、`user/message via agent.inject() for background completion notices` | - | 与任务种类无关的后台任务控制器：后台 bash 命令、PTY 发送和 subagent 都通过相同的 3 个工具读取、列出和终止。加载该插件会挂接控制器，从而启用生产方的 `ctx.jobs.start()`。 |
| `@aeven/experimental-tool-agent-team` | `followup_task`、`interrupt_agent`、`list_agents`、`send_message`、`spawn_teammate`、`team_task_create`、`team_task_get`、`team_task_list`、`team_task_update`、`wait_agent` | `ctx.tools`、`ctx.systemPrompt`、`ctx.agentTeams`、`an exact live Team member Agent` | `tool/call`、`team/member`、`team/message/queued`、`team/message/delivered`、`team/task`、`tool/result` | - | 这 10 个工具限定于隐式 Team Lead 与持久 teammate 作用域。随产品发布的 avn-base bundle 默认禁用该包；文档中的 Agent Teams profile patch 会启用它，并禁用旧 continuable child 的同名控制工具。 |
| `@aeven/tool-media` | `generate_image`、`generate_video` | `ctx.tools`、`ctx.media`、`ctx.attachments` | `tool/call`、`tool/result carrying one image block per stored image` | - | 本目录以未配置模型的形态挂载该工具，这种形态要求每次调用自行指明模型。设置了 `model` 的部署得到的是同一份 Schema；默认值不会进入描述。生成的字节经 `ctx.attachments` 存储，因此结果携带的图像块无需在此注册任何东西即可被会话卡片渲染。 |
| `@aeven/tool-working-directory` | `working_directory` | `ctx.tools`、`ctx.workingDirectory`、`owning Agent session` | `tool/call`、`session/cwd`、`tool/result` | - | 本目录同时挂载该容量与该工具，因为工具读取的目录由服务解析。一次变更追加 `session/cwd`，按最后一条重放：恢复或分叉的会话继续在日志记录的目录中，下一次调用相对于它解析相对路径。 |
| `@aeven/tool-worktrees` | `create_worktree`, `remove_worktree` | `ctx.tools`、`ctx.subprocess`、`ctx.workingDirectory`、`ctx.worktrees`、`owning Agent session` | `tool/call`、`session/cwd`、`worktree/entered`、`worktree/removed`、`tool/result` | - | 本目录同时挂载该能力与工具，因为 `create_worktree` 和 `remove_worktree` 通过 `workingDirectory` 移动会话，而同一次调用随后报告该目录。检出目录、分支前缀、git 宽限期、子智能体隔离和依赖准备都是无默认值的 Config；基础 bundle 把检出放在 `$AVN_HOME/worktrees` 下，为分支添加 `avn/` 前缀，隔离子智能体，并用检出中锁文件对应的包管理器安装依赖。 |
| `@aeven/tool-todo` | `todo_write` | `ctx.tools`、`owning Agent session` | `tool/call`、`todo/write`、`tool/result` | - | todo_write 是会话所有的状态；UI 将最新的 todo/write 事件渲染为检查清单。`allowParallelInProgress` 是没有默认值的必填项，因此本目录明确选择 `true`，对应描述允许同时存在多个 `in_progress` 项。选择 `false` 的部署会获得同一工具，但描述会要求只能有 1 个活动任务。 |
| `@aeven/tool-workflow` | `workflow` | `ctx.tools`、`ctx.workflowEngine`、`ctx.systemPrompt`、`a calling Agent (exec.agent parents the script children)` | `tool/call`、`tool/result` | - | - |
| `@aeven/tool-web` | `web_fetch`、`web_search` | `ctx.tools`、`ctx.web`、`ctx.systemPrompt` | `tool/call`、`tool/result` | - | web_search 和 web_fetch 将提供方选择置于 ctx.web 之后，使模型可见 schema 在更换后端时保持稳定。 |
| `@aeven/tool-browser` | `preview_back`、`preview_click`、`preview_evaluate`、`preview_forward`、`preview_navigate`、`preview_press`、`preview_reload`、`preview_screenshot`、`preview_scroll`、`preview_sequence`、`preview_snapshot`、`preview_status`、`preview_type`、`preview_upload` | `ctx.tools`、`ctx.agents`、`a browser/automation listener (execution time)` | `tool/call`、`tool/result` | - | preview_* 调用由持有该会话浏览器的客户端应答；每次调用都受工具超时上限约束。 |
| `@aeven/tool-read-aloud` | `read_aloud` | `ctx.tools` | `tool/call`, `tool/result` | - | The tool is a pure instruction: it logs the switch it was given and speaks nothing on the Host. The Web Surface reads the settled call and moves its own reader, so the model can start language practice without a Session event of its own. |
| `@aeven/tool-location` | `get_location` | `ctx.tools`、`ctx.agents`、`a location/request listener (execution time)` | `tool/call`、`tool/result` | - | get_location 由显示该会话的客户端在读者做出选择后应答；该调用受工具超时上限约束。 |
| `@aeven/tool-capability` | `capability_manage` | `ctx.tools`、`ctx.systemPrompt`、`ctx.capabilities`、`ctx.llm`、`ctx.memory (default store)`、`an Agent whose session has an owner at execution time` | `tool/call`、`tool/result`、`capabilities/changed for the capabilities store`、`long-term memory for a learned procedure under the default store` | - | 注册的 action 取决于加载时的 `store` 配置：默认的 `memory` 会把学到的流程保存为长期记忆，且只注册 `learn` 与 `import`；`capabilities` 则把它保存为能力文件，并注册 list、view、learn、update、write_file、report、retire 与 restore。学习器与流程回忆都运行在同一包内，本身不贡献任何工具。 |
| `@aeven/tool-device` | `device_close`、`device_list`、`device_open`、`device_screenshot` | `ctx.tools`、`ctx.devices (execution time)`、`ctx.attachments + ctx.llm on an image-capable route (device_screenshot)`、`a calling Agent for per-session device ownership` | `tool/call`、`tool/result`、`the session's device pane state`、`a durable image attachment for a screenshot` | - | 这 4 个工具在每个 Host 上都会注册；缺少 `ctx.devices`、关闭设备支持或没有 agent 访问权限的部署会返回各自的固定语句，而不是隐藏该工具。驱动设备要通过 `device_open` 返回的 agent-device CLI，而不是为每种设备操作提供一个工具。 |
| `@aeven/tool-elevation` | - | `ctx.tools`、`ctx.approval`、`ctx.subprocess`、`a Windows host` | `tool/call`、`tool/result` | `elevated` | 仅限 Windows 的工具：用户在 Aeven 中批准这次运行，并在操作系统的授权提示中再次批准；拒绝会使调用失败，而不会以调用方自身的权限运行该命令。在非 Windows 上挂载本包的组合不会向模型提供任何内容。 |
| `@aeven/tool-image-search` | `find_images` | `ctx.tools`、`ctx.attachments`、`ctx.llm`、`ctx.web (execution time)` | `tool/call`、`one durable image attachment per photograph or card`、`tool/result` | - | `find_images` 先读 Wikimedia Commons，再读 Web seam，因此没有 Web 提供方的部署仍能作答，并引用 Commons 所持有的照片。每张照片和每张新闻卡片都会成为持久图像附件，由客户端在 transcript（文本记录）中展示。 |
| `@aeven/tool-mail` | `mail_accounts`、`mail_read`、`mail_search`、`mail_send`、`mail_update` | `ctx.tools`、`ctx.mail`、`a session owner with at least one usable mail account`、`a calling Agent for account addressing and approval routing` | `tool/call`、`tool/result`、`mail folder and message changes through ctx.mail`、`a saved attachment file inside the workspace` | - | 只有当某个 agent 的会话所有者至少有一个可用邮箱账户时，这些工具才会为该 agent 注册，因此未登录的会话或没有邮箱的所有者看不到任何邮件工具；发送与永久删除通过 ctx.approval 询问，其他策略给出的拒绝仍然优先。 |
| `@aeven/tool-memory` | `memory_environments`、`memory_get`、`memory_remember`、`memory_remember_bulk`、`memory_search`、`memory_skill`、`memory_skills`、`memory_timeline` | `ctx.tools`、`ctx.memory` | `tool/call`、`tool/result`、`remembered facts on memory_remember and memory_remember_bulk` | - | 只在记忆提供方处于活动状态时才会注册；`memory_remember` 存储一条事实，`memory_remember_bulk` 以原子方式存储一批已提炼的事实。 |

<a id="aeventool-ask-user"></a>

## `@aeven/tool-ask-user`

### `ask_user_question`

继续操作前，如果需要确认、选择或缺失的信息，请向用户提出简明问题。发送一个或多个问题，每个问题都带一个稳定 id，该 id 会在答案中原样返回。

```json
{
  "type": "object",
  "properties": {
    "questions": {
      "type": "array",
      "description": "Questions to ask the user before continuing.",
      "items": {
        "type": "object",
        "additionalProperties": true,
        "properties": {
          "id": {
            "type": "string",
            "description": "Stable id for this question; echoed in the answer."
          },
          "question": {
            "type": "string",
            "description": "The specific question to ask the user."
          },
          "header": {
            "type": "string",
            "description": "Optional short heading for the question, such as \"Confirm\" or \"Choose Mode\"."
          },
          "options": {
            "type": "array",
            "description": "Optional choices to show the user. If you recommend one, put it first and append \"(Recommended)\" to that label.",
            "items": {
              "type": "object",
              "additionalProperties": true,
              "properties": {
                "label": {
                  "type": "string",
                  "description": "Short user-facing option label."
                },
                "description": {
                  "type": "string",
                  "description": "One sentence explaining the tradeoff or impact."
                }
              },
              "required": [
                "label"
              ]
            }
          },
          "multi_select": {
            "type": "boolean",
            "description": "Whether the user may select more than one option. Defaults to false."
          }
        },
        "required": [
          "id",
          "question"
        ]
      }
    }
  },
  "required": [
    "questions"
  ]
}
```

来源：[`packages/interaction/tool-ask-user/src/index.ts`](../packages/interaction/tool-ask-user/src/index.ts)

ask_user_question 会暂停工具调用，直到当前 UI 提供方返回人类答案。

<a id="aeventools"></a>

## `@aeven/tools`

### `run_code`

针对可用工具执行 TypeScript 程序。接受两个必填参数：`code`，即异步函数的**函数体**（仅使用可擦除语法；支持顶层 `await` 和 `return`）；以及 `description`，简要说明该程序做什么。请根据系统提示词中的声明，以 `await tools.name(args)` 形式调用工具。只有打印或返回的内容属于程序输出，请谨慎筛选。含图片的子工具结果会在运行结束后附加。

```json
{
  "type": "object",
  "properties": {
    "code": {
      "type": "string",
      "description": "The program: the body of an async TypeScript function."
    },
    "description": {
      "type": "string",
      "description": "Clear, concise description of what this program does in active voice, 5-10 words (shown in the UI). Examples: \"Count TODO markers across packages\"; \"Read failing test and its fixture\"; \"Rename config key in every cordis.yml\"."
    }
  },
  "required": [
    "code",
    "description"
  ]
}
```

来源：[`packages/core/tools/src/ptc.ts`](../packages/core/tools/src/ptc.ts)

在 `mode: ptc`／`mode: both` 下，它由工具注册表所有，作为可过滤能力层之外的保留传输机制（参见 PTC mode Agent Note）。在 `ptc` 下，它是注册表对协议格式的唯一贡献；其他可见能力在使用已加载运行时语言生成的 SDK 章节中声明。程序通过 binding 调用这些能力，调用按照原生并发约定调度：启动顺序和策略遵循提交顺序，并发安全的函数体最多重叠执行 `maxParallelSubCalls` 个。调用会重新进入完整且受守卫保护的工具流水线，并将每个嵌套执行关联到此外层结果。

<a id="aevenplan-mode"></a>

## `@aeven/plan-mode`

### `exit_plan_mode`

仅在规划模式下使用。提交计划供用户评审，并在获批后退出规划模式。发送**完整的** Markdown 计划，以一个为计划命名的 # 标题开头。用户可以批准（从你的下一步骤起执行计划），也可以要求继续规划；其反馈会通过工具结果返回，请修改后再次提交。

```json
{
  "type": "object",
  "properties": {
    "plan": {
      "type": "string",
      "description": "The complete plan, as markdown, starting with a # heading that names it."
    }
  },
  "required": [
    "plan"
  ]
}
```

来源：[`packages/plan/plan-mode/src/index.ts`](../packages/plan/plan-mode/src/index.ts)

规划未激活时，exit_plan_mode 仍保留在面向模型的 schema 中，这样状态转换不会在规划策略变更之外额外造成工具目录变动。其执行路径会拒绝规划模式之外的调用；在规划模式下，它通过用户交互 seam 提交计划（批准／根据反馈继续规划），批准后会在步骤边界记录规划模式已停用。

<a id="aeventool-bash"></a>

## `@aeven/tool-bash`

### `bash`

执行 bash 命令（`bash -c`）并返回 stdout/stderr。每次调用都在新的 shell 中运行；请传入 `workdir`，不要使用 `cd`。托管 `$AVN_*` 变量公开当前 harness 环境信息。较长的输出会截断，只保留尾部；如可用，完整输出会保存到文件并报告其路径。前台命令若在 20000ms 后仍在运行，会作为后台任务交回，而不是阻塞本轮。请在参数中先给出 `description`，再给出 `command`。执行任何删除或移动前，请确认解析后的绝对目标路径正是预期路径；绝不要对未经核对的拼接路径执行此类操作。未设置的变量会展开为空字符串，因此这类路径中的变量请用 `${VAR:?}` 保护。命令可能在文件沙箱中运行；被阻止的文件操作会报告为 `[sandbox: file access denied under <mode> mode]`，这是策略拒绝：请勿换一种方式重试。

```json
{
  "type": "object",
  "properties": {
    "description": {
      "type": "string",
      "description": "Clear, concise description of what this command does in active voice, 5-10 words (shown in the UI). Examples: \"ls\" → \"List files in current directory\"; \"git status\" → \"Show working tree status\"; \"npm install\" → \"Install package dependencies\"."
    },
    "command": {
      "type": "string",
      "description": "The bash command to execute."
    },
    "timeoutMs": {
      "type": "number",
      "description": "Timeout in milliseconds. The executor applies its configured default and cap, and kills the command on expiry."
    },
    "workdir": {
      "type": "string",
      "description": "Working directory for this command. Defaults to the session workspace; a relative path is resolved against it."
    },
    "output_files": {
      "type": "array",
      "description": "For commands generating deliverables (PDF, DOCX, spreadsheets, images, etc.), list every output path here. Paths resolve against workdir. Verified new or changed files appear in the created/edited-files block. Requires foreground execution.",
      "items": {
        "type": "string"
      }
    },
    "run_in_background": {
      "type": "boolean",
      "description": "Run in the background and return a job id immediately (collect with job_output, stop with job_kill). No timeout applies."
    }
  },
  "required": [
    "description",
    "command"
  ]
}
```

来源：[`packages/shell/tool-bash/src/index.ts`](../packages/shell/tool-bash/src/index.ts)

bash 工具是 bash 执行器 seam 面向模型的消费方。使用 `run_in_background` 的运行会注册到通用 `ctx.jobs` 运行时，并通过 `job_*` 工具（来自 `@aeven/tool-jobs`）收集／停止；禁用 `enableRunInBackground` 配置（默认为 true）后，该参数会被完全移除。

<a id="aeventool-pwsh"></a>

## `@aeven/tool-pwsh`

### `pwsh`

执行 PowerShell 命令（`pwsh -Command`）并返回 stdout/stderr。每次调用都在新的 pwsh 进程中运行；请传入 `workdir`，不要使用 `cd`。路径采用 Windows 原生形式（`C:\...`）；使用 `$env:NAME` 读取环境变量。托管 `$env:AVN_*` 变量公开当前 harness 环境信息。较长的输出会截断，只保留尾部；如可用，完整输出会保存到文件并报告其路径。在 Windows 上，被强制终止的命令会以 `[exit code: 1]` 结算且不带信号标记，请将其视为中断，而不是命令失败。前台命令若在 20000ms 后仍在运行，会作为后台任务交回，而不是阻塞本轮。请在参数中先给出 `description`，再给出 `command`。执行任何删除或移动前，请确认解析后的绝对目标路径正是预期路径；绝不要对未经核对的拼接路径执行此类操作。不要给 `$HOME` 这类自动变量赋值；变量名不区分大小写，因此 `$home` 就是同一个只读变量。命令可能在文件沙箱中运行；被阻止的文件操作会报告为 `[sandbox: file access denied under <mode> mode]`，这是策略拒绝：请勿换一种方式重试。

```json
{
  "type": "object",
  "properties": {
    "description": {
      "type": "string",
      "description": "Clear, concise description of what this command does in active voice, 5-10 words (shown in the UI). Examples: \"ls\" → \"List files in current directory\"; \"git status\" → \"Show working tree status\"; \"Get-Process\" → \"List running processes\"."
    },
    "command": {
      "type": "string",
      "description": "The PowerShell command to execute."
    },
    "timeoutMs": {
      "type": "number",
      "description": "Timeout in milliseconds. The executor applies its configured default and cap, and kills the command on expiry."
    },
    "workdir": {
      "type": "string",
      "description": "Working directory for this command. Defaults to the session workspace; a relative path is resolved against it."
    },
    "run_in_background": {
      "type": "boolean",
      "description": "Run in the background and return a job id immediately (collect with job_output, stop with job_kill). No timeout applies."
    }
  },
  "required": [
    "description",
    "command"
  ]
}
```

来源：[`packages/shell/tool-pwsh/src/index.ts`](../packages/shell/tool-pwsh/src/index.ts)

pwsh 工具是 Windows 组合中 bash 执行器 seam 的 PowerShell 方言消费方（由 `@aeven/pwsh-local` 等 PowerShell 执行器为 `ctx.shell` 提供后端）；除沙箱接口外，它逐项对应 bash 工具调用。使用 `run_in_background` 的运行会注册到通用 `ctx.jobs` 运行时，并通过 `job_*` 工具收集／停止；托管的 `AVN_*` 环境来自 `@aeven/shell-env`。每次调用都在新进程中运行，不使用持久 PTY 会话。路径采用原生 `C:\...` 形式，变量采用 `$env:NAME`。

<a id="aeventool-cordis"></a>

## `@aeven/tool-cordis`

### `cordis_define`

定义一个不可变的 Cordis Package。新建 Plugin 时使用 kind:"new"，只提供 3 至 6 位小写英文字母组成的语义前缀；Host 返回最终 pluginId 和 packageId。修改现有 Plugin 时使用 kind:"existing" 并传入精确 pluginId，以追加 Package 而不覆盖旧版本。code.host 与 code.client 至少提供一个；每个值都是返回 Cordis Plugin 的 plain JavaScript 函数体，不经过 TypeScript、JSX 或 import 转换。依赖 Service、Event、Builtin、Slot 或 token 前先查询 Inspect。Define 只校验参数和语法并记录源码，不申请审批、不执行 apply，也不改变 currentPackageId。成功后用返回的 ID 调用 cordis_run。

```json
{
  "type": "object",
  "properties": {
    "plugin": {
      "oneOf": [
        {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "kind": {
              "type": "string",
              "const": "new"
            },
            "idPrefix": {
              "type": "string",
              "description": "Suggested semantic prefix of 3–6 lowercase English letters; the Host adds a unique numeric suffix."
            }
          },
          "required": [
            "kind",
            "idPrefix"
          ]
        },
        {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "kind": {
              "type": "string",
              "const": "existing"
            },
            "pluginId": {
              "type": "string",
              "description": "Exact ID of an existing Plugin; the new Package is appended to that instance."
            }
          },
          "required": [
            "kind",
            "pluginId"
          ]
        }
      ]
    },
    "name": {
      "type": "string",
      "description": "Short, readable Package name."
    },
    "purpose": {
      "type": "string",
      "description": "One-sentence, user-facing description of the Package purpose."
    },
    "code": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "host": {
          "type": "string",
          "description": "Plain JavaScript function body that returns the Host-half Cordis Plugin."
        },
        "client": {
          "type": "string",
          "description": "Plain JavaScript function body that returns the browser Client-half Cordis Plugin."
        }
      }
    }
  },
  "required": [
    "plugin",
    "name",
    "purpose",
    "code"
  ]
}
```

来源：[`packages/extensions/tool-cordis/src/index.ts`](../packages/extensions/tool-cordis/src/index.ts)

### `cordis_inspect_list`

列出 Host 当前已知的全部 Cordis Inspect Provider，包括本地 Host Provider 和 Client 最近同步的 manifest。每项包含所属平台、用途、只读方法及输入／输出 schema。创建或修改 Package 前先调用本 Tool，再从结果中选择 cordis_inspect_query 的 provider 和 method。不要猜测名称，也不要把 Inspect method 当作 Plugin 代码可调用的业务 Service。

```json
{
  "type": "object",
  "properties": {}
}
```

来源：[`packages/extensions/tool-cordis/src/index.ts`](../packages/extensions/tool-cordis/src/index.ts)

### `cordis_inspect_query`

执行 Inspect Provider 显式声明的只读查询。platform、provider 和 method 必须来自 cordis_inspect_list，input 必须符合该方法的 schema。在 cordis_define 前用本 Tool 读取精确 Service 方法、Event mode、Builtin 签名、Tool schema、主题 token，或实时 Slot 树及 props。Host 查询在本地执行；Client 查询等待首个有效页面响应，在页面回答或 Tool 被取消前保持 pending。本 Tool 不能调用业务 Service 方法或修改运行时。查询 Service.listService 和 Event.listEvents 时，先不传 input 浏览紧凑签名目录，再查询精确 service 或 event 获取结构化约定和引用类型。查询 Slots.listSubTree 时，先不传 root 浏览紧凑树，再查询精确 root 获取完整注册约定和 props。

```json
{
  "type": "object",
  "properties": {
    "platform": {
      "type": "string",
      "description": "Runtime platform that owns the Provider.",
      "enum": [
        "host",
        "client"
      ]
    },
    "provider": {
      "type": "string",
      "description": "Exact Provider ID returned by cordis_inspect_list."
    },
    "method": {
      "type": "string",
      "description": "Exact method name declared by the Provider manifest."
    },
    "input": {
      "description": "Optional query input; it must satisfy the method input schema."
    }
  },
  "required": [
    "platform",
    "provider",
    "method"
  ]
}
```

来源：[`packages/extensions/tool-cordis/src/index.ts`](../packages/extensions/tool-cordis/src/index.ts)

### `cordis_inspect_self`

按逐层增加的详细程度检查当前 Session 拥有的动态 Cordis 对象。不传 ID 时只列 Plugin 摘要；只传 pluginId 时返回版本指针、最新 Run 和全部 Package 摘要；只有同时传 pluginId 与 packageId 才返回该不可变 Package 的 Host/Client 源码和运行诊断。packageId 不能单独传入。处理 @pluginId、修复异步失败或定义更新版本前，先查询精确 Package。本 Tool 只读，不执行代码，也不改变版本指针。

```json
{
  "type": "object",
  "properties": {
    "pluginId": {
      "type": "string",
      "description": "Stable Plugin ID returned by cordis_define or injected by @pluginId; omit it to list every current Plugin."
    },
    "packageId": {
      "type": "string",
      "description": "Exact immutable Package ID owned by pluginId; when specified, source and diagnostics are returned."
    }
  }
}
```

来源：[`packages/extensions/tool-cordis/src/index.ts`](../packages/extensions/tool-cordis/src/index.ts)

### `cordis_run`

激活动态 Plugin 的一个精确 Package。首次激活、重启 currentPackageId 或回退使用 mode:"run"；已有 current 时，即使 Plugin 当前已停止，切换到其他 Package 也使用 mode:"update"。未授权的 Client Package 创建审批请求并返回 awaiting-approval；已授权的 Package 返回 starting，并在浏览器中异步继续。两种结果都不会在 Tool 内等待最终结局。currentPackageId 只在完整成功后改变；失败时保留旧 current 和目标 next。异步成功、拒绝或技术失败通过状态与 steering 报告。技术失败后，用 cordis_inspect_self 读取诊断，修正同一 Plugin 并自主重试。用户拒绝后不要再次申请审批。

```json
{
  "type": "object",
  "properties": {
    "pluginId": {
      "type": "string",
      "description": "Stable Plugin ID returned by cordis_define."
    },
    "packageId": {
      "type": "string",
      "description": "Exact immutable Package ID to activate under that Plugin."
    },
    "mode": {
      "type": "string",
      "description": "Use run for the first activation, restarting current, or rollback; use update to switch from current to a different Package.",
      "enum": [
        "run",
        "update"
      ]
    }
  },
  "required": [
    "pluginId",
    "packageId",
    "mode"
  ]
}
```

来源：[`packages/extensions/tool-cordis/src/index.ts`](../packages/extensions/tool-cordis/src/index.ts)

### `cordis_stop`

停止动态 Plugin 的当前 Run，并取消尚未完成的审批或激活请求。保留 Plugin、全部不可变 Package、授权、currentPackageId 和 nextPackageId，以便之后直接运行或更新。停止已处于停止状态的 Plugin 会幂等成功。临时禁用副作用使用本 Tool；永久移除使用 cordis_undefine。

```json
{
  "type": "object",
  "properties": {
    "pluginId": {
      "type": "string",
      "description": "Stable dynamic Plugin ID to stop."
    }
  },
  "required": [
    "pluginId"
  ]
}
```

来源：[`packages/extensions/tool-cordis/src/index.ts`](../packages/extensions/tool-cordis/src/index.ts)

### `cordis_undefine`

永久移除当前 Session 拥有的动态 Plugin。如果它正在运行或等待审批，先停止并取消请求，再删除全部 Package、授权和版本指针。返回后，其 pluginId、packageIds、@ 引用和 Package 业务视图均失效；历史卡片只保留“Plugin 已移除”记录。需要保留版本以便重启或回退时不要调用本 Tool，应改用 cordis_stop。

```json
{
  "type": "object",
  "properties": {
    "pluginId": {
      "type": "string",
      "description": "Stable dynamic Plugin ID to remove permanently."
    }
  },
  "required": [
    "pluginId"
  ]
}
```

来源：[`packages/extensions/tool-cordis/src/index.ts`](../packages/extensions/tool-cordis/src/index.ts)

不在任何随产品发布的树中，需要显式选择启用；动态 Package 代码可以访问真实运行时，见 .agents/notes/implemented/feature/2026-07-08-self-referential-cordis-toolset.md。该工具集注入 `@aeven/cordis-host-runner` 提供的 `ctx.dynamicCordisRunner`，后者拥有定义注册表和 vm 沙箱；组合缺少它时这些工具不会激活。运行中的 Package 在停止、undefine 或 AVN 重启前可以注册**额外的**模型可见工具；发生这类工具集变化时，系统会记录完整且有变动的请求头。

<a id="aeventool-bash-persistent"></a>

## `@aeven/tool-bash-persistent`

### `bash`

在持久 bash shell 中运行命令。包括当前目录和已导出环境变量在内的状态会在此 agent 的多次调用之间保留。

```json
{
  "type": "object",
  "properties": {
    "command": {
      "type": "string",
      "description": "The bash command to run. Relative path is preferred in the command."
    }
  },
  "required": [
    "command"
  ]
}
```

来源：[`packages/shell/tool-bash-persistent/src/index.ts`](../packages/shell/tool-bash-persistent/src/index.ts)

一个按所有者隔离的持久 bash 工具；部署组合提供 PTY 后端，并可覆盖面向模型的环境描述。

<a id="aeventool-pwsh-persistent"></a>

## `@aeven/tool-pwsh-persistent`

### `pwsh`

在持久 PowerShell shell 中运行命令。包括当前目录和已导出环境变量在内的状态会在此 agent 的多次调用之间保留。

```json
{
  "type": "object",
  "properties": {
    "command": {
      "type": "string",
      "description": "The PowerShell command to run. Relative path is preferred in the command."
    }
  },
  "required": [
    "command"
  ]
}
```

来源：[`packages/shell/tool-pwsh-persistent/src/index.ts`](../packages/shell/tool-pwsh-persistent/src/index.ts)

一个按所有者隔离的持久 pwsh 工具，持久 bash 工具的 Windows 对应物；部署组合提供 pwsh 方言的 PTY 后端，并可覆盖面向模型的环境描述。

<a id="aeventool-str-replace-editor"></a>

## `@aeven/tool-str-replace-editor`

### `str_replace_editor`

用于查看、创建和编辑文件的自定义编辑工具：
* 状态会在命令调用以及与用户的讨论之间持久保留
* 如果 `path` 是文件，`view` 会显示应用 `cat -n` 后的结果。如果 `path` 是目录，`view` 会列出最多向下 2 层的非隐藏文件和目录
* 如果指定的 `create` 命令目标 `path` 已作为文件存在，则不能使用该命令
* 如果 `command` 产生较长输出，输出会被截断并标记为 `<response clipped>`
* 当前命令不使用某个参数时，值为 `null` 的占位参数视为未提供。必填参数仍须提供值；删除匹配内容时应省略 `str_replace.new_str`，而不是将其设为 `null`

使用 `str_replace` 命令时请注意：
* `old_str` 参数应与原文件中一行或多行连续内容**完全**匹配。请留意空白字符！
* 如果 `old_str` 参数在文件中不唯一，则不会执行替换。请确保在 `old_str` 中包含足够的上下文，使其唯一
* `new_str` 参数应包含用于替换 `old_str` 的已编辑行

```json
{
  "type": "object",
  "properties": {
    "command": {
      "type": "string",
      "description": "The commands to run. Allowed options are: `view`, `create`, `str_replace`, `insert`.",
      "enum": [
        "view",
        "create",
        "str_replace",
        "insert"
      ]
    },
    "path": {
      "type": "string",
      "description": "Absolute path to file or directory, e.g. `/repo/file.py` or `/repo`."
    },
    "file_text": {
      "oneOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ],
      "description": "Required string parameter of `create` command, with the content of the file to be created. A null placeholder is treated as omitted by commands that do not use this parameter."
    },
    "insert_line": {
      "oneOf": [
        {
          "type": "integer"
        },
        {
          "type": "null"
        }
      ],
      "description": "Required integer parameter of `insert` command. The `new_str` will be inserted AFTER the line `insert_line` of `path`. A null placeholder is treated as omitted by commands that do not use this parameter."
    },
    "new_str": {
      "oneOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ],
      "description": "Optional string parameter of `str_replace` command containing the new string (if omitted, no string will be added). Required string parameter of `insert` command containing the string to insert. A null placeholder is accepted only by commands that do not use this parameter."
    },
    "old_str": {
      "oneOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ],
      "description": "Required string parameter of `str_replace` command containing the string in `path` to replace. A null placeholder is treated as omitted by commands that do not use this parameter."
    },
    "view_range": {
      "oneOf": [
        {
          "type": "array",
          "items": {
            "type": "integer"
          }
        },
        {
          "type": "null"
        }
      ],
      "description": "Optional parameter of `view` command when `path` points to a file. If omitted or null, the full file is shown. If provided, the file will be shown in the indicated line number range, e.g. [11, 12] will show lines 11 and 12. Indexing at 1 to start. Setting `[start_line, -1]` shows all lines from `start_line` to the end of the file."
    }
  },
  "required": [
    "command",
    "path"
  ]
}
```

来源：[`packages/fs/tool-str-replace-editor/src/index.ts`](../packages/fs/tool-str-replace-editor/src/index.ts)

基于文件系统 seam 的独立查看／创建／唯一字面量替换／按行插入工具；可与任何 shell 或终端接口组合。

<a id="aeventool-fs"></a>

## `@aeven/tool-fs`

### `edit`

通过替换字面量文本来编辑现有 UTF-8 文本文件。

```json
{
  "type": "object",
  "properties": {
    "file_path": {
      "type": "string",
      "description": "Path to edit, resolved by the filesystem backend. Required unless files is given."
    },
    "old_string": {
      "type": "string",
      "description": "Literal text to replace. Must match exactly. Required unless edits is given."
    },
    "new_string": {
      "type": "string",
      "description": "Literal replacement text. Use an empty string to delete the match. Required unless edits is given."
    },
    "replace_all": {
      "type": "boolean",
      "description": "Replace all matches. Defaults to false; when false, old_string must appear exactly once."
    },
    "edits": {
      "type": "array",
      "description": "Several replacements for this file in one call, applied in order; none applies unless all match. Use instead of old_string/new_string.",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "old_string": {
            "type": "string",
            "description": "Literal text to replace. Must match exactly."
          },
          "new_string": {
            "type": "string",
            "description": "Literal replacement text."
          },
          "replace_all": {
            "type": "boolean",
            "description": "Replace all matches of this old_string."
          }
        },
        "required": [
          "old_string",
          "new_string"
        ]
      }
    },
    "files": {
      "type": "array",
      "description": "Several files in one call, applied in order, each file at most once. Use instead of the top-level file_path and its replacements.",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "file_path": {
            "type": "string",
            "description": "Path to edit, resolved by the filesystem backend."
          },
          "old_string": {
            "type": "string",
            "description": "Literal text to replace. Must match exactly. Required unless edits is given."
          },
          "new_string": {
            "type": "string",
            "description": "Literal replacement text. Required unless edits is given."
          },
          "replace_all": {
            "type": "boolean",
            "description": "Replace all matches. Defaults to false."
          },
          "edits": {
            "type": "array",
            "description": "Several replacements for this file, applied in order; none applies unless all match.",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "old_string": {
                  "type": "string",
                  "description": "Literal text to replace. Must match exactly."
                },
                "new_string": {
                  "type": "string",
                  "description": "Literal replacement text."
                },
                "replace_all": {
                  "type": "boolean",
                  "description": "Replace all matches of this old_string."
                }
              },
              "required": [
                "old_string",
                "new_string"
              ]
            }
          }
        },
        "required": [
          "file_path"
        ]
      }
    }
  }
}
```

来源：[`packages/fs/tool-fs/src/index.ts`](../packages/fs/tool-fs/src/index.ts)

### `read`

读取 UTF-8 文本文件，并返回带行号的内容。

```json
{
  "type": "object",
  "properties": {
    "file_path": {
      "type": "string",
      "description": "Path to read, resolved by the filesystem backend. Required unless files is given."
    },
    "offset": {
      "type": "number",
      "description": "1-based first line to return. Defaults to 1."
    },
    "limit": {
      "type": "number",
      "description": "Maximum number of lines to return. Defaults to 2000."
    },
    "files": {
      "type": "array",
      "description": "Several files in one call, read concurrently and returned in order. Use instead of the top-level file_path, offset, and limit.",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "file_path": {
            "type": "string",
            "description": "Path to read, resolved by the filesystem backend."
          },
          "offset": {
            "type": "number",
            "description": "1-based first line to return. Defaults to 1."
          },
          "limit": {
            "type": "number",
            "description": "Maximum number of lines to return. Defaults to 2000."
          }
        },
        "required": [
          "file_path"
        ]
      }
    }
  }
}
```

来源：[`packages/fs/tool-fs/src/index.ts`](../packages/fs/tool-fs/src/index.ts)

### `read_image`

读取 PNG/JPEG/WebP/GIF 文件并返回图像本身。无扩展名的路径同样被接受；格式按文件内容检测，因此规范化附件路径可以直接传入，无需复制或重命名。Harness 会在下一次模型请求前校验并缩小受支持的大图，因此仅为查看图片时应直接使用此工具，无需安装图片库或创建缩略图。可以用小批次并发读取彼此独立的文件。要求当前模型接受图像输入。

```json
{
  "type": "object",
  "properties": {
    "file_path": {
      "type": "string",
      "description": "Path to the image file, resolved by the filesystem backend."
    }
  },
  "required": [
    "file_path"
  ]
}
```

来源：[`packages/fs/tool-fs/src/index.ts`](../packages/fs/tool-fs/src/index.ts)

### `write`

创建或完全替换 UTF-8 文本文件。

```json
{
  "type": "object",
  "properties": {
    "file_path": {
      "type": "string",
      "description": "Path to write, resolved by the filesystem backend."
    },
    "content": {
      "type": "string",
      "description": "Full UTF-8 text content to write."
    }
  },
  "required": [
    "file_path",
    "content"
  ]
}
```

来源：[`packages/fs/tool-fs/src/index.ts`](../packages/fs/tool-fs/src/index.ts)

先读后写／编辑策略由 `@aeven/fs-observation-policy` 添加；它是一个 `fs/*` 事件门禁插件，不会改变 schema。加载这些工具的部署按预期也应加载该插件。没有 `ctx.attachments` 时图片工具不会注册；其 schema 与路由无关，执行时除非确切路由的模型声明图片输入，否则拒绝。

<a id="aeventool-fs-search"></a>

## `@aeven/tool-fs-search`

### `glob`

查找路径匹配 glob 模式的文件，而不是目录，包括隐藏文件和被忽略的文件。最多按修改时间顺序返回 100 条路径；结果更多时会从顶层条目中抽样，并报告完整列表的保存位置。

```json
{
  "type": "object",
  "properties": {
    "pattern": {
      "type": "string",
      "description": "Glob pattern to match file paths against (e.g. \"**/*.ts\", \"src/**/*.test.js\"). A pattern with no \"/\" matches the basename at any depth, so \"*\" and \"*.ts\" both search the whole tree; include a separator to anchor the depth."
    },
    "path": {
      "type": "string",
      "description": "Directory to search in. Defaults to the session workspace; a relative path resolves against it."
    }
  },
  "required": [
    "pattern"
  ]
}
```

来源：[`packages/fs/tool-fs-search/src/index.ts`](../packages/fs/tool-fs-search/src/index.ts)

### `grep`

使用 ripgrep 正则表达式搜索文件内容。返回带行号的匹配行，并按文件分组。最多返回 250 条匹配；结果更多时会报告完整匹配列表的保存位置。

```json
{
  "type": "object",
  "properties": {
    "pattern": {
      "type": "string",
      "description": "Regular expression to search for (ripgrep syntax)."
    },
    "path": {
      "type": "string",
      "description": "File or directory to search. Defaults to the session workspace; a relative path resolves against it."
    },
    "include": {
      "type": "string",
      "description": "One glob filter for which files to search (e.g. \"*.ts\", \"*.{js,jsx}\"). Not a list; negation is not supported."
    }
  },
  "required": [
    "pattern"
  ]
}
```

来源：[`packages/fs/tool-fs-search/src/index.ts`](../packages/fs/tool-fs-search/src/index.ts)

glob 和 grep 是无条件可用的发现工具，通过 ctx.subprocess spawn 随包提供的 ripgrep 二进制文件（`@vscode/ripgrep`），并作为普通前台调用运行，绝不作为后台任务；无需在宿主机安装 `rg`，也不经过 shell 层。本目录使用 `sampleOverCapGlobResults: true`；部署必须显式选择该行为。结果超过上限时，会通过可选的 ctx.spillStore 后端保存完整的格式化列表；在共置部署中，如果后端公开本地路径，返回的定位信息可供后续读取／搜索。

<a id="aeventool-terminal"></a>

## `@aeven/tool-terminal`

### `terminal_close`

关闭一个持久终端，并等待其捕获且所有的进程树完全退出。

```json
{
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string",
      "description": "Terminal session id."
    }
  },
  "required": [
    "sessionId"
  ]
}
```

来源：[`packages/terminal/tool-terminal/src/index.ts`](../packages/terminal/tool-terminal/src/index.ts)

### `terminal_list`

列出当前 agent 所有的持久终端会话。

```json
{
  "type": "object",
  "properties": {}
}
```

来源：[`packages/terminal/tool-terminal/src/index.ts`](../packages/terminal/tool-terminal/src/index.ts)

### `terminal_open`

通过已注册的后端类型创建按所有者隔离的持久终端会话。需要在多次工具调用之间保留 shell 或 REPL 状态时，请使用此工具。

```json
{
  "type": "object",
  "properties": {
    "type": {
      "type": "string",
      "description": "Registered terminal backend type, usually \"shell\"."
    },
    "name": {
      "type": "string",
      "description": "Optional owner-local display name such as \"main\" or \"gdb\"."
    },
    "cwd": {
      "type": "string",
      "description": "Initial working directory. Defaults to the deployment workspace root."
    }
  },
  "required": [
    "type"
  ]
}
```

来源：[`packages/terminal/tool-terminal/src/index.ts`](../packages/terminal/tool-terminal/src/index.ts)

### `terminal_read`

从持久终端读取一页有界的保留输出，不发送输入。

```json
{
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string",
      "description": "Terminal session id."
    },
    "offset": {
      "type": "number",
      "description": "Newest-relative line offset (default 0)."
    },
    "count": {
      "type": "number",
      "description": "Requested line count (default 500; backend caps apply)."
    }
  },
  "required": [
    "sessionId"
  ]
}
```

来源：[`packages/terminal/tool-terminal/src/index.ts`](../packages/terminal/tool-terminal/src/index.ts)

### `terminal_send`

向持久终端发送文本。默认会提交 Enter，并等待提示符、stdin 等待、输出静默、超时或会话退出。后台模式会返回供 job_output／job_kill 使用的 job id。

```json
{
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string",
      "description": "Terminal session id returned by terminal_open or terminal_list."
    },
    "text": {
      "type": "string",
      "description": "UTF-8 text to write to the terminal."
    },
    "submit": {
      "type": "boolean",
      "description": "Submit Enter after text (default true). Set false for control characters or incomplete REPL input."
    },
    "run_in_background": {
      "type": "boolean",
      "description": "Return a job id immediately; collect with job_output or stop with job_kill."
    }
  },
  "required": [
    "sessionId",
    "text"
  ]
}
```

来源：[`packages/terminal/tool-terminal/src/index.ts`](../packages/terminal/tool-terminal/src/index.ts)

### `terminal_signal`

向持久终端当前的前台进程组发送允许的信号。

```json
{
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string",
      "description": "Terminal session id."
    },
    "signal": {
      "type": "string",
      "description": "Signal to deliver. Shell-targeted SIGKILL is rejected; use terminal_close.",
      "enum": [
        "SIGINT",
        "SIGTERM",
        "SIGKILL",
        "SIGTSTP",
        "SIGHUP"
      ]
    }
  },
  "required": [
    "sessionId",
    "signal"
  ]
}
```

来源：[`packages/terminal/tool-terminal/src/index.ts`](../packages/terminal/tool-terminal/src/index.ts)

这 6 个终端工具需要选择启用，用于补充一次性 bash／文件系统工具。`terminal_send(run_in_background: true)` 会注册到 `ctx.jobs`；schema 不包含 TUI、具名按键序列、BEL、调整尺寸、自动启动和跨 agent 共享。

<a id="aeventool-goal"></a>

## `@aeven/tool-goal`

### `create_goal`

创建一个持久化目标，让本会话在自动延续的 Round 中持续工作。当直接来自人类的请求是长期目标时使用它，即使用户没有说出「目标」也不例外；不用于单轮工作。

```json
{
  "type": "object",
  "properties": {
    "objective": {
      "type": "string",
      "description": "The concrete completion objective inferred from the direct human request."
    },
    "max_goal_rounds": {
      "type": "number",
      "description": "Optional positive safe-integer limit on automatic continuation rounds."
    }
  },
  "required": [
    "objective"
  ]
}
```

来源：[`packages/goal/tool-goal/src/index.ts`](../packages/goal/tool-goal/src/index.ts)

### `get_goal`

读取当前会话目标，包括 update_goal 所需的 id 与 revision。

```json
{
  "type": "object",
  "properties": {}
}
```

来源：[`packages/goal/tool-goal/src/index.ts`](../packages/goal/tool-goal/src/index.ts)

### `update_goal`

更新当前目标。

```json
{
  "type": "object",
  "properties": {
    "goal_id": {
      "type": "string",
      "description": "Exact id returned by get_goal."
    },
    "revision": {
      "type": "number",
      "description": "Exact positive revision returned by get_goal."
    },
    "action": {
      "type": "string",
      "description": "edit, pause, and resume require a direct top-level human request. complete and blocked are also allowed during an automatic continuation of this goal; blocked is rejected before the configured minimum round count.",
      "enum": [
        "edit",
        "pause",
        "resume",
        "complete",
        "blocked"
      ]
    },
    "objective": {
      "type": "string",
      "description": "Replacement objective; valid only with action edit."
    },
    "max_goal_rounds": {
      "type": "number",
      "description": "Replacement cap; valid only with action edit."
    },
    "blocked_reason": {
      "type": "string",
      "description": "Required only with action blocked: the concrete condition that persisted across rounds and blocks progress."
    }
  },
  "required": [
    "goal_id",
    "revision",
    "action"
  ]
}
```

来源：[`packages/goal/tool-goal/src/index.ts`](../packages/goal/tool-goal/src/index.ts)

create、edit、pause 和 resume 要求直接来自人类的根权限；complete 和 blocked 也接受确切的当前 Goal Round。blocked 的默认下限是 3 个获准的 Round。

<a id="aevenschedule"></a>

## `@aeven/schedule`

### `schedule_create`

在当前会话中创建一条提醒。请提供非空 prompt 和恰好一个 selector：正的安全整数 after_seconds 延时；作为严格带偏移日期时间或本地日期／时间对象的 at；或不小于 300 的安全整数 every_seconds。固定速率提醒始终与创建时刻对齐，会跳过错过的发生时点，并把每条逾期规则的最新一个发生时点合并到一个批次中。交付模式是 session-local：只有此会话处于 live 状态时，提醒才会准时运行；否则提醒会进入 overdue 状态，直至会话恢复。

```json
{
  "type": "object",
  "properties": {
    "prompt": {
      "type": "string",
      "description": "Reminder content to present when the target becomes due."
    },
    "after_seconds": {
      "type": "number",
      "description": "Positive safe-integer delay in seconds."
    },
    "every_seconds": {
      "type": "number",
      "description": "Fixed-rate safe-integer interval in seconds, at least 300."
    },
    "at": {
      "oneOf": [
        {
          "type": "string"
        },
        {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "date": {
              "type": "string"
            },
            "time": {
              "type": "string"
            },
            "time_zone": {
              "type": "string"
            }
          },
          "required": [
            "date",
            "time",
            "time_zone"
          ]
        }
      ],
      "description": "Absolute target as strict offset RFC 3339 or local date/time with an explicit IANA zone."
    }
  },
  "required": [
    "prompt"
  ]
}
```

来源：[`packages/schedule/schedule/src/tools.ts`](../packages/schedule/schedule/src/tools.ts)

### `schedule_delete`

使用 schedule_create 或 schedule_list 返回的确切 id，删除当前会话中的一条活动提醒。未知或已经结束的 id 会返回 deleted false。

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Exact session-local schedule id."
    }
  },
  "required": [
    "id"
  ]
}
```

来源：[`packages/schedule/schedule/src/tools.ts`](../packages/schedule/schedule/src/tools.ts)

### `schedule_list`

按创建顺序列出当前会话中的所有活动提醒，包括确切 id、UTC 目标、scheduled 或 overdue 状态，以及 session-local 交付模式。

```json
{
  "type": "object",
  "properties": {}
}
```

来源：[`packages/schedule/schedule/src/tools.ts`](../packages/schedule/schedule/src/tools.ts)

仅在选择启用的 Schedule 插件加载后创建的 live 根 Agent scope 内注册。版本 1 接受 after_seconds、显式绝对 at 和有界固定速率 every_seconds，并披露 session-local 交付；管理读取与变更必须通过共享的 Session 持久化 barrier。

<a id="aeventool-lsp"></a>

## `@aeven/tool-lsp`

### `lsp`

查询语言服务器，以精确导航代码。operation 可取 goToDefinition、findReferences、goToImplementation 或 hover。line 和 character 是从 1 开始的 UTF-16 光标坐标。findReferences 包含声明。

```json
{
  "type": "object",
  "properties": {
    "operation": {
      "type": "string",
      "description": "goToDefinition, findReferences, goToImplementation, or hover.",
      "enum": [
        "goToDefinition",
        "findReferences",
        "goToImplementation",
        "hover"
      ]
    },
    "file_path": {
      "type": "string",
      "description": "The source file to query, relative to the workspace or absolute."
    },
    "line": {
      "type": "number",
      "description": "One-based line of the cursor."
    },
    "character": {
      "type": "number",
      "description": "One-based UTF-16 column of the cursor."
    }
  },
  "required": [
    "operation",
    "file_path",
    "line",
    "character"
  ]
}
```

来源：[`packages/lsp/tool-lsp/src/index.ts`](../packages/lsp/tool-lsp/src/index.ts)

lsp 工具将提供方选择和语言服务器子进程置于 ctx.lsp 之后，因此其模型可见 schema 在更换提供方时保持稳定。运行时要求已注册提供方，例如 `@aeven/lsp-stdio`；如果没有提供方，查询会返回结构化 `LSP_UNAVAILABLE` 错误，而不会改变 schema。

<a id="aeventool-vcs"></a>

## `@aeven/tool-vcs`

### `git_branch`

List, create, switch, or delete branches. Switching refuses while the checkout has uncommitted changes unless allow_dirty is true, because a switch would otherwise carry or block them unpredictably. Deleting refuses an unmerged branch unless force is true.

```json
{
  "type": "object",
  "properties": {
    "operation": {
      "type": "string",
      "description": "What to do: list every local branch, switch to one, create one, or delete one.",
      "enum": [
        "list",
        "switch",
        "create",
        "delete"
      ]
    },
    "name": {
      "type": "string",
      "description": "Branch name; required for switch, create, and delete."
    },
    "from": {
      "type": "string",
      "description": "Revision a created branch starts from. Defaults to HEAD."
    },
    "allow_dirty": {
      "type": "boolean",
      "description": "Switch even though the checkout has uncommitted changes."
    },
    "force": {
      "type": "boolean",
      "description": "Delete a branch that is not merged."
    }
  },
  "required": [
    "operation"
  ]
}
```

Source: [`packages/vcs/tool-vcs/src/index.ts`](../packages/vcs/tool-vcs/src/index.ts)

### `git_commit`

Record the staged changes as a commit. Pass paths to stage those paths first, or omit them to commit exactly what the index holds. The message goes to git verbatim, so keep it to one clear subject line and, when useful, a body after a blank line.

```json
{
  "type": "object",
  "properties": {
    "message": {
      "type": "string",
      "description": "Commit message, passed to git verbatim."
    },
    "paths": {
      "type": "array",
      "description": "Repository-relative paths to stage before committing; omit to commit the index as it stands.",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "message"
  ]
}
```

Source: [`packages/vcs/tool-vcs/src/index.ts`](../packages/vcs/tool-vcs/src/index.ts)

### `git_diff`

Show a unified diff of this session's repository. By default it compares the working tree with the index, so it shows what is not staged yet; use staged to compare the index with HEAD, or range for two revisions such as "main..HEAD". A long diff is cut and marked truncated.

```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "description": "Repository-relative path to diff; omit for the whole checkout."
    },
    "staged": {
      "type": "boolean",
      "description": "Compare the index with HEAD instead of the working tree with the index."
    },
    "range": {
      "type": "string",
      "description": "Two revisions to compare, such as \"main..HEAD\". Takes precedence over staged."
    }
  }
}
```

Source: [`packages/vcs/tool-vcs/src/index.ts`](../packages/vcs/tool-vcs/src/index.ts)

### `git_log`

List recent commits in this session's repository, newest first, with hash, author, date, and subject. Use it to see what landed before changing history or writing a commit message.

```json
{
  "type": "object",
  "properties": {
    "limit": {
      "type": "number",
      "description": "How many commits to report. Omit for the configured default."
    }
  }
}
```

Source: [`packages/vcs/tool-vcs/src/index.ts`](../packages/vcs/tool-vcs/src/index.ts)

### `git_merge`

Merge a branch or revision into the checked-out branch. A merge that conflicts returns the paths left with conflicts instead of raising only an exit status; abort discards an in-progress merge.

```json
{
  "type": "object",
  "properties": {
    "ref": {
      "type": "string",
      "description": "Branch or revision to merge into the checked-out branch."
    },
    "abort": {
      "type": "boolean",
      "description": "Abort an in-progress merge instead of starting one."
    }
  }
}
```

Source: [`packages/vcs/tool-vcs/src/index.ts`](../packages/vcs/tool-vcs/src/index.ts)

### `git_remote`

Fetch from a remote or push the current branch to it. Omit remote to use the branch's own remote and omit branch to push the branch that is checked out. The command's own output is returned.

```json
{
  "type": "object",
  "properties": {
    "operation": {
      "type": "string",
      "description": "Fetch remote updates, or push the current branch.",
      "enum": [
        "fetch",
        "push"
      ]
    },
    "remote": {
      "type": "string",
      "description": "Remote name; omit to use the branch's own remote."
    },
    "branch": {
      "type": "string",
      "description": "Branch to push; omit to push the checked-out branch."
    }
  },
  "required": [
    "operation"
  ]
}
```

Source: [`packages/vcs/tool-vcs/src/index.ts`](../packages/vcs/tool-vcs/src/index.ts)

### `git_status`

Report the repository this session works in: checked-out branch, upstream and commits ahead or behind it, and every changed path with its staged and unstaged change. Start here before committing or switching branches.

```json
{
  "type": "object",
  "properties": {}
}
```

Source: [`packages/vcs/tool-vcs/src/index.ts`](../packages/vcs/tool-vcs/src/index.ts)

The git tools keep provider selection and git subprocesses behind ctx.vcs, so their model-visible schemas stay stable across providers. Requires a registered provider (e.g. `@aeven/vcs-git`) at runtime; without one, every call returns the structured `VCS_UNAVAILABLE` error rather than changing the schema.

<a id="aeventool-ralph"></a>

## `@aeven/tool-ralph`

### `ralph`

围绕一个不可变目标运行使用全新 agent 的前台 Ralph 循环。仅当直接人类明确要求 Ralph 或使用全新 agent 迭代时使用。每个 Round 都会启动一个全新子级，该子级看不到父级对话或先前子会话；共享工作区充当长期记忆，Round 之间只传递有界的结构化报告。当工作进程报告完成、报告具体阻塞项或达到 Round 上限时，调用返回。普通的长期同会话工作应使用 goal 工具。

```json
{
  "type": "object",
  "properties": {
    "objective": {
      "type": "string",
      "description": "The immutable completion objective for every fresh Ralph round."
    },
    "maxRounds": {
      "type": "number",
      "description": "Optional positive safe-integer round cap, bounded by the deployment ceiling."
    }
  },
  "required": [
    "objective"
  ]
}
```

来源：[`packages/workflow/tool-ralph/src/index.ts`](../packages/workflow/tool-ralph/src/index.ts)

固定的前台工作流会在每个 Round 启动一个全新的结构化子级；模型只能选择不可变目标和可选的 Round 上限。

<a id="aeventool-skill"></a>

## `@aeven/tool-skill`

### `skill`

加载可用 skill（技能）的完整说明。在执行点名某项 skill 或与其明确匹配的任务前，请使用会话 skill 目录中的确切名称调用此工具。

```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "description": "The exact skill name from the available skills list."
    }
  },
  "required": [
    "name"
  ]
}
```

来源：[`packages/skill/tool-skill/src/index.ts`](../packages/skill/tool-skill/src/index.ts)

<a id="aeventool-search"></a>

## `@aeven/tool-search`

### `tool_search`

查找并加载延迟工具。"select:a,b" 加载延迟工具索引中列出的确切工具；关键词会列出匹配的工具及其用途，但不加载任何内容（在关键词前加 + 可要求它出现在工具名或 namespace 中）；"restart:&lt;server>" 连接索引中列为未在服务的 MCP 服务器。

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "Either \"select:<name>[,<name>...]\", \"restart:<server>\", or search keywords."
    },
    "max_results": {
      "type": "integer",
      "description": "Keyword searches list at most this many tools."
    }
  },
  "required": [
    "query"
  ]
}
```

来源：[`packages/core/tool-search/src/index.ts`](../packages/core/tool-search/src/index.ts)

只有在至少有一个工具被延迟、或至少一台执行延迟的 MCP 服务器未在服务时，本工具才呈现给模型。关键词查询只列出工具而不加载它们；`select:` 会把 schema 加载到后续请求中，或在该请求呈现 `run_code` 时返回 SDK 声明；`restart:` 会重新连接一台 MCP 服务器。

<a id="aeventool-session-query"></a>

## `@aeven/tool-session-query`

### `session_event_read`

从一个已获授权的会话中读取一个完整且未删节的事件，以及可选的相邻原始事件概述。

```json
{
  "type": "object",
  "properties": {
    "session_id": {
      "type": "string",
      "description": "Target session id. Omit for the current session."
    },
    "seq": {
      "type": "integer",
      "description": "Target event sequence number."
    },
    "before": {
      "type": "integer",
      "description": "Number of preceding raw events to summarize. Omit for none."
    },
    "after": {
      "type": "integer",
      "description": "Number of following raw events to summarize. Omit for none."
    }
  },
  "required": [
    "seq"
  ]
}
```

来源：[`packages/session-query/tool-session-query/src/index.ts`](../packages/session-query/tool-session-query/src/index.ts)

### `session_event_search`

在一个已获授权的会话中搜索先前事件；如果搜索当前会话，则排除执行此次调用的步骤。

```json
{
  "type": "object",
  "properties": {
    "session_id": {
      "type": "string",
      "description": "Target session id. Omit for the current session."
    },
    "query": {
      "type": "string",
      "description": "Literal full-text query over the target session."
    },
    "seq_from": {
      "type": "integer",
      "description": "Inclusive event sequence lower bound."
    },
    "seq_to": {
      "type": "integer",
      "description": "Inclusive event sequence upper bound."
    },
    "time_from": {
      "type": "string",
      "description": "Inclusive timezone-qualified ISO 8601 event-time lower bound."
    },
    "time_to": {
      "type": "string",
      "description": "Inclusive timezone-qualified ISO 8601 event-time upper bound."
    },
    "event_types": {
      "type": "array",
      "description": "Event types to include.",
      "items": {
        "type": "string"
      }
    },
    "surfaces": {
      "type": "array",
      "description": "Event surfaces to include.",
      "items": {
        "type": "string",
        "enum": [
          "current",
          "shadowed",
          "log-only"
        ]
      }
    }
  },
  "required": [
    "query"
  ]
}
```

来源：[`packages/session-query/tool-session-query/src/index.ts`](../packages/session-query/tool-session-query/src/index.ts)

### `session_event_trace`

读取已获授权会话中某个事件的所有直接替换关系，以及该事件与其引用的来源事件之间的关系。

```json
{
  "type": "object",
  "properties": {
    "session_id": {
      "type": "string",
      "description": "Target session id. Omit for the current session."
    },
    "seq": {
      "type": "integer",
      "description": "Target event sequence number."
    }
  },
  "required": [
    "seq"
  ]
}
```

来源：[`packages/session-query/tool-session-query/src/index.ts`](../packages/session-query/tool-session-query/src/index.ts)

### `session_search`

搜索调用方工作区中的先前会话，并从每个会话返回匹配度最高的事件。

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "Literal full-text query over prior session history."
    },
    "session_ids": {
      "type": "array",
      "description": "Optional session ids to include.",
      "items": {
        "type": "string"
      }
    },
    "created_at_from": {
      "type": "string",
      "description": "Inclusive timezone-qualified ISO 8601 creation-time lower bound."
    },
    "created_at_to": {
      "type": "string",
      "description": "Inclusive timezone-qualified ISO 8601 creation-time upper bound."
    },
    "parent_session_ids": {
      "type": "array",
      "description": "Optional direct parent session ids.",
      "items": {
        "type": "string"
      }
    },
    "include_root_sessions": {
      "type": "boolean",
      "description": "Include sessions with no parent in the parent filter."
    },
    "availability": {
      "type": "array",
      "description": "Require at least one selected source availability.",
      "items": {
        "type": "string",
        "enum": [
          "live",
          "persisted"
        ]
      }
    },
    "event_seq_from": {
      "type": "integer",
      "description": "Inclusive event sequence lower bound."
    },
    "event_seq_to": {
      "type": "integer",
      "description": "Inclusive event sequence upper bound."
    },
    "event_time_from": {
      "type": "string",
      "description": "Inclusive timezone-qualified ISO 8601 event-time lower bound."
    },
    "event_time_to": {
      "type": "string",
      "description": "Inclusive timezone-qualified ISO 8601 event-time upper bound."
    },
    "event_types": {
      "type": "array",
      "description": "Event types to include.",
      "items": {
        "type": "string"
      }
    },
    "event_surfaces": {
      "type": "array",
      "description": "Event surfaces to include.",
      "items": {
        "type": "string",
        "enum": [
          "current",
          "shadowed",
          "log-only"
        ]
      }
    }
  },
  "required": [
    "query"
  ]
}
```

来源：[`packages/session-query/tool-session-query/src/index.ts`](../packages/session-query/tool-session-query/src/index.ts)

### `session_trace`

读取围绕一个会话的已授权会话谱系，包括完整可见的祖先和后代关系。

```json
{
  "type": "object",
  "properties": {
    "session_id": {
      "type": "string",
      "description": "Target session id. Omit for the current session."
    }
  }
}
```

来源：[`packages/session-query/tool-session-query/src/index.ts`](../packages/session-query/tool-session-query/src/index.ts)

这 5 个只读工具会隐藏提供方游标，并根据不可变的调用 agent 会话为每个结果授权。该包需要选择启用；需要强制截止时间或限制行内输出的组合还会挂载通用超时或 spill 策略。

<a id="aeventool-subagent"></a>

## `@aeven/tool-subagent`

### `list_subagent_models`

发现 subagent 可用的 LLM 路由，不更改当前 Agent。无参数调用会列出已注册提供方；提供 `provider` 时会列出其公布的模型；同时提供 `provider` 和 `model` 时会检查该精确模型及其推理强度。目录条目只提供建议：adapter 可能接受未列出的模型 id。把返回的 id 用于委派工具的 `provider`、`model` 与 `reasoning_effort` 字段。

```json
{
  "type": "object",
  "properties": {
    "provider": {
      "type": "string",
      "description": "Registered LLM provider id. Omit to list providers."
    },
    "model": {
      "type": "string",
      "description": "Exact model id to inspect. Requires provider; omit to list that provider's advertised models."
    }
  }
}
```

来源：[`packages/subagent/tool-subagent/src/list-models.ts`](../packages/subagent/tool-subagent/src/list-models.ts)

### `subagent`

将一项自包含任务委派给 subagent（在自身上下文中工作的独立 agent），用它卸载聚焦且独立的工作，例如研究、限定范围的实现或分析，以免消耗当前对话的上下文。subagent 会返回结果，但不会返回中间步骤。请提供完整、独立的提示词，因为它看不到当前对话。此调用默认等待结果。设置 `run_in_background: true` 可返回 job id；使用 `job_output` 收集结果，使用 `job_kill` 停止任务。

```json
{
  "type": "object",
  "properties": {
    "description": {
      "type": "string",
      "description": "A short (3-5 word) description of the delegated task, for display."
    },
    "prompt": {
      "type": "string",
      "description": "The complete, self-contained task for the subagent. It does not share this conversation's context, so include everything it needs."
    },
    "run_in_background": {
      "type": "boolean",
      "description": "Whether to run as a background job and return its id. Defaults to false; collect with job_output or stop with job_kill."
    }
  },
  "required": [
    "description",
    "prompt"
  ]
}
```

来源：[`packages/subagent/tool-subagent/src/index.ts`](../packages/subagent/tool-subagent/src/index.ts)

注册的委派工具名称取决于加载时 `toolName` 配置（默认为 `subagent`）；上述默认 schema 关闭模型选择，而发现 schema 则展示为已启用 Session 中可用的固定配套工具。Web preset 会在每个新顶层 Session 创建时读取插件页偏好，并为其子 Session 保留该决定；`subagent_fork` 始终使用固定路由。每个实例通过 `modelSelectionSettings`、`backgroundMode` 与 `enableRunInBackground` 独立控制是否读取模型选择设置及其后台行为。

<a id="aeventool-subagent-control"></a>

## `@aeven/tool-subagent-control`

### `interrupt_agent`

根据 agent id 请求取消后台 agent 的当前轮次。目标可以是你的直接子级，也可以是在你下方创建的更深层 agent。只有当前轮次会停止：已经排队发给该 agent 的消息会一直搁置到后续的 send_message；它启动的 agent 会继续运行；该 agent 本身仍可接受后续操作。停止请求被接受后，此调用立即返回，因此目标可能还会短暂运行；中断一个已经完成的 agent 是可接受的空操作。

```json
{
  "type": "object",
  "properties": {
    "agent_id": {
      "type": "string",
      "description": "The agent id of the running agent to interrupt."
    }
  },
  "required": [
    "agent_id"
  ]
}
```

来源：[`packages/subagent/tool-subagent-control/src/index.ts`](../packages/subagent/tool-subagent-control/src/index.ts)

### `list_agents`

按持久 id 和标签列出你的可继续后台 subagent。用它回忆你启动过哪些 subagent，而不是轮询完成情况——subagent 完成时你会被告知。状态来自实时注册表：running 表示 agent 此刻正在工作；idle 表示已加载但处于轮次之间，可能正在等待它启动的 agent；ready 表示它只存在于存储中——可恢复而非终态，也不表示有结果等待收集；`send_message` 会在运行中 child 的最近 step 边界 steer 消息，或为 idle、ready child 启动轮次，且无论处于哪种状态，直接子级都仍可作为 `send_message` 的目标。该快照并非投递承诺；`send_message` 会执行权威检查，仍可能失败。无法读取的子级会作为诊断信息报告，而不会被静默丢弃。`descendants` 作用域会按稳定的前序顺序遍历你下方的整棵树，并为每个条目标注其持久的直接父会话 id 和深度。只有深度为 1 的条目可以使用 `send_message`；更深的条目只能作为 `interrupt_agent` 的候选目标。

```json
{
  "type": "object",
  "properties": {
    "scope": {
      "type": "string",
      "description": "children (default) lists direct children only; descendants walks the complete tree below you.",
      "enum": [
        "children",
        "descendants"
      ]
    }
  }
}
```

来源：[`packages/subagent/tool-subagent-control/src/list-agents.ts`](../packages/subagent/tool-subagent-control/src/list-agents.ts)

### `send_message`

根据 agent id 向直接可继续 child 发送消息。如果你是驻留的可继续 child，也可以把自己的直接 parent 作为目标。如果目标仍在工作，消息会 steer 其最近的 step；如果目标处于 idle，消息会启动一个轮次。此调用不会返回该 agent 的答案，只会确认消息已投递。调用失败表示消息**未**投递。

```json
{
  "type": "object",
  "properties": {
    "agent_id": {
      "type": "string",
      "description": "The agent id of your direct continuable child, or your direct parent when you are a resident continuable child."
    },
    "message": {
      "type": "string",
      "description": "The message to deliver to the agent."
    }
  },
  "required": [
    "agent_id",
    "message"
  ]
}
```

来源：[`packages/subagent/tool-subagent-control/src/index.ts`](../packages/subagent/tool-subagent-control/src/index.ts)

这些是控制可继续后台 subagent 的全局命名工具：绑定提供方的 `tool-subagent` 实例注册不同的委派工具；本包注册一次 `send_message` 和 `interrupt_agent`，另由 `list_agents` 通过单独加载的 `/list-agents` 插件提供，其目录行使用 sessionProjections 和实时 Agent 注册表。

<a id="aeventool-jobs"></a>

## `@aeven/tool-jobs`

### `job_kill`

根据 job id 请求取消正在运行的后台任务。此调用立即返回；任务的工作真正停止后，会以 killed 状态结算。

```json
{
  "type": "object",
  "properties": {
    "job_id": {
      "type": "string",
      "description": "Job id returned by the tool that started the background work."
    },
    "reason": {
      "type": "string",
      "description": "Optional short reason, recorded in the log and forwarded to the job."
    }
  },
  "required": [
    "job_id"
  ]
}
```

来源：[`packages/jobs/tool-jobs/src/index.ts`](../packages/jobs/tool-jobs/src/index.ts)

### `job_list`

列出你的后台任务（包括正在运行和已完成的任务）及其 id、种类和状态。

```json
{
  "type": "object",
  "properties": {}
}
```

来源：[`packages/jobs/tool-jobs/src/index.ts`](../packages/jobs/tool-jobs/src/index.ts)

### `job_output`

读取后台任务。流式任务只返回自上次读取以来的输出；最终输出任务会在结算后返回结果。每个响应都以 `[status: ...]` 结尾。读取默认不阻塞；设置 `wait: true` 后，最长等待到配置的上限。

```json
{
  "type": "object",
  "properties": {
    "job_id": {
      "type": "string",
      "description": "Job id returned by the tool that started the background work."
    },
    "wait": {
      "type": "boolean",
      "description": "Block until the job finishes, the timeout expires, or the user sends a message; an unfinished wait leaves the job running. Defaults to false."
    },
    "timeout_ms": {
      "type": "number",
      "description": "Max wait in milliseconds with wait: true. Defaults to and is capped by configuration."
    }
  },
  "required": [
    "job_id"
  ]
}
```

来源：[`packages/jobs/tool-jobs/src/index.ts`](../packages/jobs/tool-jobs/src/index.ts)

与任务种类无关的后台任务控制器：后台 bash 命令、PTY 发送和 subagent 都通过相同的 3 个工具读取、列出和终止。加载该插件会挂接控制器，从而启用生产方的 `ctx.jobs.start()`。

<a id="aevenexperimental-tool-agent-team"></a>

## `@aeven/experimental-tool-agent-team`

### `followup_task`

向另一名 Team member 发送持久 follow-up task，并在需要时启动一个 turn。

```json
{
  "type": "object",
  "properties": {
    "target": {
      "type": "string",
      "description": "Team member name, or lead."
    },
    "message": {
      "type": "string",
      "description": "Self-contained message for the target."
    }
  },
  "required": [
    "target",
    "message"
  ]
}
```

来源：[`packages/experimental/tool-agent-team/src/index.ts`](../packages/experimental/tool-agent-team/src/index.ts)

### `interrupt_agent`

中断一名 teammate 的当前 turn，同时保留其待处理 inbox。仅 Team Lead 可用。

```json
{
  "type": "object",
  "properties": {
    "target": {
      "type": "string",
      "description": "Teammate name."
    }
  },
  "required": [
    "target"
  ]
}
```

来源：[`packages/experimental/tool-agent-team/src/index.ts`](../packages/experimental/tool-agent-team/src/index.ts)

### `list_agents`

列出 Lead 与所有持久 teammate，以及各自当前的运行时状态。

```json
{
  "type": "object",
  "properties": {}
}
```

来源：[`packages/experimental/tool-agent-team/src/index.ts`](../packages/experimental/tool-agent-team/src/index.ts)

### `send_message`

向另一名 Team member 发送持久信息，但不启动 idle member。

```json
{
  "type": "object",
  "properties": {
    "target": {
      "type": "string",
      "description": "Team member name, or lead."
    },
    "message": {
      "type": "string",
      "description": "Self-contained message for the target."
    }
  },
  "required": [
    "target",
    "message"
  ]
}
```

来源：[`packages/experimental/tool-agent-team/src/index.ts`](../packages/experimental/tool-agent-team/src/index.ts)

### `spawn_teammate`

创建一名具名、持久的 teammate。只有 Team Lead 可以调用此工具。

```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "description": "Unique lower-kebab-case teammate name."
    },
    "description": {
      "type": "string",
      "description": "Short description of the delegated responsibility."
    },
    "prompt": {
      "type": "string",
      "description": "Complete initial task for the teammate."
    },
    "context": {
      "type": "string",
      "description": "fresh starts without Lead history; fork inherits completed Lead turns. Defaults to fresh.",
      "enum": [
        "fresh",
        "fork"
      ]
    }
  },
  "required": [
    "name",
    "description",
    "prompt"
  ]
}
```

来源：[`packages/experimental/tool-agent-team/src/index.ts`](../packages/experimental/tool-agent-team/src/index.ts)

### `team_task_create`

在共享 Team 任务板上创建一个无 owner 的 pending task。

```json
{
  "type": "object",
  "properties": {
    "subject": {
      "type": "string",
      "description": "Concise task title."
    },
    "description": {
      "type": "string",
      "description": "Complete task details and acceptance criteria."
    },
    "blocked_by": {
      "type": "array",
      "description": "Task ids that must complete first.",
      "items": {
        "type": "string"
      }
    },
    "write_scopes": {
      "type": "array",
      "description": "Advisory workspace-relative file or directory prefixes this task expects to modify.",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "subject",
    "description"
  ]
}
```

来源：[`packages/experimental/tool-agent-team/src/index.ts`](../packages/experimental/tool-agent-team/src/index.ts)

### `team_task_get`

在修改或执行共享任务前，读取其完整的最新值。

```json
{
  "type": "object",
  "properties": {
    "task_id": {
      "type": "string",
      "description": "Shared task id."
    }
  },
  "required": [
    "task_id"
  ]
}
```

来源：[`packages/experimental/tool-agent-team/src/index.ts`](../packages/experimental/tool-agent-team/src/index.ts)

### `team_task_list`

列出共享任务，包括 readiness、owner、revision、blocker 与 write-scope warning。

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "description": "Optional exact status filter.",
      "enum": [
        "pending",
        "in_progress",
        "completed"
      ]
    },
    "owner": {
      "type": "string",
      "description": "Optional member-name filter; use unowned for tasks without an owner."
    },
    "ready": {
      "type": "boolean",
      "description": "Optional readiness filter."
    },
    "cursor": {
      "type": "integer",
      "description": "Zero-based result offset. Defaults to 0."
    },
    "limit": {
      "type": "integer",
      "description": "Number of rows, 1 through 100. Defaults to 50."
    }
  }
}
```

来源：[`packages/experimental/tool-agent-team/src/index.ts`](../packages/experimental/tool-agent-team/src/index.ts)

### `team_task_update`

使用 team_task_get 或 team_task_list 返回的最新 revision，对共享任务操作执行 compare-and-set。

```json
{
  "type": "object",
  "properties": {
    "task_id": {
      "type": "string",
      "description": "Shared task id."
    },
    "expected_revision": {
      "type": "integer",
      "description": "Current task revision used as the CAS precondition."
    },
    "action": {
      "type": "string",
      "description": "Task transition to apply.",
      "enum": [
        "claim",
        "release",
        "edit",
        "set_dependencies",
        "complete",
        "reopen",
        "reassign",
        "delete"
      ]
    },
    "subject": {
      "type": "string",
      "description": "Replacement title for edit."
    },
    "description": {
      "type": "string",
      "description": "Replacement details for edit."
    },
    "blocked_by": {
      "type": "array",
      "description": "Complete blocker list for set_dependencies.",
      "items": {
        "type": "string"
      }
    },
    "write_scopes": {
      "type": "array",
      "description": "Replacement advisory write scopes for edit.",
      "items": {
        "type": "string"
      }
    },
    "owner": {
      "type": "string",
      "description": "Member name for Lead-only reassign; omit to unassign."
    }
  },
  "required": [
    "task_id",
    "expected_revision",
    "action"
  ]
}
```

来源：[`packages/experimental/tool-agent-team/src/index.ts`](../packages/experimental/tool-agent-team/src/index.ts)

### `wait_agent`

等待本次调用开始后下一次 teammate 状态、mailbox 或共享任务变更。它绝不会唤醒 inactive member；若没有其他 member 正在 running 或 provisioning，则立即返回 noProgress。唤醒或超时后应重新列出状态，而不是轮询。

```json
{
  "type": "object",
  "properties": {
    "timeout_ms": {
      "type": "integer",
      "description": "Wait duration in milliseconds, from 10000 through 3600000. Defaults to 30000."
    }
  }
}
```

来源：[`packages/experimental/tool-agent-team/src/index.ts`](../packages/experimental/tool-agent-team/src/index.ts)

这 10 个工具限定于隐式 Team Lead 与持久 teammate 作用域。随产品发布的 avn-base bundle 默认禁用该包；文档中的 Agent Teams profile patch 会启用它，并禁用旧 continuable child 的同名控制工具。

<a id="aeventool-media"></a>

## `@aeven/tool-media`

### `generate_image`

从文本 prompt 生成图像并附加到会话中。当用户要求创建、绘制或生成图片时使用。请给出涵盖主体、构图、风格与光照的完整视觉 prompt。图像会直接附加到本次会话；不要调用其他工具去定位或校验它。

```json
{
  "type": "object",
  "properties": {
    "prompt": {
      "type": "string",
      "description": "The user-supplied image prompt verbatim when provided; otherwise a visual description based on their request."
    },
    "model": {
      "type": "string",
      "description": "Optional model id for this call only, verbatim, from the available models. Omit to use the selected default."
    },
    "n": {
      "type": "integer",
      "description": "How many images to generate, at most the count the chosen model's description states. Omit for one."
    },
    "size": {
      "type": "string",
      "description": "Pixel size in WIDTHxHEIGHT form, e.g. '1024x1024' or '2730x1536' for 16:9, or a named size the chosen model lists in its description, e.g. '2K'. Never a tier the model does not list. Omit for the model default."
    },
    "background": {
      "type": "string",
      "description": "Background to generate, for a model that offers the option. Omit to let the model decide.",
      "enum": [
        "transparent",
        "opaque"
      ]
    },
    "resolution": {
      "type": "string",
      "description": "A resolution tier the chosen model lists in its description, e.g. 2K. Use either resolution or size."
    },
    "seed": {
      "type": "integer",
      "description": "Provider seed, where the chosen model lists one; a fixed seed does not guarantee reproducible images."
    },
    "guidance_scale": {
      "type": "number",
      "description": "Prompt guidance strength, where the chosen model lists it; the Aeven models have none."
    },
    "output_format": {
      "type": "string",
      "description": "Output file format, where the chosen model lists it.",
      "enum": [
        "png",
        "jpeg"
      ]
    },
    "optimize_prompt_mode": {
      "type": "string",
      "description": "Prompt optimization, where the chosen model lists it: standard for quality, fast for lower latency.",
      "enum": [
        "standard",
        "fast"
      ]
    },
    "reference_images": {
      "type": "array",
      "description": "Paths of existing images to edit or draw from, in the order the prompt refers to them: workspace files, or the normalized copy path shown for a conversation image.",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "prompt"
  ]
}
```

来源：[`packages/media/tool-media/src/index.ts`](../packages/media/tool-media/src/index.ts)

### `generate_video`

从文本提示词生成视频片段，可选以一张图像为起点，并附加到会话中。仅在用户当前明确要求生成一个视频时调用。反馈、问题、图片编辑和先前的请求不授权再次渲染。没有新的用户批准，不得重试失败的生成或更改其模型或设置。每次调用在花费前都会等待独立的用户确认。请给出涵盖主体、动作、镜头运动、风格与光照的完整提示词。生成需要数分钟。要动画化已有图像时，把它作为 reference_images 的第一张传入；第二张图像是尾帧。视频会连同播放控件直接展示给用户。不要在你的回复中重复或嵌入它、写出视频路径，或调用其他工具去定位或校验它。

```json
{
  "type": "object",
  "properties": {
    "prompt": {
      "type": "string",
      "description": "Complete description of the video to generate."
    },
    "model": {
      "type": "string",
      "description": "Optional model id for this call only, verbatim, from the available models. Omit to use the selected default."
    },
    "duration": {
      "type": "integer",
      "description": "Clip length in seconds the chosen model lists — a range, or only fixed lengths such as 4, 6 or 8 — or -1 to let the model decide where it offers that. Omit for the model default."
    },
    "resolution": {
      "type": "string",
      "description": "An output resolution the chosen model lists, e.g. 720p. Omit for the model default."
    },
    "aspect_ratio": {
      "type": "string",
      "description": "An aspect ratio the chosen model lists, e.g. '16:9' or '9:16', or 'adaptive' to follow the first frame. Omit for the model default."
    },
    "seed": {
      "type": "integer",
      "description": "Provider seed, where the chosen model lists one; a fixed seed does not guarantee a reproducible clip."
    },
    "generate_audio": {
      "type": "boolean",
      "description": "Whether the clip carries audio synchronized with the visuals, where the chosen model offers it."
    },
    "reference_images": {
      "type": "array",
      "description": "Paths of at most two images: the first frame, then optionally the last frame. Workspace files, or the normalized copy path shown for a conversation image.",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "prompt"
  ]
}
```

来源：[`packages/media/tool-media/src/index.ts`](../packages/media/tool-media/src/index.ts)

本目录以未配置模型的形态挂载该工具，这种形态要求每次调用自行指明模型。设置了 `model` 的部署得到的是同一份 Schema；默认值不会进入描述。生成的字节经 `ctx.attachments` 存储，因此结果携带的图像块无需在此注册任何东西即可被会话卡片渲染。

<a id="aeventool-working-directory"></a>

## `@aeven/tool-working-directory`

### `working_directory`

读取或切换本会话的工作目录。不给路径时报告当前目录。给出路径时解析它（绝对路径，或相对于当前目录），要求目标是一个已存在的目录，并将其设为后续所有文件、shell 与搜索调用解析相对路径所依据的目录。该变更在本次会话余下时间持续；没有可弹出的目录栈。

```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "description": "Directory to enter: absolute, or relative to the current working directory. Omit to read the current directory."
    }
  }
}
```

来源：[`packages/session/tool-working-directory/src/index.ts`](../packages/session/tool-working-directory/src/index.ts)

本目录同时挂载该容量与该工具，因为工具读取的目录由服务解析。一次变更追加 `session/cwd`，按最后一条重放：恢复或分叉的会话继续在日志记录的目录中，下一次调用相对于它解析相对路径。

<a id="aeventool-worktrees"></a>

## `@aeven/tool-worktrees`

### `create_worktree`

在新的分支上创建 git 工作树，并把本会话移入其中。当一个任务需要自己的检出时使用：在同一仓库上与另一个智能体并行工作、尝试改动而不触碰主工作树，或者在开始别的事情时保留一个构建原地不动。新检出从 HEAD 或你指明的版本创建；当前检出中尚未提交的改动不会带过去。此后每次文件、shell 与搜索调用都针对它解析，文件写入被限制在其中。子智能体会自动获得自己的工作树。

```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "description": "Worktree name: letters, digits, dots, dashes, or underscores. The branch and the checkout directory both use it. Omit for a generated name."
    },
    "from": {
      "type": "string",
      "description": "Revision the new branch starts from: a branch, tag, or commit. Defaults to HEAD of the session's repository."
    }
  }
}
```

来源：[`packages/session/tool-worktrees/src/index.ts`](../packages/session/tool-worktrees/src/index.ts)

### `remove_worktree`

在分支已合并或不再需要时，移除由 create_worktree 或为子智能体创建的 git 工作树。不指定名称时，移除本会话所在的工作树，并把会话移回仓库的主检出。工作树有未提交改动时失败。设置 delete_branch 时也删除其分支；分支尚未合并时 git 会拒绝。

```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "description": "Name of the worktree to remove, as its directory and branch name it (without the branch prefix). Omit to remove the worktree this session works in."
    },
    "delete_branch": {
      "type": "boolean",
      "description": "Also delete the worktree's branch. Git refuses while the branch is not merged."
    }
  }
}
```

来源：[`packages/session/tool-worktrees/src/index.ts`](../packages/session/tool-worktrees/src/index.ts)

本目录同时挂载该能力与工具，因为 `create_worktree` 和 `remove_worktree` 通过 `workingDirectory` 移动会话，而同一次调用随后报告该目录。检出目录、分支前缀、git 宽限期、子智能体隔离和依赖准备都是无默认值的 Config；基础 bundle 把检出放在 `$AVN_HOME/worktrees` 下，为分支添加 `avn/` 前缀，隔离子智能体，并用检出中锁文件对应的包管理器安装依赖。

<a id="aeventool-todo"></a>

## `@aeven/tool-todo`

### `todo_write`

记录并更新任务列表，用于规划多步骤工作并展示进度；简单的单步任务可跳过不用。开始前为每个具体步骤添加一项 todo。只要工作尚未完成，就把正在处理的 todo 保持为 `in_progress`，仅在确实并行时同时标记多项。每项 todo 完成后立即标记为 `completed`。

```json
{
  "type": "object",
  "properties": {
    "todos": {
      "type": "array",
      "description": "The COMPLETE task list, replacing any previous list.",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "content": {
            "type": "string",
            "description": "What the task is — a short imperative line."
          },
          "status": {
            "type": "string",
            "description": "pending (not started) | in_progress (now) | completed (done).",
            "enum": [
              "pending",
              "in_progress",
              "completed"
            ]
          }
        },
        "required": [
          "content",
          "status"
        ]
      }
    }
  },
  "required": [
    "todos"
  ]
}
```

来源：[`packages/todo/tool-todo/src/index.ts`](../packages/todo/tool-todo/src/index.ts)

todo_write 是会话所有的状态；UI 将最新的 todo/write 事件渲染为检查清单。`allowParallelInProgress` 是没有默认值的必填项，因此本目录明确选择 `true`，对应描述允许同时存在多个 `in_progress` 项。选择 `false` 的部署会获得同一工具，但描述会要求只能有 1 个活动任务。

<a id="aeventool-workflow"></a>

## `@aeven/tool-workflow`

### `workflow`

运行用于大规模编排 subagent 的 JavaScript 工作流脚本。当工作会分散到许多相互独立的部分时，请使用此工具，例如审查大量文件、执行迁移、开展多角度研究或对发现进行对抗式验证；此时应将编排写成脚本，而不是逐轮委派。

工作流的身份通过 `meta` 参数以 JSON 形式传入：必填的 `name`（简短 kebab-case）和 `description` 字符串，以及可选的 `whenToUse` 字符串和 `phases` 数组（`{title, detail?, provider?, model?}`）。`script` 参数只能是纯 JavaScript **函数体**，不能是 TypeScript，也不能包含 `export const meta` 语句；meta 是参数而非代码。脚本支持顶层 await；请以 `return <value>` 结尾，该值必须可以 JSON 序列化，并作为此工具的结果。

脚本函数体提供以下钩子：
- `agent(prompt, opts?): Promise<any>`：运行一个 subagent 直至完成。不提供 `opts.schema` 时，解析为子级最终文本；提供 `opts.schema` 时，它必须是以对象为根、且**只能**使用 type/properties/required/additionalProperties/items/enum/const/oneOf 的 JSON Schema，不支持 pattern/format/数值边界，此时解析为通过校验的对象。子级失败时解析为 `null`，可使用 `.filter(Boolean)` 过滤。其他选项包括 `label`（显示名称）、`phase`（进度组），以及相互独立的 `provider`／`model` LLM（大语言模型）目标覆盖项，两者可单独提供。其他任何选项（`effort`／`isolation`／`agentType`）都会明确报错。
- `pipeline(items, ...stages): Promise<any[]>`：让每个条目分别经过各阶段，阶段之间**没有**屏障；多阶段工作优先使用它。每个阶段接收 `(prev, item, index)`。普通的阶段异常会将该**条目**变为 `null`，并跳过它的剩余阶段。
- `parallel(thunks): Promise<any[]>`：并发运行零参数函数并等待**全部**完成。它会形成屏障，仅当某个阶段确实需要汇总全部先前结果时使用。抛出异常的 thunk 解析为 `null`。
- `phase(title)`：开始一个进度阶段；`log(message)`：说明进度；`args`：工具调用的 `args` 输入，原样提供。

如果误用钩子（参数错误、未知选项、不受支持的 schema、触发上限），抛出的错误**总会**终止脚本，绝不会退化为单个条目的 `null`。

约束：并发上限和 agent 总数上限均会生效；不提供文件系统、网络、定时器或 Node.js API。具体工作由 agent 完成，脚本只负责编排。该运行在前台执行：整个脚本完成后，调用才会返回。

```json
{
  "type": "object",
  "properties": {
    "script": {
      "type": "string",
      "description": "The plain-JS workflow script body (top-level await allowed; NO `export const meta` statement; end with `return <json-value>`)."
    },
    "meta": {
      "type": "object",
      "description": "The workflow identity block (plain JSON — never code).",
      "additionalProperties": true,
      "properties": {
        "name": {
          "type": "string",
          "description": "Short kebab-case workflow name."
        },
        "description": {
          "type": "string",
          "description": "One-line description of what the workflow does."
        },
        "whenToUse": {
          "type": "string",
          "description": "Optional guidance on when this workflow applies."
        },
        "phases": {
          "type": "array",
          "description": "Optional phase declarations matched by phase() calls.",
          "items": {
            "type": "object",
            "additionalProperties": true,
            "properties": {
              "title": {
                "type": "string",
                "description": "The phase title phase() calls match by exact string."
              },
              "detail": {
                "type": "string",
                "description": "Optional one-line description of the phase."
              },
              "provider": {
                "type": "string",
                "description": "Optional provider override this phase is expected to use."
              },
              "model": {
                "type": "string",
                "description": "Optional model override this phase is expected to use."
              }
            },
            "required": [
              "title"
            ]
          }
        }
      },
      "required": [
        "name",
        "description"
      ]
    },
    "args": {
      "type": "object",
      "description": "Optional JSON input exposed to the script as the `args` global (wrap a bare list as a field, e.g. {\"files\": [...]}).",
      "additionalProperties": true
    }
  },
  "required": [
    "script",
    "meta"
  ]
}
```

来源：[`packages/workflow/tool-workflow/src/index.ts`](../packages/workflow/tool-workflow/src/index.ts)

<a id="aeventool-web"></a>

## `@aeven/tool-web`

### `web_fetch`

获取指定 HTTP(S) URL 的内容，并将其解码为文本后返回。

```json
{
  "type": "object",
  "properties": {
    "url": {
      "type": "string",
      "description": "The HTTP(S) URL to fetch."
    }
  },
  "required": [
    "url"
  ]
}
```

来源：[`packages/web/tool-web/src/index.ts`](../packages/web/tool-web/src/index.ts)

### `web_search`

在 Web 上搜索最新信息。返回可选的摘要答案和来源 URL 列表。

```json
{
  "type": "object",
  "properties": {
    "queries": {
      "type": "array",
      "description": "Required search queries; accepts 1–4 items and merges their results.",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "queries"
  ]
}
```

来源：[`packages/web/tool-web/src/index.ts`](../packages/web/tool-web/src/index.ts)

web_search 和 web_fetch 将提供方选择置于 ctx.web 之后，使模型可见 schema 在更换后端时保持稳定。

<a id="aeventool-browser"></a>

## `@aeven/tool-browser`

### `preview_back`

在协作浏览器标签页中后退一页，并显示按下该控件的指针。

```json
{
  "type": "object",
  "properties": {}
}
```

来源：[`packages/web/tool-browser/src/index.ts`](../packages/web/tool-browser/src/index.ts)

### `preview_click`

在协作浏览器标签页中点击恰好一个目标。优先使用 preview_snapshot 返回的选择器；x 与 y 必须同时提供。

```json
{
  "type": "object",
  "properties": {
    "selector": {
      "type": "string",
      "description": "CSS selector such as button[type='submit'], from preview_snapshot's interactiveElements."
    },
    "token": {
      "type": "string",
      "description": "Element token from the latest preview_snapshot with mode ax. Valid until the next browser action; do not combine with selector or coordinates."
    },
    "x": {
      "type": "number",
      "description": "Viewport-relative X coordinate in CSS pixels. Must be paired with y."
    },
    "y": {
      "type": "number",
      "description": "Viewport-relative Y coordinate in CSS pixels. Must be paired with x."
    }
  }
}
```

来源：[`packages/web/tool-browser/src/index.ts`](../packages/web/tool-browser/src/index.ts)

### `preview_evaluate`

在协作浏览器标签页中求值 JavaScript。返回 {value}，其中为可序列化的结果，最大 64 KB；表达式可能会改变页面状态。

```json
{
  "type": "object",
  "properties": {
    "expression": {
      "type": "string",
      "description": "JavaScript expression evaluated in the page's main frame, for example document.title or (() => ({href: location.href}))()."
    }
  },
  "required": [
    "expression"
  ]
}
```

来源：[`packages/web/tool-browser/src/index.ts`](../packages/web/tool-browser/src/index.ts)

### `preview_forward`

在协作浏览器标签页中前进一页，并显示按下该控件的指针。

```json
{
  "type": "object",
  "properties": {}
}
```

来源：[`packages/web/tool-browser/src/index.ts`](../packages/web/tool-browser/src/index.ts)

### `preview_navigate`

在协作浏览器标签页中导航。该浏览器处于关闭状态时，会在会话旁将其打开。当用户要求打开、访问或前往某个网站或 URL 时都应使用该工具，而不是用会另开一个浏览器的 shell 命令。传入 {url:'https://t3.chat'} 访问网站，或传入本地开发服务器 URL 访问本地开发服务器。

```json
{
  "type": "object",
  "properties": {
    "url": {
      "type": "string",
      "description": "Website URL. Use this for public pages and directly reachable URLs."
    }
  },
  "required": [
    "url"
  ]
}
```

来源：[`packages/web/tool-browser/src/index.ts`](../packages/web/tool-browser/src/index.ts)

### `preview_press`

在协作浏览器标签页中按下单个按键。例如 {key:'Enter'}、{key:'Escape'}，或 {key:'a',modifiers:['Meta']}。

```json
{
  "type": "object",
  "properties": {
    "key": {
      "type": "string",
      "description": "Keyboard key name such as Enter, Escape, Tab, ArrowDown, Backspace, or a single character."
    },
    "modifiers": {
      "type": "array",
      "description": "Modifier keys held while pressing key.",
      "items": {
        "type": "string",
        "enum": [
          "Alt",
          "Control",
          "Meta",
          "Shift"
        ]
      }
    }
  },
  "required": [
    "key"
  ]
}
```

来源：[`packages/web/tool-browser/src/index.ts`](../packages/web/tool-browser/src/index.ts)

### `preview_reload`

重新加载协作浏览器标签页中的页面，并显示按下该控件的指针。

```json
{
  "type": "object",
  "properties": {}
}
```

来源：[`packages/web/tool-browser/src/index.ts`](../packages/web/tool-browser/src/index.ts)

### `preview_screenshot`

把协作浏览器的可见视口捕获为 JPEG 图片。需要页面像素时使用它；普通交互请改为查看无障碍树或 DOM 状态。

```json
{
  "type": "object",
  "properties": {}
}
```

来源：[`packages/web/tool-browser/src/index.ts`](../packages/web/tool-browser/src/index.ts)

### `preview_scroll`

滚动协作浏览器标签页。deltaY 为正时向下滚动，deltaX 为正时向右滚动；传入选择器可指定某个容器。

```json
{
  "type": "object",
  "properties": {
    "deltaX": {
      "type": "number",
      "description": "Horizontal scroll delta in CSS pixels. Positive scrolls right. Defaults to 0."
    },
    "deltaY": {
      "type": "number",
      "description": "Vertical scroll delta in CSS pixels. Positive scrolls down. Defaults to 0."
    },
    "selector": {
      "type": "string",
      "description": "CSS selector such as button[type='submit'], from preview_snapshot's interactiveElements."
    }
  }
}
```

来源：[`packages/web/tool-browser/src/index.ts`](../packages/web/tool-browser/src/index.ts)

### `preview_sequence`

在本浏览器中按顺序执行 1 到 20 个已知操作，无需模型往返。遇到第一个失败即停止并报告其索引。页面跳转请使用 wait 操作，而不是固定 sleep。先从页面取得选择器；只有当用户明确授权那次确切提交时，才包含最后的提交操作。

```json
{
  "type": "object",
  "properties": {
    "actions": {
      "type": "array",
      "description": "1 to 20 ordered actions. wait defaults to visible and enabled, with a 5000ms deadline; timeoutMs must be 1 to 60000.",
      "items": {
        "oneOf": [
          {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "operation": {
                "type": "string",
                "const": "click"
              },
              "selector": {
                "type": "string",
                "description": "CSS selector such as button[type='submit'], from preview_snapshot's interactiveElements."
              }
            },
            "required": [
              "operation",
              "selector"
            ]
          },
          {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "operation": {
                "type": "string",
                "const": "type"
              },
              "selector": {
                "type": "string",
                "description": "CSS selector such as button[type='submit'], from preview_snapshot's interactiveElements."
              },
              "text": {
                "type": "string"
              },
              "clear": {
                "type": "boolean"
              }
            },
            "required": [
              "operation",
              "text"
            ]
          },
          {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "operation": {
                "type": "string",
                "const": "press"
              },
              "key": {
                "type": "string"
              },
              "modifiers": {
                "type": "array",
                "items": {
                  "type": "string",
                  "enum": [
                    "Alt",
                    "Control",
                    "Meta",
                    "Shift"
                  ]
                }
              }
            },
            "required": [
              "operation",
              "key"
            ]
          },
          {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "operation": {
                "type": "string",
                "const": "upload"
              },
              "selector": {
                "type": "string",
                "description": "CSS selector such as button[type='submit'], from preview_snapshot's interactiveElements."
              },
              "paths": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              }
            },
            "required": [
              "operation",
              "paths"
            ]
          },
          {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "operation": {
                "type": "string",
                "const": "wait"
              },
              "selector": {
                "type": "string",
                "description": "CSS selector such as button[type='submit'], from preview_snapshot's interactiveElements."
              },
              "state": {
                "type": "string",
                "enum": [
                  "visible",
                  "hidden"
                ]
              },
              "timeoutMs": {
                "type": "number"
              }
            },
            "required": [
              "operation",
              "selector"
            ]
          }
        ]
      }
    }
  },
  "required": [
    "actions"
  ]
}
```

来源：[`packages/web/tool-browser/src/index.ts`](../packages/web/tool-browser/src/index.ts)

### `preview_snapshot`

交互前先检查页面。mode dom 返回可见文本与 CSS 选择器。mode ax 读取浏览器无障碍树（含 shadow DOM），并返回带索引的节点和 snapshot 作用域的 token。每次操作后都要重新获取；出现 truncated 表示节点已被省略。

```json
{
  "type": "object",
  "properties": {
    "mode": {
      "type": "string",
      "description": "Observation mode. Defaults to dom.",
      "enum": [
        "dom",
        "ax"
      ]
    }
  }
}
```

来源：[`packages/web/tool-browser/src/index.ts`](../packages/web/tool-browser/src/index.ts)

### `preview_status`

报告本会话可以驱动的每一个浏览器界面：其旁的协作浏览器中的页面（含 URL、标题与加载状态），以及部署挂载时本 Host 上的 Chromium。开始浏览器工作前先调用它，也包括页面拒绝普通抓取时。

```json
{
  "type": "object",
  "properties": {}
}
```

来源：[`packages/web/tool-browser/src/index.ts`](../packages/web/tool-browser/src/index.ts)

### `preview_type`

向协作浏览器标签页中的一个输入框插入字面文本。传入选择器时输入到该选择器，省略时输入到当前获得焦点的元素；设置 clear=true 可替换已有文本。

```json
{
  "type": "object",
  "properties": {
    "text": {
      "type": "string",
      "description": "Literal text to insert."
    },
    "selector": {
      "type": "string",
      "description": "CSS selector such as button[type='submit'], from preview_snapshot's interactiveElements."
    },
    "token": {
      "type": "string",
      "description": "Element token from the latest preview_snapshot with mode ax. Valid until the next browser action; do not combine with selector or coordinates."
    },
    "clear": {
      "type": "boolean",
      "description": "Clear the existing input value before inserting text. Defaults to false."
    }
  },
  "required": [
    "text"
  ]
}
```

来源：[`packages/web/tool-browser/src/index.ts`](../packages/web/tool-browser/src/index.ts)

### `preview_upload`

在此浏览器中附加本地文件。优先使用文件输入选择器；Upload 按钮选择器会在同一次操作中打开其文件选择器并完成应答。路径必须是 Electron 计算机上的绝对路径。远程上传需要审批。

```json
{
  "type": "object",
  "properties": {
    "selector": {
      "type": "string",
      "description": "CSS selector such as button[type='submit'], from preview_snapshot's interactiveElements."
    },
    "paths": {
      "type": "array",
      "description": "Absolute local file paths to attach.",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "paths"
  ]
}
```

来源：[`packages/web/tool-browser/src/index.ts`](../packages/web/tool-browser/src/index.ts)

preview_* 调用由持有该会话浏览器的客户端应答；每次调用都受工具超时上限约束。

<a id="aeventool-read-aloud"></a>

## `@aeven/tool-read-aloud`

### `read_aloud`

Turn spoken read-aloud of your replies on or off for this session. Switch it on when the user wants to hear the answers — language practice, pronunciation, or a hands-free conversation — and off when they ask you to stop. It changes only the reader; your replies themselves stay text.

```json
{
  "type": "object",
  "properties": {
    "enabled": {
      "type": "boolean",
      "description": "true to read your replies aloud from now on, false to stop reading them."
    }
  },
  "required": [
    "enabled"
  ]
}
```

Source: [`packages/speech/tool-read-aloud/src/index.ts`](../packages/speech/tool-read-aloud/src/index.ts)

The tool is a pure instruction: it logs the switch it was given and speaks nothing on the Host. The Web Surface reads the settled call and moves its own reader, so the model can start language practice without a Session event of its own.

<a id="aeventool-location"></a>

## `@aeven/tool-location`

### `get_location`

询问用户当前所在的位置。用户会批准其设备位置或拒绝；获批的位置返回 latitude、longitude 与 accuracyMeters。仅当任务需要知道用户身在何处（例如附近地点或本地天气）时才调用，绝不要根据其他数据推测位置。

```json
{
  "type": "object",
  "properties": {
    "purpose": {
      "type": "string",
      "description": "Why the location is needed, in one short sentence the user reads before choosing, for example \"To find pharmacies near you\"."
    }
  },
  "required": [
    "purpose"
  ]
}
```

来源：[`packages/interaction/tool-location/src/index.ts`](../packages/interaction/tool-location/src/index.ts)

get_location 由显示该会话的客户端在读者做出选择后应答；该调用受工具超时上限约束。

<a id="aeventool-capability"></a>

## `@aeven/tool-capability`

### `capability_manage`

把用户要求你学习或记住的流程保存到长期记忆中，之后的请求会回忆它。action 为 "learn" 时需要 kebab-case 名称、一行描述、domain 以及完整的 Markdown 流程。action 为 "import" 时会加入用户指定的 JSON 文件中的每条流程（由 name、description、content、domain 组成的数组），并在后台运行。

```json
{
  "type": "object",
  "properties": {
    "action": {
      "type": "string",
      "enum": [
        "learn",
        "import"
      ]
    },
    "file": {
      "type": "string",
      "description": "For import: absolute path of the JSON file the user named."
    },
    "name": {
      "type": "string",
      "description": "For learn: kebab-case procedure name, such as ableton-export-stems."
    },
    "description": {
      "type": "string",
      "description": "For learn: one line, what the procedure does and when to use it."
    },
    "domain": {
      "type": "string",
      "description": "\"world\" for how an application or tool works in any project, \"project\" for this workspace only, \"experience\" for other know-how. Default \"experience\".",
      "enum": [
        "world",
        "experience",
        "project"
      ]
    },
    "content": {
      "type": "string",
      "description": "For learn: the full procedure in Markdown: when to use it, requirements, steps, verification, recovery."
    }
  },
  "required": [
    "action"
  ]
}
```

来源：[`packages/capability/tool-capability/src/index.ts`](../packages/capability/tool-capability/src/index.ts)

注册的 action 取决于加载时的 `store` 配置：默认的 `memory` 会把学到的流程保存为长期记忆，且只注册 `learn` 与 `import`；`capabilities` 则把它保存为能力文件，并注册 list、view、learn、update、write_file、report、retire 与 restore。学习器与流程回忆都运行在同一包内，本身不贡献任何工具。

<a id="aeventool-device"></a>

## `@aeven/tool-device`

### `device_close`

从本会话旁的设备面板中移除一个设备。传入 shutdown=true 可同时关闭该模拟器或仿真器。

```json
{
  "type": "object",
  "properties": {
    "deviceId": {
      "type": "string",
      "description": "Device to close. Omit to close every device open in this session."
    },
    "hostId": {
      "type": "string",
      "description": "Device host from device_list. Defaults to this machine."
    },
    "shutdown": {
      "type": "boolean",
      "description": "Also power the simulator or emulator off. Defaults to false."
    }
  }
}
```

来源：[`packages/device/tool-device/src/index.ts`](../packages/device/tool-device/src/index.ts)

### `device_list`

列出设备 Host 上的 iOS 模拟器与 Android 仿真器、每个 Host 可以运行哪些平台，以及本会话旁已经打开的设备。当你不确定设备 id 时，在调用 device_open 之前先调用它。

```json
{
  "type": "object",
  "properties": {
    "hostId": {
      "type": "string",
      "description": "Limit to one device host. Defaults to all hosts."
    }
  }
}
```

来源：[`packages/device/tool-device/src/index.ts`](../packages/device/tool-device/src/index.ts)

### `device_open`

为本会话打开一个模拟器或仿真器：需要时先启动它，开启其实时串流，并在用户的设备面板中展示，以便用户观看。返回固定到该设备的 agent-device 命令；之后用它驱动设备。

```json
{
  "type": "object",
  "properties": {
    "deviceId": {
      "type": "string",
      "description": "Simulator udid or emulator serial from device_list. Omit to use the booted device for the platform, or the first one."
    },
    "platform": {
      "type": "string",
      "description": "Required when deviceId is omitted and both platforms are available.",
      "enum": [
        "ios",
        "android"
      ]
    },
    "hostId": {
      "type": "string",
      "description": "Device host from device_list. Defaults to this machine."
    }
  }
}
```

来源：[`packages/device/tool-device/src/index.ts`](../packages/device/tool-device/src/index.ts)

### `device_screenshot`

捕获本会话旁已打开设备的当前画面。用它查看用户所看到的内容；点击与文本输入请使用 device_open 返回的 agent-device 命令。

```json
{
  "type": "object",
  "properties": {
    "deviceId": {
      "type": "string",
      "description": "Device from device_list. Omit to use the device most recently opened in this session."
    },
    "hostId": {
      "type": "string",
      "description": "Device host from device_list. Defaults to this machine."
    }
  }
}
```

来源：[`packages/device/tool-device/src/index.ts`](../packages/device/tool-device/src/index.ts)

这 4 个工具在每个 Host 上都会注册；缺少 `ctx.devices`、关闭设备支持或没有 agent 访问权限的部署会返回各自的固定语句，而不是隐藏该工具。驱动设备要通过 `device_open` 返回的 agent-device CLI，而不是为每种设备操作提供一个工具。

<a id="aeventool-elevation"></a>

## `@aeven/tool-elevation`

仅限 Windows 的工具：用户在 Aeven 中批准这次运行，并在操作系统的授权提示中再次批准；拒绝会使调用失败，而不会以调用方自身的权限运行该命令。在非 Windows 上挂载本包的组合不会向模型提供任何内容。

<a id="aeventool-image-search"></a>

## `@aeven/tool-image-search`

### `find_images`

查找某个主题的真实照片——地点、建筑、物件、艺术品、产品、事件或人物——并以一行图片连同其来源展示给用户。当问题涉及某事物的实际外观、用户索要照片，或图片比文字更能给出答案时调用。它搜索 Wikimedia Commons 与 Web。绝不要描述你尚未展示的照片。新闻场景下，把你选定的文章作为 `urls` 传入并使用 layout `cards`：每篇文章会成为一张卡片，含其图片、标题、开头文字与来源。

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "What to photograph, in a few words, for example \"Crystal Palace Hyde Park 1851\" or \"Sagrada Familia interior\". With `urls`, what the stories are about, for example \"today's tech news\". Required without `urls`."
    },
    "urls": {
      "type": "array",
      "description": "With layout `cards`: the article pages to show, one card each, in the order you present the stories — at most 10. Give one article per story.",
      "items": {
        "type": "string"
      }
    },
    "count": {
      "type": "number",
      "description": "How many photographs to show, 1 to 6. Defaults to 3. Ignored with `urls`, which shows one card per article."
    },
    "layout": {
      "type": "string",
      "description": "How the reader sees them. `row` is a row of photographs, for pictures that carry the answer. `cards` is one thumbnail with its title and source beside it, for news items and headlines. Defaults to `row`.",
      "enum": [
        "row",
        "cards"
      ]
    },
    "language": {
      "type": "string",
      "description": "The language this conversation is using, so cards read in it. Translate nothing yourself: name the language here and the tool translates the headlines and openings with the session's own model."
    },
    "translations": {
      "type": "array",
      "description": "The items in the reader's own language, one entry per result in the same order, for a source published in another language. Call again with the same query and these to replace what the cards read.",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "title": {
            "type": "string"
          },
          "summary": {
            "type": "string"
          }
        },
        "required": [
          "title",
          "summary"
        ]
      }
    }
  }
}
```

来源：[`packages/web/tool-image-search/src/index.ts`](../packages/web/tool-image-search/src/index.ts)

`find_images` 先读 Wikimedia Commons，再读 Web seam，因此没有 Web 提供方的部署仍能作答，并引用 Commons 所持有的照片。每张照片和每张新闻卡片都会成为持久图像附件，由客户端在 transcript（文本记录）中展示。

<a id="aeventool-mail"></a>

## `@aeven/tool-mail`

### `mail_accounts`

列出用户已连接的邮箱账户，含其协议、能否发信、别名以及 IMAP 文件夹。在指定你尚未见过的账户或文件夹之前先调用它。

```json
{
  "type": "object",
  "properties": {}
}
```

来源：[`packages/mail/tool-mail/src/tools.ts`](../packages/mail/tool-mail/src/tools.ts)

### `mail_read`

读取一封邮件：头部、纯文本正文与附件列表。读取不会把它标记为已读。传入 saveAttachments 可把附件写入工作区。

```json
{
  "type": "object",
  "properties": {
    "account": {
      "type": "string",
      "description": "Account address."
    },
    "folder": {
      "type": "string",
      "description": "Folder path; defaults to INBOX."
    },
    "id": {
      "type": "string",
      "description": "Message id from mail_search."
    },
    "saveAttachments": {
      "type": "array",
      "description": "Attachment indexes to save.",
      "items": {
        "type": "integer"
      }
    },
    "saveTo": {
      "type": "string",
      "description": "Workspace-relative folder for saved attachments; defaults to mail-attachments."
    }
  },
  "required": [
    "account",
    "id"
  ]
}
```

来源：[`packages/mail/tool-mail/src/tools.ts`](../packages/mail/tool-mail/src/tools.ts)

### `mail_search`

搜索邮件信封（日期、发件人、收件人、主题、标志），最新的在前。省略 account 则搜索所有已连接的账户。多个过滤条件以 AND 组合。返回供 mail_read 与 mail_update 使用的 message id；不包含正文。

```json
{
  "type": "object",
  "properties": {
    "account": {
      "type": "string",
      "description": "Account address; omit to search all accounts."
    },
    "folder": {
      "type": "string",
      "description": "Folder path; defaults to INBOX."
    },
    "from": {
      "type": "string",
      "description": "Sender address or name contains this text."
    },
    "to": {
      "type": "string",
      "description": "Recipient address or name contains this text."
    },
    "subject": {
      "type": "string",
      "description": "Subject contains this text."
    },
    "text": {
      "type": "string",
      "description": "Headers or body contain this text (IMAP only)."
    },
    "since": {
      "type": "string",
      "description": "ISO date; received on or after."
    },
    "before": {
      "type": "string",
      "description": "ISO date; received before."
    },
    "unread": {
      "type": "boolean",
      "description": "true for unread only, false for read only (IMAP only)."
    },
    "limit": {
      "type": "integer",
      "description": "Maximum messages to return."
    }
  }
}
```

来源：[`packages/mail/tool-mail/src/tools.ts`](../packages/mail/tool-mail/src/tools.ts)

### `mail_send`

从已连接的账户发送纯文本邮件，或以 draft: true 保存为草稿。发送前总会先请用户批准。回复时传入 replyTo，并附上原邮件的文件夹与 id；主题随后默认为 "Re: …"。发件人必须是该账户地址或其别名之一。

```json
{
  "type": "object",
  "properties": {
    "account": {
      "type": "string",
      "description": "Account address to send from."
    },
    "from": {
      "type": "string",
      "description": "Sender address; defaults to the account address."
    },
    "to": {
      "type": "array",
      "description": "Recipient addresses.",
      "items": {
        "type": "string"
      }
    },
    "cc": {
      "type": "array",
      "description": "Cc addresses.",
      "items": {
        "type": "string"
      }
    },
    "bcc": {
      "type": "array",
      "description": "Bcc addresses.",
      "items": {
        "type": "string"
      }
    },
    "subject": {
      "type": "string",
      "description": "Subject; optional for a reply."
    },
    "text": {
      "type": "string",
      "description": "Plain-text body."
    },
    "replyTo": {
      "type": "object",
      "description": "The message being answered.",
      "additionalProperties": false,
      "properties": {
        "folder": {
          "type": "string"
        },
        "id": {
          "type": "string"
        }
      },
      "required": [
        "folder",
        "id"
      ]
    },
    "draft": {
      "type": "boolean",
      "description": "Save to Drafts instead of sending (IMAP only)."
    }
  },
  "required": [
    "account",
    "to",
    "text"
  ]
}
```

来源：[`packages/mail/tool-mail/src/tools.ts`](../packages/mail/tool-mail/src/tools.ts)

### `mail_update`

在一个文件夹中变更邮件：标记为已读或未读、加旗标或去旗标、移动到文件夹、归档、移入回收站，或永久删除。POP3 账户只支持删除。永久删除会先询问用户。

```json
{
  "type": "object",
  "properties": {
    "account": {
      "type": "string",
      "description": "Account address."
    },
    "folder": {
      "type": "string",
      "description": "Folder the messages are in."
    },
    "ids": {
      "type": "array",
      "description": "Message ids from mail_search.",
      "items": {
        "type": "string"
      }
    },
    "action": {
      "type": "string",
      "description": "The change to apply.",
      "enum": [
        "read",
        "unread",
        "flag",
        "unflag",
        "move",
        "archive",
        "trash",
        "delete"
      ]
    },
    "destination": {
      "type": "string",
      "description": "Target folder path; required for move."
    }
  },
  "required": [
    "account",
    "folder",
    "ids",
    "action"
  ]
}
```

来源：[`packages/mail/tool-mail/src/tools.ts`](../packages/mail/tool-mail/src/tools.ts)

只有当某个 agent 的会话所有者至少有一个可用邮箱账户时，这些工具才会为该 agent 注册，因此未登录的会话或没有邮箱的所有者看不到任何邮件工具；发送与永久删除通过 ctx.approval 询问，其他策略给出的拒绝仍然优先。

<a id="aeventool-memory"></a>

## `@aeven/tool-memory`

### `memory_environments`

列出关于工作环境的学习所得：仓库结构、应用行为、约束以及反复出现的模式。

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "Optional keyword filter."
    },
    "limit": {
      "type": "integer",
      "description": "Maximum environments (1-30)."
    }
  }
}
```

来源：[`packages/memory/tool-memory/src/index.ts`](../packages/memory/tool-memory/src/index.ts)

### `memory_get`

读取一条由记忆搜索找到的记忆项：一次过去的任务轨迹、一条学到的策略，或一个环境模型。

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Memory item id."
    },
    "kind": {
      "type": "string",
      "description": "Item kind; defaults to trace.",
      "enum": [
        "trace",
        "policy",
        "world-model"
      ]
    }
  },
  "required": [
    "id"
  ]
}
```

来源：[`packages/memory/tool-memory/src/index.ts`](../packages/memory/tool-memory/src/index.ts)

### `memory_remember`

存储一条用户明确要求你记住的事实，例如偏好、姓名，或他们希望某项工作如何完成。仅在用户要求你记住某事时使用；普通对话会被自动记住。保留归属、日期与不确定性：区分来源宣称的说法、一次观察、一个计划与一次评估。不要把自己的解读存储为已验证的事实。

```json
{
  "type": "object",
  "properties": {
    "fact": {
      "type": "string",
      "description": "The fact to remember, stated concisely in the user's words."
    },
    "about": {
      "type": "string",
      "description": "user: a fact about the user that holds everywhere (the default). project: a fact that matters only in this project. knowledge: information about a product or subject beyond the current project, not the user's own life.",
      "enum": [
        "user",
        "project",
        "knowledge"
      ]
    }
  },
  "required": [
    "fact"
  ]
}
```

来源：[`packages/memory/tool-memory/src/index.ts`](../packages/memory/tool-memory/src/index.ts)

### `memory_remember_bulk`

当用户要求导入或记住大量事实时，导入已经提炼好的事实。请用它代替反复调用 memory_remember。每条事实都按原文单独存储为一条记忆，嵌入（embedding）批量处理，且不会对单条事实做摘要。事实保存在文件中时，请传入 `file`，由工具自行读取：每条事实都按写入的内容原样导入，不会遗漏或改写。否则请传入 `facts`，每次调用最多 500 条。记忆中已存在相同文本的事实会被跳过，因此再次导入同一文件是安全的。保留归属、日期与不确定性：区分来源宣称的说法、一次观察、一个计划与一次评估。不要把自己的解读存储为已验证的事实。

```json
{
  "type": "object",
  "properties": {
    "facts": {
      "type": "array",
      "description": "Already-distilled, self-contained facts; name whom each fact is about. Give this or `file`.",
      "items": {
        "type": "string"
      }
    },
    "file": {
      "type": "string",
      "description": "Absolute path of a fact file: `.jsonl` with one {\"fact\": \"...\", \"about\": \"user\" | \"project\" | \"knowledge\", \"date\": \"YYYY-MM-DD\"} object per line (`about` and `date` optional), or `.txt` with one fact per line. Give this or `facts`."
    },
    "about": {
      "type": "string",
      "description": "user: facts about the user or people they know (the default). project: facts specific to the current project. knowledge: facts about the world, a product, or a subject that are not about the user's own life.",
      "enum": [
        "user",
        "project",
        "knowledge"
      ]
    }
  }
}
```

来源：[`packages/memory/tool-memory/src/index.ts`](../packages/memory/tool-memory/src/index.ts)

### `memory_search`

搜索关于既往工作的长期记忆：过去的任务轨迹、学到的策略、环境知识与可复用的 skill（技能）。每个直接来自人类的轮次都已经获得一次自动回忆；当这次回忆不够充分时，用它换一种说法或扩大范围，并在声称先前的上下文不可用之前先调用它。对于多个互不相关的主题，请传入 `queries`，每个主题一个查询，而不是一个很长的查询。

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "A concise free-text memory query. Give this, or `queries` for several topics."
    },
    "queries": {
      "type": "array",
      "description": "Up to four queries, each naming one topic. Retrieval embeds a query whole, so one string holding several unrelated names - a person, a product and a year - matches none of them, while one query per name returns each.",
      "items": {
        "type": "string"
      }
    },
    "maxResults": {
      "type": "integer",
      "description": "Maximum results per kind (1-50)."
    },
    "skills": {
      "type": "integer",
      "description": "Skill result limit (0-100)."
    },
    "traces": {
      "type": "integer",
      "description": "Trace and policy result limit (0-100)."
    },
    "worldModels": {
      "type": "integer",
      "description": "Environment-model result limit (0-100)."
    },
    "sessionOnly": {
      "type": "boolean",
      "description": "Restrict results to memory captured from this session."
    }
  }
}
```

来源：[`packages/memory/tool-memory/src/index.ts`](../packages/memory/tool-memory/src/index.ts)

### `memory_skill`

加载一项学到的 skill 以应用于当前任务；加载会记录该 skill 已被使用。

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Skill id from a skill listing or memory search."
    }
  },
  "required": [
    "id"
  ]
}
```

来源：[`packages/memory/tool-memory/src/index.ts`](../packages/memory/tool-memory/src/index.ts)

### `memory_skills`

列出从既往成功工作中学习到的可复用 skill。

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "description": "Optional lifecycle filter.",
      "enum": [
        "candidate",
        "active",
        "archived"
      ]
    },
    "limit": {
      "type": "integer",
      "description": "Maximum skills (1-50)."
    }
  }
}
```

来源：[`packages/memory/tool-memory/src/index.ts`](../packages/memory/tool-memory/src/index.ts)

### `memory_timeline`

列出某次既往经历的按序轨迹，以重建早先任务的经过。

```json
{
  "type": "object",
  "properties": {
    "episodeId": {
      "type": "string",
      "description": "Episode id from a memory item."
    },
    "limit": {
      "type": "integer",
      "description": "Maximum traces (1-100)."
    }
  },
  "required": [
    "episodeId"
  ]
}
```

来源：[`packages/memory/tool-memory/src/index.ts`](../packages/memory/tool-memory/src/index.ts)

只在记忆提供方处于活动状态时才会注册；`memory_remember` 存储一条事实，`memory_remember_bulk` 以原子方式存储一批已提炼的事实。
