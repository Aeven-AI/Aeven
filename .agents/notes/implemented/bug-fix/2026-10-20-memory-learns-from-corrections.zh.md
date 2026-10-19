# Agent Note: 记忆从纠正中学习，开发构建能到达桌面页面

Status: implemented

[English](2026-10-20-memory-learns-from-corrections.md) | 中文

## 问题

2026-10-19 在本仓库中，四个只包含小型 CSS 请求的会话各自运行了数百次工具调用，用户反复说"no tests"、"just make the change"和"copy the CSS"，但下一轮和下一个会话都没有照做。长期记忆记录了这些轮次，却没有从中学习。

- **学习阶段从未运行。** MemOS home 下没有 `config.yaml`，于是采用 vendor 默认值 `algorithm.lightweightMemory.enabled: true`，而轻量模式从不挂载奖励、策略归纳、世界模型、skill 与反馈运行器。该账户数据库有 434 个 episode，每个 `r_task` 都为空，`policies`、`feedback`、`decision_repairs`、`world_model` 与 `skills` 均为零行。
- **纠正隐藏了用户自己的指令。** 只要下一条用户消息"纠正或反驳"了回复，轮次评判就把 `corrects` 设为真，而被取代的轨迹不进入自动召回。针对工作方式的愤怒追问取代了承载指令本身的轮次，其中包括"User wants CSS changes implemented directly, not devtools inspection"和"CSS only, no tests"。
- **已学流程保留了慢路径。** 学习器把一个轮次中所有直接用户消息拼成一个 `<request>`，因此看不出"no tests"是在一次测试运行之后才到达的。当天学到的 27 个流程中，8 个要求运行 vitest，13 个要求 DevTools 测量或截图。
- **重新构建的客户端 bundle 从未到达页面。** 桌面组装禁用了 `client-hmr`，因此 `@aeven/client-modules` 一直提供它在启动时读到的 bundle 字节。一个开发版桌面 Host 提供的 `client-ui-theme` bundle 为 101,889 字节，而磁盘上重新构建的 `lib/client.js` 为 102,078 字节，用户看不到 `pnpm run build:client` 产生的任何主题变量改动。

## 决策

`@aeven/memory-memos` 新增 `learning`（默认 `true`），它把 `algorithm.lightweightMemory.enabled` 设为其取反值，覆盖 `config.yaml` 中的设置。奖励、归纳与反馈经由 Host 桥访问模型，因为捕获、反馈与会话关闭本就运行在 `withRoute` 之内；在使用该桥时，启动与周期性恢复保持关闭。

轮次评判只有在用户指出上一条回复所陈述的某个事实是错的时，才回答 `corrects: true`。对做法、速度或未完成改动的抱怨，以及重复的或新的指令，都让上一条轨迹保持可召回。

`ExecutionTracker` 把轮次第一次工具调用之前提交的直接用户文本保留为 `request`，把之后的消息记录为带时间戳的 `instructions`。学习器把每条消息渲染为位于其之前调用之后的一行 `USER (during the work):`，其规则使每一行都从第一步起成为流程的要求：违背它的调用归入 "Avoid"，而测试、浏览器检查、截图与测量只有在用户要求时才进入快速路径。慢速模式还识别 "takes ages" 与 "how hard can it be"。

开发版桌面 Host（以 `--allow-linked-profile` 启动的那个）追加一个启用 `client-hmr` 的补丁层，其 500 ms 的 bundle 轮询调用 `clientModules.rebuilt()` 并重新组合所公布的批次。打包版 Host 保持禁用。Electron 渲染器的 `/plugins/events` 请求落到 `fetchBundle` 并返回 404，因此只有回环端口上的浏览器会收到重载帧。

移除了编码纠正、澄清与视觉验证规则的四段 persona：persona 承载语气，而这些规则使模型在提问与行动之间犹豫，并在每次编辑后都去测量。

## 考虑过的替代方案

**在 MemOS home 中放一个 `config.yaml`。** 它只修复一个安装，每个新安装仍是轻量模式；provider 行才是 Aeven 声明其产品默认值的地方。

**在召回中保留被取代的轨迹并加标记。** 召回会把用户的指令与对它的抱怨并列显示，模型仍需调和二者；收窄"纠正"的含义能让该指令保持为一条当前记忆。

**每次客户端构建后重启桌面 Host。** 这会丢失正在运行的会话，而为此目的的监视器已经存在。

## 后果

- 每个关闭的 episode 都会在所属会话的路由上为奖励评分与归纳消耗辅助调用。
- 助手说错的事实仍会被取代；只招致抱怨的轮次保持可召回，包括其中任何错误陈述。
- 本次改动之前已被取代的轨迹保留其标签。
