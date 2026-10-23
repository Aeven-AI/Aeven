# Agent Note: 审批之前的工具参数预检

Status: implemented

[English](2026-10-23-tool-argument-preflight-before-approval.md) | 中文

## 问题

参数无法满足工具声明的 `parameters` 的调用会在工具函数体内部失败，而对需要审批的工具来说，函数体是在用户被询问是否批准该调用之后才执行的。用户因此要为一个不可能成功的调用作答，而他给出的拒绝看起来像是对该工具的判定，而不是对畸形参数的判定。以原始 `ToolDefinition` 对象注册的工具（MCP 工具即属此类）没有 `defineTool` 包装层，harness 在任何位置都不校验它们的参数。

## 决策

`ToolRuntime.createExecution` 中的 `argumentViolations` 在策略流水线运行之前，用可见定义声明的 `parameters` 校验已分离的调用参数。因此 `tools/pre-execute` waterfall、审批 `ask` 与各 guard 都不会看到不可能成功的调用。该校验使用 `packages/core/tools/src/json-schema.ts` 中的 `assertSupportedJsonSchema` 与 `validateJsonSchemaValue` 遍历参数，这与校验工具输出、subagent 输入和工作流输入的是同一个遍历器。存在违规时，调用以 `ToolArgsError`（`INVALID_ARGS`）错误结果结束，按 schema 遍历顺序列出每一条违规，模型据此改写下一次调用。

三种情况由其他归属方处理。未知工具不产生违规，保留 dispatch 阶段的 `UNKNOWN_TOOL` 结果，因此策略监听器仍能看到到达注册表的每个名称。`parameters` 超出遍历器支持子集的工具定义（例如 MCP 服务器的外部 schema）被跳过，由该工具自行校验输入。信号已中止时产生 dispatch 前中止的结果，而不是参数错误。

审批分支在拒绝原因中说明拒绝的范围：`the user rejected this call of tool "<name>"; the rejection covers this call only, and a later call asks again`。

## 考虑过的替代方案

**只在 `defineTool` 内部校验。**以原始 `ToolDefinition` 对象注册的定义绕过该包装层，因此缺少必需键或类型错误的调用会未经校验地到达 `execute` 与工具函数体，或在 MCP 客户端上到达 `callTool`。执行器是每个调用都会经过的唯一位置，校验应归属这里。

**在 MCP 工具客户端中把非对象参数强制转换为 `{}`。**该客户端在 `callTool` 之前把 `null` 与标量参数替换为空对象，向 MCP 服务器发送模型并未发出的请求，又把该服务器的回答当作模型那次调用的结果返回。工具声明的对象 schema 会拒绝这种载荷，模型会把拒绝读作参数无效并改写调用。

## 后果

- 审批提示只在调用可以执行时才会到达用户；拒绝原因告知模型该拒绝仅覆盖这一次调用，下一次调用会重新询问，而不会把该工具读作已被封禁。
- 以原始方式注册的定义现在会按其声明的 `parameters` 接受校验。既声明了遍历器支持的 schema、又自行校验输入的工具会在两层报告同一违规；声明外部词汇的工具只由其函数体校验。
- MCP 工具客户端转发模型发送的参数。对于模型未带参数发出的调用，原本容忍空载荷的服务器现在会收到运行时的参数无效结果。
- 每次调用增加一次 schema 遍历，其对象是已为工具函数体分离并冻结的值。
- `packages/core/tools/tests/tools.spec.ts` 固定了原始定义被拒绝、有效定义被 dispatch、`UNKNOWN_TOOL` 路径未受影响，以及不支持词汇被跳过；`packages/mcp/mcp-client/tests/mcp-client.spec.ts` 固定了 `null` 与标量参数在 `callTool` 之前被拒绝，以及有效对象被转发。
