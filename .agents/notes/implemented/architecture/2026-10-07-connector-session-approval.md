# Agent Note: Connector action previews and scoped session approval

Status: implemented

English | [中文](2026-10-07-connector-session-approval.zh.md)

## Problem

Connector writes need readable content before consent. Repeated approval must not authorize another account, another operation, or a forked session.

## Decision

Approval previews derive from the correlated logged tool call, including nested calls. They show destination and message text before remaining arguments; tool arguments are not copied into approval requests.

Requesters offer an account-and-operation scope. Connector scopes include the account-specific tool name; Google Workspace raw scopes also include service and resource-method path. The approval service commits the scope and original session ID in the decided event and returns the existing one-shot outcome to consumers. Cancellation and the never policy take precedence. Forks cannot reuse grants recorded for another session ID.

## Alternatives considered

A global session allow policy would combine unrelated accounts, shell escalation, and connector administration. Client-only remembered decisions would bypass durable host enforcement.

## Consequences

Repeated operations may use different recipients and content; the panel explains this before consent. Session grants survive session reloads and have no revocation interface. Draft identifiers remain identifiers unless their tool call includes the actual draft content. Automated tests and snapshot updates are omitted at the user's explicit request; validation uses TypeScript, the build, and manual live verification.
