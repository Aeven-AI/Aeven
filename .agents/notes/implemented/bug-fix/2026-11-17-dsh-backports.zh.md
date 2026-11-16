# Agent Note：从 dsh-v0.2.1-rc.3 到 dsh-v0.2.2-rc.3 的 DSH 缺陷修复，按 Aeven 适配

Status: implemented

[English](2026-11-17-dsh-backports.md) | 中文

## Problem

Aeven 很早就从 DeepSeek Harness（DSH）分叉。DSH 的 dsh-v0.2.1-rc.3 至 dsh-v0.2.2-rc.3 版本修复了 Aeven 中同名包仍然存在的缺陷：压缩改写了签名思考所绑定的前缀后，Anthropic 请求被拒绝；一个技能根目录不可读时整个技能目录消失；`~/` 路径相对会话目录解析；工具调用因空的或未使用的可选参数被拒绝；`web_fetch` 遇到 `charset=utf-8,gbk` 失败；重试与附件准备竞争时重复的提示被接纳；较大的项目指令链把用户全局 `AGENTS.md` 挤出预算；切换到较小窗口模型时历史放不下；`!` 序列破坏持久 bash shell。Aeven 此后已与 DSH 分化，尤其在账户同步与多设备输入方面，因此原样搬来的修复可能破坏只有 Aeven 才有的行为。

## Decision

每项修复都针对 Aeven 当前代码移植，并检查它对在设备与版本之间移动的会话有何影响：

- **思考绑定请求前缀**（`avn-llm-pi-ai`，DSH `prefix-binding`）：每个 Anthropic Messages 响应在回放状态中记录其请求前缀的摘要；之后的请求若发现某条助手消息的前缀摘要不再匹配，就丢弃其回放的已签名与 redacted 思考；文本、工具调用和未签名思考保留，因此经 Anthropic 兼容端点的 DeepSeek 路由仍保留其推理。手动思考下，进行中的工具轮次保留思考。没有该字段的版本会忽略它（回放状态校验不检查未知键），此前记录的回放状态视为过期，因此只丢弃思考，请求绝不失败。系统提示词或工具与记录该轮次的设备不同的桌面端，现在发送的是有效请求，而不是会被拒绝的签名。
- **不可读的技能根目录**（`avn-skill-filesystem`、`avn-tool-skill`）：发现失败的根目录会被跳过并发出警告，查找标记为不完整；目录仍列出已确认的技能，并提示将重试发现，而不是扣下整个目录。
- **主目录路径**（`avn-fs-local`）：请求路径为 `~` 或以 `~/`（Windows 上还有 `~\`）开头时从主目录开始；`~user`、后续 `~` 段与目录项名称保持字面含义。DSH 还会穿过符号链接按物理路径解析 `..`；Aeven 保留词法 `..`，本修复不涉及。
- **宽松的工具参数**（`avn-tool-fs-search`、`avn-tool-goal`）：`grep` 中精确为空的 `include` 表示不过滤；`update_goal` 对不使用 `objective`、`max_goal_rounds` 与 `blocked_reason` 的 action 忽略这些字段。三条 schema 描述随之改变，因此刷新了录制的工具 schema 快照。
- **畸形多标签 charset**（`avn-web-fetch-http`）：以逗号或空白连接、且含 UTF-8 标签的声明按严格 UTF-8 解码，无效 UTF-8 仍然失败。web-fetch 快照夹具现在返回 `charset=gbk,utf-8`。
- **提示重试与接纳竞争**（`avn-session-controller`）：Aeven 自有的日志检查本已对同时经账户收件箱和输入设备自身队列送达的提示去重；现在它在模型与附件准备之后、以及接纳失败时再运行一次，因此同一请求的并发送达只接纳一条输入。未采用 DSH 的按会话回执缓存，因为 Aeven 的日志扫描已覆盖被领取和被删除的收件箱条目。
- **分别预算的指令链**（`avn-agent-instructions`）：用户全局链与项目链各自在 `maxBytes` 内渲染，因此同时包含两者的消息至多为 `maxBytes` 的两倍；超过两倍的合并框架回退到单一预算渲染。基线在共享预算下记录的会话恢复时，会以一次附加变更收到被省略的用户全局文件；基线不会被改写。随之，用户全局文件的变更段落现在写作 "These user-global instructions apply to all work."，而不再把内部的 `user-global` scope 键当作目录名呈现。
- **切换模型时的压缩**（`avn-compaction-basic`）：前置的 `agent/request` listener 在新请求头记录之前，按新选模型的窗口为历史定价；若超过该阈值，就由上一个模型进行摘要。与 DSH 不同，失败只记录日志，请求照常发出，因为请求常常仍在窗口之内，放不下时由溢出恢复处理；切换模型绝不会因压缩而失败。Aeven 中唯一改变请求模型的 listener 是会话自身的模型选择，因此该检查在用户从任一设备选择其他模型时运行。
- **持久 bash 的历史展开**（`avn-tool-bash-persistent`）：shell 初始化发送 `stty -echo; set +H`，因此 `!` 序列原样到达 bash。

## Alternatives considered

**从 Windows ACL 沙盒令牌中去掉 `LUA_TOKEN`**（DSH bdd75ca1a0）——DSH 之所以能去掉它，是因为其沙盒还把令牌降为 Low 完整性；Aeven 的沙盒没有这样做。两者缺一时，由提升权限的 Aeven 启动的沙盒命令会保留 High 完整性和管理员读权限，而收益——在内置 Administrator 或 WDAGUtilityAccount 下进行受限启动——不惠及任何普通账户。未采用。

**在智能体拆除期间拒绝迟到的唤醒**（DSH 681d947cad）——加上该保护后，智能体正在释放时到达的提示会记录在收件箱中却不会运行，而 Aeven 在会话恢复时从不运行排队的收件箱输入。经账户收件箱转发、或与运行设备交接竞争的提示可能因此无人应答。在恢复的会话会因待处理输入而唤醒之前不采用。

**切换模型时压缩失败则让请求失败**（DSH 行为）——会让 Aeven 如今能成功发送的请求失败。否决。

## Consequences

Anthropic 会话会丢失前缀已变化轮次的回放思考，这会损失部分缓存的推理上下文，但不会损失请求。两条链都很大时，指令提示可增长到 `maxBytes` 的两倍。切换到较小窗口的模型时，可能在该模型的首个请求之前增加一次摘要请求。Windows 沙盒仍无法在内置 Administrator 账户下约束命令。
