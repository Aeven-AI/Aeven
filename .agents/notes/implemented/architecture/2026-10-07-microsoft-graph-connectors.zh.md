# Agent Note: 通过账户代理提供 Microsoft Graph 连接器

Status: implemented

[English](2026-10-07-microsoft-graph-connectors.md) | 中文

## Problem

Microsoft 服务需要账户专属授权及独立启用的工具，应用密钥及刷新令牌不能保存在 Host 上。

## Decision

Outlook、Outlook 日历、OneDrive、SharePoint 和 Teams 是独立的账户连接器，共用一个部署方拥有的 Entra 应用。[账户集成 Host](../../../../packages/host/account-integrations/README.zh.md) 遵循 Google 的授权、验证、挂载及技能路径。Aeven API 管理应用凭据、加密授权、账户元数据及刷新。Microsoft 工作账户授权通过已记录的租户刷新，个人账户使用 `consumers`。

固定版本的 MIT `@softeria/ms-365-mcp-server` 负责 Graph 调用。各提供方的明确工具列表排除邮箱规则、租户目录工具、Teams 成员管理、会议及在线状态。桥接进程仅获取短期访问令牌，MCP 客户端仅允许指定工具，因此桥接进程的本地登录辅助工具不能进入目录或执行。Microsoft 读取直接运行，所有提供的写入操作通过 MCP 公开名称映射请求批准。验证先检查 Graph 账户身份，再读取对应服务；预先提供令牌的模式不依赖桥接进程的本地账户固定设置。

## Alternatives considered

单个 Microsoft 365 连接行会合并无关的授权及启用操作。独立连接行保留服务专属权限及与 Google 相同的账户控制。自有 Graph 客户端会重复维护中的桥接进程的 I/O 及工具模式；明确列表及 harness 批准机制无需拥有该客户端即可控制提供的操作。

## Consequences

维护中的桥接进程将 Graph I/O 留在 harness 外，明确列表及批准检查使其操作限定于所选服务。API 部署负责应用注册及租户授权策略。

## Verification

Node 连接器测试覆盖授权、加密存储、账户元数据、租户专属刷新、管理员拒绝、重新连接错误及断开连接。Aeven 仅进行 TypeScript 检查及完整构建，用户明确排除 Aeven 测试及实时试验。真实授权及已认证 Microsoft 操作尚未验证。发布者验证、应用凭据、账户许可及租户策略仍是部署要求。[提案](../../proposed/feature/2026-10-07-microsoft-365-connectors.zh.md) 记录实时场景及推迟的提供方。
