# Agent Note: Sandbox escalation session grants

Status: implemented

English | [中文](2026-10-12-sandbox-escalation-session-grant.zh.md)

## Problem

A denied confined call can be retried with `sandbox_permissions`, but every widening asked the person again, even minutes after they allowed the same widening in the same session. Repetitive work that writes outside the workspace — unpacking an archive beside an application bundle, a run of exports — turned into one prompt per command, and the requester's only alternative was to raise the session's access mode from the composer, a wider statement than "allow this widening again".

## Decision

`approveEscalation` offers a session grant with every escalation ask: scope `sandbox:<effectiveMode>-><requestedMode>` under coverage `'sandbox'`. The approval seam commits the scope and session id in `approval/decided` and reuses the grant on later asks matching the same tool name and scope, so the prompt's Allow for this session option covers the rest of the session. The scope names the standing mode the grant came from, so an ask made after the person switched the session to a different mode asks again. Bash, pwsh, and the filesystem mutations all reach this through the shared escalation choreography, and each offers the grant under its own tool name.

`allowSessionCoverage` is the requester's declaration of what its grant reaches; the panel selects the consent copy from it. Connector asks declare `'account'` (any operation of that kind on that account, including other recipients and content), escalation asks declare `'sandbox'` (any later call that takes the same wider access), and a requester that declares nothing gets `'action'` (the same action repeated), which claims nothing beyond the action on the prompt.

The grant changes neither the session's access mode nor the model-visible sandbox narration: an allowed escalation still stamps the granted mode onto the one call that asked, and the composer's access-mode control remains the single way to widen the session.

## Alternatives considered

**Raise the session's sandbox mode from the approval prompt** (writing `sandbox/mode` when the answer is a session grant) would spare the model the denial-then-retry cycle it still pays for each later command. It lost because the access-mode control already owns that decision, an approval card silently switching the session to full access states more than the card shows, and the seam deliberately returns the one-shot outcome to consumers rather than a grant the tool layer would have to act on.

**One generic session note for every requester** (no coverage declaration) lost because the honest reach differs by requester: a connector grant reaches recipients and content the card never showed, while an escalation grant reaches other commands. A single sentence would either understate the connector grant or say nothing useful about the escalation.

**Deriving the note in the panel from the tool name** (a client-side list of sandbox-enforcing tools) lost because the requester invents the scope, so only the requester knows what its grant reaches; such a list would go stale with the next enforcing family.

## Consequences

A person can let one widening repeat across a working session, and the prompt explains in the requester's terms what that grant reaches before they consent. The escalation grant is durable and replayable like every other grant, has no revocation interface, and does not carry to forks. The model never learns a grant exists, so it still asks for the widening with its justification and still runs the confined attempt that produced the denial.

## Related

Extends the per-requester grant decision of [connector session approval](../../architecture/2026-10-07-connector-session-approval.md) to a second kind of requester scope.

## Testing

`packages/sandbox/sandbox/tests/escalation.spec.ts` pins the offered scope and coverage; `packages/interaction/user-approval/tests/approval.spec.ts` pins the audited grant and its reuse without a second ask; `packages/client/ui-approval/tests/ui-approval.client.spec.tsx` pins the session button and the sandbox consent copy.
