# Agent Note：简历和演示文稿技能的源文件放在仓库中

Status: implemented

[English](2026-11-16-skill-sources-in-repo.md) | 中文

## 问题

Aeven 随附的 `cv` 和 `slides` 技能在仓库之外的文件夹 `~/Projects/Nodejs/Aeven/templates` 中编辑，该文件夹没有任何提交，只以 `scripts/publish.mjs` 写入 `packages/preset/agent-presets/presets/aeven/skills/` 的打包副本进入仓库。源文件既没有历史也没有评审，而且每当有人忘记发布，随附的副本就会与之脱节。

## 决策

源文件放在仓库根目录的 `skills-src/cv` 和 `skills-src/slides`：`SKILL.md`、渲染与导出脚本、设计系统、示例照片，以及以 WOFF2 文件加清单形式保存的字体。它们位于 pnpm 工作区之外，各自有自己的 `package.json` 和锁文件（`pnpm install --ignore-workspace`），因此它们的工具（puppeteer-core、esbuild、docx、pptxgenjs）不会混入 harness 包及其检查。不带路径时，`node scripts/publish.mjs` 会发布到它所在的检出。TTF 文件、构建输出（`dist/`、`out/`）和 Figma 抓取不纳入 git；导出器在需要时从 Google Fonts 下载模板的 TTF 文件。

## 考虑过的替代方案

**单独的仓库。** 它让源文件不进入 harness 检出，但每次技能改动都要跨两个仓库、两次评审，随附的副本仍会脱节。

**放在 `packages/` 下的工作区包。** harness 的包规则（带 Cordis peer 依赖的 `@aeven/*` 命名、publint、导出、约束）适合插件，而不适合一个产出是已发布技能的设计工具文件夹。

## 影响

技能改动在 `skills-src/` 中编辑，用 `node scripts/publish.mjs` 发布，并与其发布副本在同一个 PR 中合入。在一台机器上首次导出某个模板时，会下载一次它的 TTF 文件。仓库外的旧 `templates/` 文件夹不再是源文件。

## 验证

从 `skills-src/` 发布两个技能，重现了仓库中的发布副本，说明构建所需的内容没有缺失。`pnpm run hygiene` 和 `verify-translation-pairing` 通过。
