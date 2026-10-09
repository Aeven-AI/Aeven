# Agent Note: Aeven 内联图片历史遵守网关请求预算

Status: implemented

[English](2026-10-08-aeven-inline-image-body-budget.md) | 中文

## Problem

Aeven 网关接受 8 MiB JSON 请求，但客户端从直连 DeepSeek 路由继承了 20 MiB 内联图片预算。上传图片和生成预览不断累积，使成功生成图片后的推理请求被拒绝；后续轮次也出现相同的 413。

## Decision

Aeven 路由默认采用 6 MiB base64 图片预算和 3 MiB 卸载步长。现有请求投影把最旧的预览替换为附件标识和规范化引用路径。持久图片和图片生成引用输入保持不变。配置可以覆盖这两个预算。

## Alternatives considered

**提高网关上限。** 这会改变网关滥用控制，而不是让客户端图片历史匹配部署的路由。

**修改直连 DeepSeek 默认值。** 该端点具有不同预算；Aeven 路由负责自己的默认值。

## Consequences

请求为文本、工具 schema 和 JSON 字段保留 2 MiB。具有更大非图片内容或不同网关上限的部署必须配置相应的图片预算。模型可以通过保留的本地路径读取已卸载的图片。
