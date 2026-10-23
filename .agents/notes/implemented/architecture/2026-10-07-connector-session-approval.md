# Agent Note: Connector action previews and scoped session approval

Status: implemented

English | [中文](2026-10-07-connector-session-approval.zh.md)

## Problem

Connector writes need readable content before consent. Repeated approval must not authorize another account, another operation, or a forked session.

## Decision

Approval previews derive from the correlated logged tool call, including nested calls. They show destination and message text before remaining arguments; tool arguments are not copied into approval requests. The preview reads in the takeover's own font — one size, line height and family across the card — with field labels set apart by weight alone at 500, never the browser's bold. Only a correlated command keeps the code family.

Requesters offer an account-and-operation scope. Connector scopes include the account-specific tool name; Google Workspace raw scopes also include service and resource-method path. The approval service commits the scope and original session ID in the decided event and returns the existing one-shot outcome to consumers. Cancellation takes precedence over stored grants. The `never` policy rejects every ask without dispatching an answerer, except one whose `allowSessionCoverage` is `'account'`: an action on the person's connected account is visible to other people, so it still reaches the answerers. An override recorded with `source: 'delegation'` withdraws that exception, so a child session rejects it like every other ask. The model-facing `never` statement tells the model that connected-account actions still ask. Forks cannot reuse grants recorded for another session ID.

## Alternatives considered

A global session allow policy would combine unrelated accounts, shell escalation, and connector administration. Client-only remembered decisions would bypass durable host enforcement.

## Consequences

Repeated operations may use different recipients and content; the panel explains this before consent. Under `never`, a composition that supplies no answerer resolves a connected-account ask as `unavailable` rather than `rejected`, and callers fail closed on it. Session grants survive session reloads and have no revocation interface. Draft identifiers remain identifiers unless their tool call includes the actual draft content. Automated tests and snapshot updates are omitted at the user's explicit request; validation uses TypeScript, the build, and manual live verification.

## Related

A second requester scope — sandbox escalation — reuses this grant mechanism under [sandbox escalation session grants](../feature/2026-10-12-sandbox-escalation-session-grant.md).
