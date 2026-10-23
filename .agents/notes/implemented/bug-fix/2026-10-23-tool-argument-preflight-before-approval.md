# Agent Note: Tool argument preflight before approval

Status: implemented

English | [中文](2026-10-23-tool-argument-preflight-before-approval.zh.md)

## Problem

A call whose arguments cannot satisfy its tool's advertised `parameters` fails inside the tool body, which for an approval-gated tool runs after the person has been asked to approve the call. The person then answers a question about a call that cannot succeed, and the rejection they give reads as a verdict on the tool rather than on malformed arguments. Tools registered as raw `ToolDefinition` objects — MCP tools among them — carry no `defineTool` wrapper, so the harness checked their arguments nowhere.

## Decision

`argumentViolations` in `ToolRuntime.createExecution` validates the detached call arguments against the visible definition's `parameters` before the policy pipeline runs. The `tools/pre-execute` waterfall, the approval `ask`, and the guards therefore never observe a call that cannot succeed. The check walks the parameters with `assertSupportedJsonSchema` and `validateJsonSchemaValue` from `packages/core/tools/src/json-schema.ts`, the walker that also validates tool output, subagent input, and workflow input. Violations end the call as a `ToolArgsError` (`INVALID_ARGS`) error result listing each violation in schema-walk order, and the model corrects its next call from that text.

Three cases keep another owner. An unknown tool produces no violations and keeps the dispatch-stage `UNKNOWN_TOOL` result, so policy listeners still see every name that reaches the registry. A definition whose `parameters` fall outside the walker's supported subset — an MCP server's external schema — is skipped, and the tool validates its own input. An aborted signal produces the aborted-before-dispatch result instead of an argument error.

The approval switch states the scope of a rejection in its denial reason: `the user rejected this call of tool "<name>"; the rejection covers this call only, and a later call asks again`.

## Alternatives considered

**Validate inside `defineTool` only.** Definitions registered as raw `ToolDefinition` objects bypass the wrapper, so a call missing a required key or carrying a wrong type reached `execute` and the tool body, or reached `callTool` on the MCP client, unchecked. The executor is the one place every call passes, so the check belongs there.

**Coerce non-object arguments to `{}` in the MCP tool client.** The client replaced `null` and primitive arguments with an empty object before `callTool`, sending the MCP server a request the model did not make and returning that server's answer as the result of the model's call. The advertised object schema rejects the payload, and the model reads the refusal as invalid arguments and rewrites the call.

## Consequences

- An approval prompt reaches the person only for a call that can execute, and the denial reason tells the model that a rejection covers that call alone, so the next call asks again instead of reading the tool as blocked.
- Raw-registered definitions are now checked against the `parameters` they advertise. A tool that both advertises a schema the walker supports and validates its own input reports a violation at two layers; one that advertises external vocabulary is checked only by its body.
- The MCP tool client forwards the arguments the model sent. A server that tolerated an empty payload for a call the model made without arguments now receives the runtime's invalid-arguments result instead.
- The preflight adds one schema walk per call, against a value already detached and frozen for the tool body.
- `packages/core/tools/tests/tools.spec.ts` pins the refusal of a raw definition, the dispatch of a valid one, the untouched `UNKNOWN_TOOL` path, and the skip for unsupported vocabulary; `packages/mcp/mcp-client/tests/mcp-client.spec.ts` pins that `null` and primitive arguments are refused before `callTool` and that a valid object is forwarded.
