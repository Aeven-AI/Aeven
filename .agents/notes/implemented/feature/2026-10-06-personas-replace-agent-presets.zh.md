# Agent Note: 一个 Aeven 组合、一个自适应 persona 与按账户的个人化

Status: implemented

[English](2026-10-06-personas-replace-agent-presets.md) | 中文

## 问题

Web GUI 在开发者模式背后提供五个 agent（智能体）preset（`aeven`、`standard`、`ptc`、`minimal`、`cordis`），外加一个 hero chip、一个页眉标签和一个 Settings 分区。连 Aeven 的开发者都觉得这个选择难以解释，对不是开发者的人来说更是毫无意义。这些 preset 还把两件不同的事混在一起：一个会话能做什么（工具）与它怎么说话。

Aeven 怎么说话并没有在任何地方被设计过。每个 Web 会话都以“You are an AI agent powered by Aeven”开场，Web bundle 设置了一个“You are a coding agent”persona，而每个人都看到只写给开发者的文字：harness 的检出路径与 GUI 重建规则。提示词的其余部分都是工具策略。实践中，语气在任何场合都像会计，包括私人场合；而一旦涉及事实，它就切换成报告体（粗体标签、记忆 trace id、数据库名）。

## 决策

- **一个组合。** Web 组合让每个会话都运行在随附的 `aeven` 组合上，并关闭 harness-home 用户根目录。`standard`、`ptc`、`minimal` 与 `cordis` preset 以及 `@aeven/client-ui-agent-preset` 均已删除。要改变一个会话能做什么，就编辑 `presets/aeven/agent.cordis.yml`。PTC 模式（`tool-presentation`）与 Cordis 自我扩展工具集（`tool-cordis`）仍作为该文件中默认关闭的行随附。
- **身份。** persona 以“You are Aeven”开场。Web bundle 关闭 `includeHarnessIdentity` 并去掉它的部署 persona。模型名称只在回答“which model are you”时被陈述。
- **开发者定位是配置。** `@aeven/web-app` 新增 `developerContext`（默认 `false`），它门控 `harness:source` 段落以及 GUI 重建与替换服务器规则。Markdown 渲染规则对所有人保留。
- **自适应 persona，而非选择器。** persona 首先匹配人：他们的语气、活力与语言优先于主题。只有在这人确实在与它一起工作时，它才使用精确的工作语气。私人事务得到真正温暖、友好、使用普通段落的语气，指导则得到鼓励的语气。机制留在视野之外（除非被问及，不出现记忆 id、文件、数据库或工具名）。工作区指令文件管的是工作，而不是 Aeven 怎么说话。视觉工作循环从 persona 移入随附的 `visual-work` skill（技能）。
- **按账户个人化。** `@aeven/personalization` 按已登录账户存储一种语气（`automatic`、`warm`、`direct`、`playful`）与自由文本备注，并把它们渲染为 persona 之后紧跟的 `user:personalization` 系统提示词段落。它通过系统提示词对模型可见，因此每个 `request/header` 都记录它。Settings → Personalization（`@aeven/client-ui-settings-personalization`）用于编辑它。
- **名字只有一个归宿。** “How should Aeven call you?” 指的就是 Aeven 账户显示名，由注册命名步骤（`ui-auth-aeven` 的 `NameCheck`）通过 `/set-display-name` 设置。已发布的 reader 新增 `setDisplayName`，它存储该名字并重新陈述 reader，因此 Settings 字段、账户菜单、问候语与下一条消息的 `<user_profile>` 块都跟随同一个值。
- **记忆召回保持自然。** 记忆指引告诉模型自然地使用召回的事实，并且除非被问及，绝不引用它们的 id 或存储位置。

## 考虑过的替代方案

- **每个对话一个 persona 选择器**（像 `agent-presets` 那样带一个 composer 座位与 hero chip）。不是开发者的人不会去挑 persona；persona 读懂当下，而 Settings 存放一个人拥有的少数长期偏好。
- **用户可编辑的 persona 提示词文本，带 `{{model}}` 与 `{{cwd}}` 模板。** 这是在要求人们写提示词。带示例回复的平实语气选项与自由文本备注已覆盖这一需求。
- **把名字存进个人化文档。** 那会复制账户名并与它发生偏离。

## 后果

Web 组合让每个会话都运行随附的 `aeven` 组合并关闭 harness-home 用户根目录，因此要改变一个会话能做什么，就编辑 `presets/aeven/agent.cordis.yml`；`standard`、`ptc`、`minimal` 与 `cordis` preset 以及 `@aeven/client-ui-agent-preset` 均已删除，而 PTC 模式与 Cordis 自我扩展工具集仍作为该文件中默认关闭的行随附。提示词不再携带部署 persona（人设）或 harness 身份：persona 以“You are Aeven”开场，模型名称只在有人问它是哪个模型时才被陈述。persona 自己承载语气规则——私人事务温暖平实、指导鼓励、工作时精确——视觉工作循环移入随附的 `visual-work` skill（技能）。语气与备注通过系统提示词对模型可见，因此每个 `request/header` 都记录它们；显示名在 Aeven 账户中只有一个归宿：Settings 字段、账户菜单、问候语与 `<user_profile>` 块都跟随同一个值。

## 延期

- 名册服务、`agentPreset` 会话头字段与两个 SDK 的投影仍为单一组合保留着。把它们合并成一条组合路径牵涉会话格式、两个 SDK、webhook、ACP 与 subagent，属于它自己的一次改动。
- 对话中提出的风格要求落到长期记忆里，而不是个人化文档中。
