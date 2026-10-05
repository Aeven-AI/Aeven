# Agent Note: Permission modes are labelled by the boundary, not the sandbox knob

Status: implemented

English | [中文](2026-10-05-permission-mode-labels.zh.md)

## Problem

The GUI offered three permission modes under the names of the enforcement knobs behind them: `Read Only`, `Workspace Write`, and `Full access`. `Workspace Write` in particular named a `sandbox/mode` value, so the row a user had to choose from described an implementation setting while saying nothing about the thing they actually decide — how far the agent goes on its own, and when it stops to ask. The shipped base-bundle preset table carries no client labels, so those three names were the whole explanation a user got. The `Full access` risk dialog likewise described "fewer confirmation steps" without naming the mode a cautious user should pick instead.

The approval prompt had the matching gap. Its buttons were already `Reject` / `Allow once`, but nothing on the card said what the grant covers, so the one-shot answer was indistinguishable from a persistent policy change until the next request appeared.

## Decision

Built-in permission modes are presented under boundary-based product labels, in every popup that lists them, and nothing else: a row is the mode's name, so the surface stays a choice between modes.

| Machine value | Product label (en / zh) | The mode's boundary in one line (the label's meaning, not rendered copy) |
| --- | --- | --- |
| `read-only` | `Read only` / 仅可查看 | Looks at files and runs read-only commands. Nothing can be changed. |
| `workspace-write` | `Ask for approval` / 需要时先询问 | Works inside your workspace and asks before going beyond it. |
| `danger-full-access` | `Full access` / 完全权限 | No sandbox and no approval prompts: the agent can change anything on this machine. |

`Workspace Write` becomes `Ask for approval`, matching the mode's meaning as the composition default: the agent works inside the workspace and the `ask` approval policy pauses it at the boundary. Machine values, preset table keys, the `/permission` command argument, and the `permission/preset`, `sandbox/mode`, and `approval/policy` events are unchanged — this is presentation, so no durable or wire fact moves and replay is unaffected.

The labels are locale-owned client copy in both packages that present them. Each package carries its own copy because the two bundles load independently — the pre-existing duplication of the label map. Rows render the label and, where the picker supports it, the deployment's own `description` when it supplies one; no built-in explanation is rendered anywhere.

A mode the deployment renames gets no built-in label. Both packages resolve the built-in label only while the host still presents the value under the value itself or under the built-in English label; otherwise the deployment's own `name` is presented verbatim. The rule exists because built-in copy names behavior the deployment may no longer configure — a renamed mode must not inherit a claim about sandbox semantics this layer cannot verify.

The approval prompt keeps its two one-shot answers and gains one line stating what they cover: allowing applies to the one call, and the permission mode does not change. The sentence is copy over the existing closed outcome vocabulary — `allowed-once` remains the only grant, and no durable approval state is introduced.

## Alternatives considered

**Rename `danger-full-access` to Codex's three-mode trio and add `Approve for me` in the same change.** Codex's `Approve for me` keeps the sandbox and swaps the reviewer: requests to cross the boundary go to automatic review instead of the user. Aeven has no reviewer dimension — `approval/policy` is `ask | never`, and `allowed-once` is per request — so the mode would need a new durable knob plus an auto-review answerer on the `approval/request` waterfall. Shipping the label before the capability would promise automatic review that nothing performs; the rename therefore stays inside the existing three modes, and the reviewer dimension is separate work.

**Keep the sandbox names and add explanations elsewhere.** The names are the part a user reads first and repeats to themselves; leaving `Workspace Write` in place keeps the implementation vocabulary in the position of authority and asks other copy to undo it. The mode's own name is the cheapest place to say what it means, and the one a user repeats to a colleague.

**Name the modes after the approval policy (`Ask` / `Never ask`).** Both `read-only` and `workspace-write` carry the `ask` policy, so approval-policy names would collapse two distinct modes into one row and hide the boundary that actually differs.

**Render a consequence sentence under each mode in the chip's menu.** A sentence under every row says where the boundary sits without a hover. It was built first and removed: the mode's name already carries the decision ("Ask for approval" states the boundary in three words), so the second line repeated the label in a longer form, tripled the height of a three-row popup, and turned a two-word choice into a paragraph to read. The risk dialog and the model-facing policy context are where the consequence belongs; the popup shows what can be chosen.

**Put the explanation in the shared `Menu` primitive as a documented second line.** The primitive's `description` slot is right-aligned single-line text sized for command rows, so a sentence there would ellipsize, and a wrap-capable second line would be a general menu capability serving one popup. Rows stay single-line labels in the primitive's existing seat, leaving it unchanged.

## Consequences

A user choosing a mode reads what the agent may do rather than which knob moves, and a deployment that renames a mode keeps full control of its meaning at the cost of the built-in explanation — the same trade the label map already made. The `Full access` dialog now recommends `Ask for approval` by name, so the safer choice is reachable from the moment the risk is stated.

The Web UI snapshots that pin the chip's accessible name, the mode labels, and the Settings row copy change with the copy, as does the permission-presets browser spec's label list. The two client packages must keep their label keys in step by hand; nothing checks them across packages, so a mode renamed in one surface and not the other is a review-time catch. The popup widens by nothing: a row is one line at the primitive's own type scale.

The approval prompt's new line is copy only: the composer takeover, the pending-interaction registry, the audit pair, and the single-grant rule are untouched.

## Related

- [Web UI permission presets and approval answering](2026-07-23-web-permission-and-approval.md) owns the chip, the picker, the Settings row, and the approval panel this change re-labels; its protocol, registry, and lifecycle decisions stand.
- [Workspace-write as the shipped surface default](2026-07-31-workspace-write-surface-default.md) owns the composition default whose product label is now `Ask for approval`.
- [The approval seam](2026-07-06-approval-seam.md) owns the one-shot grant the approval prompt now states in words.
- [Locale-owned client UI copy](../architecture/2026-08-23-locale-owned-client-ui-copy.md) owns why the labels live in client dictionaries rather than the host preset table.
