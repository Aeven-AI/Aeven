# Agent Note：新鲜度检查并入轻量文档聚合

Status: implemented

[English](2026-09-22-freshness-gates-join-the-cheap-document-aggregate.md) | 中文

## Problem

改动源码的变更带着过期的生成文档一起合入，而每一次都在之后表现为一个看似新的缺陷。`docs/event-producer-consumer.md` 在 webserver origin 变更后重新生成过一次，随后又被 app-boot 新增 `hmr/config-update-failed` 的对账逻辑改成过期；`docs/config-catalog.md` 带着四行过期的源码位置；断言修复所附的 Agent Note 里有一个无法编译的 `ts` 代码块。

这些检查项只出现在 `doc-sync` 与完整的 `check:all` 聚合中。而在推送前运行的、无构建的文档聚合 `pnpm run test:docs` 对同一份内容报告 15 passed、0 failed，尽管 `verify-doc-graphs` 与 `doc-typecheck` 已经是红的，因此过期在合入时不可见，能发现它的聚合要晚一两个合并才运行。

## Decision

`pnpm run test:docs` 现在会因生成文档过期而失败。`scripts/run-gates.ts` 中的 `verify-doc-graphs` 与 `verify-config-catalog` 带有 `quick: true`，`docQuickLeafGates` 再把 `verify-module-graph` 加在它们旁边。三者都是读取 `packages/*/*/src` 与包清单的 `tsx scripts/gen-*.ts --check`，都不构建——这正是门禁上 `quick` 标志的含义。

`doc-typecheck` 不并入该聚合。它的脚本是 `npm run build:lib:host && npm run doc-typecheck:contracts-ready`，并非无构建，因此它的失败改由 `.agents/skills/avn-pre-push-checks/SKILL.md` 的落地规则覆盖：新增或修改 Agent Note、或任何含 `ts` 代码块的 Markdown，推送前运行 `pnpm run doc-typecheck`；刻意不检查的代码块写 `ts ignore-check`。

同一个技能文件还记录：用聚焦门禁代替完整套件，永远不能豁免生成文档的新鲜度。而两次并发失败换来的诊断规则记录在 `.agents/skills/avn-ci-test-reliability/SKILL.md`：在归因于负载之前先确认机制是否异步就绪、直接探测依赖而不是重复聚合、把根因带过同文件的兄弟用例、绝不把未经检验的假设写成观察结论、优先排除临时路径而不是串行化读取方。

## Alternatives considered

**把 `doc-typecheck` 并入该聚合。** 否决：它会构建 Host 库，而该聚合中其余每个检查项按定义都是无构建的；并入会让未构建的检出直接失败。

**把新鲜度检查放进 pre-push 钩子。** 否决：钩子是快速的本地检查点，完整矩阵由 CI 负责，而文档聚合是本仓库已经要求会话运行的命令。

**只依靠提示词规则。** 否决作为全部答案：规则是建议性的，而且本来已隐含存在；聚合是无法被忘记的强制手段。记录规则是因为它们覆盖聚合覆盖不到的部分，而不是取代聚合。

## Consequences

`pnpm run test:docs` 多出三项新鲜度检查，比原有的行文门禁多约一分钟；任何移动源码的改动都必须在推送前重新生成受影响的参考文档。

Agent Note 代码块这一类仍然由规则覆盖而非门禁覆盖，因为它的检查需要已构建的库；若再次出现，可用仅针对 notes 的类型检查变体补上这个缺口。

本次改动以故障注入验证：从 `docs/event-producer-consumer.md` 删除 `hmr/config-update-failed` 这一行后，`pnpm run test:docs` 以 `gen-doc-graphs: stale graph doc(s): docs/event-producer-consumer.md` 失败；恢复该行后通过。
