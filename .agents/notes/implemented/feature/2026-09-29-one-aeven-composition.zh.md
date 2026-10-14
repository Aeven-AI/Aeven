# Agent Note: 一个 Æven 组合

Status: implemented

[English](2026-09-29-one-aeven-composition.md) | 中文

## 问题

Web GUI 要求人们为每个新会话挑选一个 agent（智能体）preset（Standard、PTC、Minimal、Creator）。这四项并不是可比较的选择：它们把 persona（人设）、工具集、工具调用策略（PTC 只是一行 `agent-tool-presentation`）、benchmark 配置（Minimal）与自我修改（Creator 是 Standard 加 `tool-cordis` 与两项创作 skill（技能））混在一起。一个人应当说出自己想要什么，由 Æven 决定如何组合自己；而唯一能扩展 Æven 的 preset，也正是它自己的开发者每天都在用的那个。

## 决策

- **一个默认组合。** 随附的 `aeven` preset 就是 Creator 的完整组装，外加 Æven persona：日常 agent 加上 Cordis 工具集，因此 Æven 会去构建缺失的能力，而不是要求切换模式。Web bundle 的 `agent-presets.default` 是 `aeven`。组合创作类 skill 从 `cordis/skills` 移到 `aeven/skills`，`cordis` 从它的同级目录读取它们。
- **preset 是开发者界面。** `ui-settings-general` 拥有开发者模式（`ui-developer.enabled`，默认关闭）及其 General 行。`ui-agent-preset` 只在开发者模式开启时，把它的 chip、页眉标签与 Settings 分区作为单个子插件挂载，因此关闭它会 dispose（资源释放）全部三者。普通会话没有选择器。
- **旧 preset 继续随附。** 会话会记录自己的 preset id，而恢复一个 preset 已不存在的会话会失败。因此 `standard`、`ptc`、`minimal` 与 `cordis` 仍然随附，且只在开发者模式中提供。

## 考虑过的替代方案

**为每个人保留 preset 选择器。** 已否决，因为这四个 preset 把 persona（人设）、工具集、工具调用策略、benchmark 配置与自我修改混在一起，并不是可比较的选择：一个人说出自己想要什么，由 Æven 决定如何组合自己。

**连同选择器一起删除旧 preset。** 已否决，因为会话会记录自己的 preset id，而恢复一个 preset 已不存在的会话会失败，因此 `standard`、`ptc`、`minimal` 与 `cordis` 仍然随附，且只在开发者模式中提供。

**把自我扩展保留为单独的 preset 选择。** 已否决，因为唯一能扩展 Æven 的 preset 也正是它自己的开发者每天都在用的那个，因此随附的 `aeven` preset 就是 Creator 的完整组装外加 Æven persona。

## 后果

- Web GUI 中每个新会话都运行 `aeven`；用户级的 `agent-presets.default` 仍然优先于它。
- `cordis_run` 对未经授权的浏览器包保留自己的审批，因此能够扩展自己并不会给 Æven 带来新权限。

## 下一步

1. 把工具调用策略做成 `aeven` 中 `agent-tool-presentation` 上经过校验的配置字段（`native` | `ptc`），在会话创建时固定并记入会话日志；`auto` 只有在有评测证据时才采用。
2. 把自我扩展做成一项能力：`tool-cordis` 随附创作类 skill 与自我扩展指引，而一个可用的动态插件需要一个持久归宿，因为 `cordis_define` 的定义只活在内存里。
3. 为 persona 与自定义指令增加一个 Customize 分区，按会话记录，取代按 preset 的 persona。
4. 在代码中把 preset 改名为组合，保留已持久化的 `agentPreset` 字段，并在失去那些会话已可接受之后退役旧 preset。
