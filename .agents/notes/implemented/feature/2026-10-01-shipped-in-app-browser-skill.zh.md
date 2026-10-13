# Agent Note: 随包交付的应用内浏览器 skill

Status: implemented

[English](2026-10-01-shipped-in-app-browser-skill.md) | 中文

## Problem

会话的 skill 目录此前只来自磁盘：项目根下的 `.aeven/skills` 与 `.agents/skills`、`~/.aeven/skills`、`~/.agents/skills`，以及一个没有任何随包组装配置过的 `bundled` 根。因此全新安装的目录是空的——维护者看到的 `avn-*` skill 之所以存在，只是因为工作目录是本 checkout。会话旁浏览器的操作流程也处于同一处境：`@aeven/tool-browser` 中面向模型的策略覆盖了 `preview_*` 工具与升级顺序，却没有提到面板自身的工具栏、如何截取像素，以及面板关闭、拒绝读取或被同意墙遮挡时如何恢复。这些知识只存在于某位用户的已学习能力中，而全新安装并不具备它。

## Decision

由 `@aeven/agent-presets` 交付这些 skill：每个会做本地 skill 发现的随包 preset，都把交付目录作为 `customSkillDirs` 根挂载，并从自身组装 URL 解析它：

```yaml
- id: skill-filesystem
  name: '@aeven/skill-filesystem'
  config:
    customSkillDirs:
      - !!js "process.getBuiltinModule('node:url').fileURLToPath(new URL('./skills/', baseUrl))"
```

- skill 只有一份，位于 `presets/aeven/skills/`。`aeven` preset 解析 `./skills/`；`standard`、`ptc` 与 `cordis` 解析 `../aeven/skills/`；`minimal` 不挂载文件系统发现，因此拿不到它们。
- `baseUrl` 是组装自身的 URL，所以该根在 checkout 与已安装的包中同样能解析。`presets` 已在包的 `files` 中，因此 skill 随包同行：不需要复制步骤、不需要 `extraResources`，也不需要由启动器解析并导出某个目录。
- 该根以 rank 300（`custom`）注册，高于用户根，因此同名时随包交付的 skill 胜过本地副本。
- 仓库路径 `.agents/skills/<name>/SKILL.md` 是指向随包文件的相对符号链接，因此维护者会话发现的是同一个文件，而不是第二份副本。
- 首个随包交付的 skill 是 `in-app-browser`：先选界面（优先 `preview_*`），读取与驱动页面，截取面板，按下它的工具栏，并在它无法服务时恢复。它的 `scripts/pane.mjs` 与 `references/cdp-surface.md` 按加载器在 `<skill_resources>` 中给出的基础目录解析。
- `tests/skills.spec.ts` 固定这些形状：每个渲染后的正文都低于标准 preset 的 `thresholdChars: 8192`；正文提到的每个资源都存在，并在加上行号后仍低于同一阈值；目录描述不超过 `@aeven/tool-skill` 的 500 字符上限；仓库别名解析到随包文件；交付目录经由 `@aeven/skill` 与 `@aeven/skill-filesystem` 进入目录清单；每个挂载 `skill-filesystem` 的组装都把它的 `customSkillDirs` 条目解析到交付目录。

## Alternatives considered

- **只用 `.agents/skills`。** 对项目根不是本 checkout 的任何安装都不可见，而这正是本次需求所针对的情形。
- **在 bundled rank 上的专用提供方包**——即 `@aeven/skill-badge` 的形态，以及上游那种为每个资产目录注册一个不可变候选的包。当 skill 需要把运行时路径注入正文时，这是正确形态，因为提供方可以追加它们。`in-app-browser` 不需要：`preview_status` 在运行时报告可驱动的界面，因此提供方及其组装行不会携带 skill 尚未掌握的信息。
- **`bundledSkillDir` 或 `$AVN_BUNDLED_SKILL_DIR`。** rank 600 的根可行，但必须有东西为每种安装形态——checkout、npm 安装、Electron seed——解析该目录，并在组装加载前导出它。相对组装的 URL 不需要这一步。
- **只写提示词。** 拥有同一面板的 t3code 并不为它交付 skill，而是把浏览器策略放在每轮的 developer instructions 中，并在工具缺席时省略。这里 `@aeven/tool-browser` 已承载该策略；skill 补充策略不包含的流程，而不加长每一轮的提示词。

## Consequences

- 在 `aeven`、`standard`、`ptc` 或 `cordis` 上的全新安装现在会列出 `in-app-browser`，在这些 preset 上它的描述会占用每个会话目录消息的相应码点。
- skill 的脚本路径经由应用的 DevTools 端口访问面板，这属于开发与桌面界面。skill 先指明 `preview_*` 路径，说明脚本路径为何是最后手段，且不禁止任何一种。
- 编辑随包交付 skill 的部署会改变该 preset 上的每个会话。必须有所不同的部署会把 preset 复制到用户根，而该副本按设计不携带任何随包交付的 skill。
- `@aeven/skill` 与 `@aeven/skill-filesystem` 为目录清单测试加入包的 devDependencies；两者都不是该包的运行时依赖。

## Related

- [分层 skill 注册表](../architecture/2026-08-09-layered-skill-registry.zh.md) 拥有该行所注册进的注册表形态：preset 的 `skill-filesystem` 贡献到该 preset 的层，这正是挂载位于 preset 文件而非宿主组装的原因。
- [preset 之后的宿主面归属](../architecture/2026-08-10-host-plane-ownership-after-presets.zh.md) 记录了为什么宿主 `skill-filesystem` 行在 Web 组装中被禁用、而由 preset 拥有本地发现。
- [按会话的 agent preset](../architecture/2026-08-03-per-session-agent-presets.zh.md) 拥有 preset 名册、仅复制的创作规则，以及副本不携带随包 skill 的原因。
