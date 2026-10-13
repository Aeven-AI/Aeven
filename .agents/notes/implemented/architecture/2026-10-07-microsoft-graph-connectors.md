# Agent Note: Microsoft Graph connectors through the account broker

Status: implemented

English | [中文](2026-10-07-microsoft-graph-connectors.zh.md)

## Problem

Microsoft services need account-owned consent and independently enabled tools without putting application secrets or refresh tokens on the Host.

## Decision

Outlook, Outlook Calendar, OneDrive, SharePoint, and Teams are separate account connectors on one deployment-owned Entra application. The [account integration host](../../../../packages/host/account-integrations/README.md) follows the Google consent, verification, mounting, and skill paths. The Aeven API owns application credentials, encrypted grants, account metadata, and refresh. Microsoft work grants refresh through their recorded tenant; personal grants use `consumers`.

The pinned MIT `@softeria/ms-365-mcp-server` owns Graph calls. Explicit per-provider tool lists exclude mailbox rules, tenant directory tools, Teams member administration, meetings, and presence. The bridge receives only a short-lived access token, and the MCP client admits only the specified tools, so the bridge's local login helpers cannot enter the catalog or execute. Microsoft reads run directly and all served writes ask for approval using the MCP public-name mapping. A verification read checks Graph account identity before the service read; supplied-token mode does not rely on the bridge's local account pinning.

## Alternatives considered

One Microsoft 365 row combines unrelated consent and enablement. Separate rows retain service-specific permissions and the same account controls as Google. An owned Graph client duplicates the maintained bridge's I/O and tool schemas; explicit lists and harness approvals retain control over exposed operations without owning that client.

## Consequences

The maintained bridge keeps Graph I/O outside the harness, while explicit lists and approval checks bind its operations to the selected service. The API deployment owns app registration and tenant consent policy.

## Verification

The Node connector suites cover consent, encrypted storage, account metadata, tenant-specific refresh, administrator refusals, reconnect errors, and disconnect. Aeven validation is TypeScript checking and the complete build; the user explicitly excludes Aeven tests and the live spike. Real consent and authenticated Microsoft operations are unverified. Publisher verification, application credentials, account licences, and tenant policy remain deployment requirements. [The proposed plan](../../proposed/feature/2026-10-07-microsoft-365-connectors.md) records the live scenarios and deferred providers.
