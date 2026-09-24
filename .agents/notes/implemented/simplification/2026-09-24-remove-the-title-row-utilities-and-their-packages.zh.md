# Agent Note: 移除标题行的 utilities 席位及其背后的两个包

Status: implemented

[English](2026-09-24-remove-the-title-row-utilities-and-their-packages.md) | 中文

## 问题

Session header 的标题行承载四个控件：Schedule 目录、agent preset chip、background jobs 列表与会话日志导出。其中只有中间两个陈述活跃 Session 事实——该 Agent 运行哪个 preset，以及它有哪几个 job 在飞。

另外两个各是某个包最后的可见面。`@aeven/client-ui-schedule` 只画一个只读 header 操作，把 `schedule` Session projection 呈现为该 Session 活动提醒的目录。`@aeven/session-log-export` 拥有 Web `/export` 用户命令、`GET`/`HEAD /api/session.export` ZIP 路由、下载对话框，以及作为该下载唯一可见入口的 `Session log` 按钮。Web bundle 各解析一个包，只为画出一个 header 单元格。

## 决策

标题行渲染面包屑——含 lineage 席位——View tab，以及 `conversation.session.header.actions` 列表，后者承载 agent preset chip（`@aeven/client-ui-agent-preset`）与 background jobs 列表（`@aeven/client-ui-jobs`）。

`conversation.session.header.utilities` 席位已从 `packages/client/ui-conversation/src/client/contract/slots.ts` 的 slot 约定、`packages/client/ui-conversation/src/client/apply.ts` 中该条目的 runtime `children` 声明，以及 `ConversationSession.tsx` 的标题行中删除，连同给它单元格的 `.titleCluster` 与 `.headerUtilities` 规则一并移除。`.titleRow` 保留原来那一行 56px flex 行，间距单一 10px。

`packages/client/ui-schedule` 与 `packages/session-query/session-log-export` 已删除，连同各自的源码、包测试、README 与 tsconfig 工程。`packages/bundle/web-app/cordis.patch.yml` 去掉 `ui-schedule` row 与 `session-log-download` row，`packages/bundle/web-app/package.json` 去掉两项依赖。

Schedule 的 Host 能力未受影响。`@aeven/schedule` 保留 `schedule_create`、`schedule_list` 与 `schedule_delete`、其 Agent scope runtime 与会话本地交付；当 `ctx.sessionProjections` 存在时，它仍注册可选的 `schedule` Session projection 单元，`@aeven/client-ui-workspace` 也仍通过纯类型 `@aeven/schedule/client` 词汇从该 key 派生其列表行闹钟标记（[持久 Schedule 决策](../feature/2026-08-05-durable-web-schedule.zh.md)、[对话式交付](2026-08-09-conversational-schedule-delivery.zh.md)）。

本 Note 吸收被删除的 Web 会话日志导出记录。它的动机仍然成立：bug 报告需要整棵 Session 树的完整原始日志，形态要能在被转发后仍然可用，而 Trajectory 视图提供的是折叠投影而非原始事件。不再使其成立的是所有权——按钮是该下载唯一的可见入口，`/export` 到达同一操作，仓库中再没有任何东西读取该路由、对话框状态或归档所依据的持久化工件。[命名清单](../architecture/2026-08-11-repository-naming-contract-and-rename-ledger.zh.md)中这些名字的条目也随之移除。

## 验证

`pnpm exec tsx scripts/gen-module-graph.ts --check`、`pnpm exec tsx scripts/gen-config-catalog.ts --check` 与 `pnpm exec tsx scripts/gen-client-catalog.ts --check` 报告重新生成的 module graph、配置目录与客户端 slot 目录均为最新。`pnpm exec tsx scripts/run-tsc.ts tsconfig.client.json` 编译客户端程序且无任何诊断。

`grep -rn 'ui-schedule\|session-log-export' packages/*/*/src packages/*/*/tests packages/bundle apps/web/src apps/web/package.json apps/cli/package.json apps/cli/config` 无匹配；在 `packages` 与 `apps` 上对 `SESSION_LOG_EXPORT_PATH`、`conversation.session.header.utilities` 与 `headerUtilities` 的同样搜索也无匹配。运行 `pnpm run build:client` 后，在 `packages/*/*/lib` 中搜索两个包名、该席位与 `session.export` 均无结果，而 `conversation.session.header.actions` 与 `conversation.navigation.utilities` 仍存在于构建出的客户端 bundle 中。

`packages/client/ui-conversation/tests/skeleton.client.spec.tsx` 在两个 phase 中钉住 header 的 dispatch 集合：活跃用例要求 lineage 与 action 席位，cold start 用例要求常驻 navigation 席位，同时完全不 dispatch 任何 `conversation.session.*` 条目。

## 考虑过的替代方案

**保留两个插件的挂载，只摘掉它们的控件。** 一个贡献全部未注册却仍被解析的包会作为代码留在图里，构建、类型检查和打包仍要为它付费，而且它发布了一个没有任何组合使用的包。导入记录中删除导出功能更早的 `session.log` RPC 就是同一理由的先例。

**把该席位留着，供将来的 utility 使用。** 没有声明者的空 list 席位不命名任何东西，还占着一个没有条目渲染的单元格。新的 Session utility 会在自己的变更里声明它需要的席位，而比 Session 长寿的应用级控件已经有 `conversation.navigation.utilities`——它在账户头像需要时才被声明。

**把导出留在非 header 的入口后面。** 可见操作此前已被拒绝放进 Trajectory 视图，因为导出必须在不开诊断视图的情况下可被发现（[已归档的 Web `/export` 决策](../../archived/feature/2026-08-11-web-export-command-and-dialog.md)）。席位既已删除，`/export` 就成了通向一个没有任何面呈现的下载的第二个入口。

## 后果

Web 应用不再有 `/export` 命令，也没有会话日志下载：ZIP 路由、它的 `HEAD` 预检、下载对话框与按 Session 的 controller 都已删除，仓库中没有任何东西消费会话归档路由。

随导出一起放弃的是逐字节忠实的归档本身——每个 Session 与每个后代一个文件，每个文件都与持久化工件逐字节一致并在读取前先被 flush，从 Host 流式输出并使用经过校验的 DEFLATE 级别，因此浏览器从不缓冲它，同时 `supportsRawArtifacts` 会把没有原始工件的后端与不存在的 Session 分开报告。持久化服务保留 `readRaw` 与 `supportsRawArtifacts`；被删除的路由是它们唯一的消费者。重新引入面向用户的导出需要具名消费者、新的入口，以及针对路由、读取边界保真度与错误词汇的装配式下载验收，而不是复活一个 row。

浏览器不再有 Schedule 目录。活动提醒仍可通过 `schedule_list` 工具取得，也可在侧边栏的列表行闹钟标记中识别——后者读取同一个 projection key；为它们提供浏览器呈现需要具名面与它自己的验收。

Session header 的贡献只剩一个 Session 范围内的席位 `conversation.session.header.actions`。标题行不再为该单元格保留 20px 分隔与 8px 条目间距。
