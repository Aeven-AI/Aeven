# Agent Note: 建议性过程召回

Status: implemented

[English](2026-10-03-advisory-procedure-recall.md) | 中文

## Problem

从以往工作提炼的过程可能包含过时步骤和特定任务的假设。将其发布为 skill 会让发现过程变成加载并遵循它的要求，并在 `/` 中混合历史经验与人工编写的工作流程。

## Decision

习得的过程保留在按用户隔离的 capability 存储中，并保留自动学习器、版本、支持文件和证据。它们不注册 skill provider。capability consumer 通过模型评分的任务相关性选择非 candidate、非 retired 的过程，并附加有大小限制、带来源标记的历史上下文。当前用户指令优先；召回内容不授予权限，也不扩大任务范围。

展示与使用分别记录。召回上下文和主动 `view` 调用使过程可供报告；只有报告的实际使用才形成执行证据。candidate 必须经过主动验证或恢复才能自动召回。

此决策替代[学习记录](../feature/2026-09-29-capability-learning.zh.md)中的 skill 发布机制，以及[生命周期记录](../feature/2026-09-29-capability-lifecycle.zh.md)中的 skill 加载归因。两者关于存储和证据的理由仍然适用。

## Alternatives considered

只过滤 `/` 菜单会保留指令性的模型目录。弱化 skill 描述会保留相同的激活机制。独立向量索引在没有当前需求的情况下增加存储和同步；选择过程使用现有 LLM 服务和 capability 注册表。

## Consequences

召回需要有预算限制的前台模型调用，也可能遗漏有用过程。相关性评分不代表可信程度。candidate 被保留，但不会自动展示。来源标记在会话日志中保留所选名称和版本。按用户要求，自动化行为与冲突测试延期；本次实现通过 TypeScript、构建和浏览器实测验证。
