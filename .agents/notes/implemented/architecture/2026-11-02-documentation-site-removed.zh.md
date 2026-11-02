# Agent Note: 移除文档站点适配层

Status: implemented

[English](2026-11-02-documentation-site-removed.md) | 中文

## 问题

`website/` 把 `docs/` 投影成一个 VitePress 站点。它已经从产品里漂了出去：外壳仍然挂着旧的 "deepseek 技术预览" 抬头、DeepSeek 字标和中文优先的默认值，而面向使用者的文档早已迁到独立的 Docusaurus 帮助中心（`helpcenter.aeven.io`）。同一棵文档树有两个发布面，而没人维护的那一个还占着投影适配层（`scripts/project-doc-site.ts`）、构建后的片段校验器（`scripts/verify-doc-site-fragments.ts`）、两个 gate 叶子（`docs-site-build`、`windows-site`），并且是 `docs:dev`、`docs:build`、`docs:check`、`website:dev`、`website:build` 存在的唯一理由。

## 决策

删除适配层，而不是修它。

- 删除 `website/` 及其四个脚本；`docs/` 仍是规范散文树，由帮助中心发布。
- `pnpm-workspace.yaml` 与根 `workspaces` 数组移除 `website`，`docs:*` / `website:*` 脚本随之下线。
- `scripts/run-gates.ts` 去掉 `docs-site-build` 叶子、两个 `windows-site` gate 以及不再使用的 `docsBuildScript` 选项；Windows 完整集保留观察性 gate，只保留普通的 `allowFailure`，不再做站点专属的 `after` 改写。
- `scripts/gen-third-party-notices.ts` 去掉 `'website/'` 这个 dev-only 区域，`scripts/oxlint-contract.spec.ts` 去掉其 `website` 探针用例。

## 备选方案

**修站点而不是删站点。** 把外壳改成 Æven 品牌并翻译落地页，能让两个发布面继续共用一棵 `docs/` 树，同时继续为一个没人打开的站点养着投影器、片段校验器和两个 gate 叶子。品牌漂移是症状，重复的发布面才是没人察觉的原因。

**保留 `website/` 但不构建。** 留一个停用的 workspace 看似低成本地保住了可选项，但它同时留住了一套 VitePress 依赖、一份过期的站点配置和仓库里第二条发布文档的路，下一位读者还得重新判断哪条是真的。

## 后果

`pnpm docs:check` 不再存在，投影测试与片段校验器也不再守护文档链接：直接读取 `docs/` 的 gate 剩 `verify-md-links` 与 `verify-doc-graphs`。要恢复发布文档站点，需要重新写一个投影器，而不是复活这一个。
