# Agent Note: Per-account master prompt and the Personalization page

Status: implemented

English | [中文](2026-10-19-account-master-prompt-and-personalization-page.zh.md)

## Problem

Aeven's identity is one long prompt (`deployment:persona`) shipped inside the `aeven` preset. Nothing in the product showed it, and nothing let a person change it: the only way to edit what Aeven is was to edit the composition file and restart. Settings → Personalization, the one page about how Aeven talks, offered a voice, free-text notes, and a field labelled "How should Aeven call you?" — a question that reads as conversational identity while writing the account display name, which is the thing that signs you in and feeds `<user_profile>`. The page thus presented a nickname form for an account fact, and gave the user no view of the instructions that actually govern the answers.

## Decision

Settings → Personalization is three settings — voice, notes, and the master prompt — and no name field.

**The master prompt is a per-account override of the persona section.** `@aeven/personalization` stores it in the person's existing document (format version 2, field `masterPrompt`, empty meaning "the shipped prompt stands"). For each top-level agent the person owns, the controller registers a `deployment:persona` section in that agent's scope with the standard `DEPLOYMENT_PERSONA` order; the nearest scope wins a name, so the person's text replaces the preset's persona for their own sessions and for nobody else's.

**The shipped prompt stays where the composition declares it.** The section's text provider is `stored || shipped`: when the person wrote nothing the controller reads the persona text out of the prompt registry through the agent's parent scope — the preset's own registration — instead of keeping a second copy anywhere. A document edited to empty therefore never leaves a session without an identity.

**The Host reads one registered section without assembling.** `SystemPrompt.sectionText(name, context)` resolves a section's text in a scope, calling a provider exactly as assembly would. It returns the text before variable interpolation, so the editor shows `{{model}}` and `{{cwd}}` as they are stored.

**Delegated subagents keep the shipped persona.** A child agent may register a persona of its own in the same scope the controller would use, and two registrations of one name in one scope fail at load; the controller therefore skips agents whose session header carries a delegation depth.

**The Remote carries the effective text.** `get()` returns the preferences, the bounds, `effectiveMasterPrompt` (their own text, or the shipped one), and `customMasterPrompt`; `update()` saves; `resetMasterPrompt()` clears the override. A text over `maxMasterPromptChars` (default 20000) is refused whole with `master-prompt-too-long`, as notes are refused with `notes-too-long`.

**The page states the name instead of asking for it.** "What Aeven calls you" is now one line of copy: Aeven picks it up from how the person introduces themselves in conversation. The account display name keeps its own home; this page no longer writes it.

### The page's shape

The voice is one row of four options whose chosen option explains itself below the row — instead of four full-width cards, each carrying a title, a description and a sample. The notes keep a Save because they are typed. The master prompt is always visible under its own heading, marked `Yours` when the person changed it, and offers Save and Reset to default; its editor opens on the text the person's sessions already carry, with a character count against the bound.

## Alternatives considered

**One master prompt for the whole install.** A deployment-level document read by every account was rejected: the page is personal settings, the natural owner of a text is the person it applies to, and a shared prompt would need an admin surface plus a reload path that per-account storage does not.

**Append the master prompt as another section instead of replacing the persona.** Rendering it after the persona would leave two instructions in force at once, with the model reconciling them; "reset to default" would then mean nothing, because the default was never replaced. The shadowing registration is what makes one text authoritative.

**Copy the shipped prompt into the personalization config.** Reading the default from a second field in `web-app/cordis.patch.yml` would have needed the same 8,269 characters in two files, and the copy would rot silently. Reading the preset's own registration through `sectionText` keeps one home for the text, at the cost of a Host read that only works while an agent of the caller exists.

**Keep the name field but relabel it.** Rejected on the product's own terms: a field asking what to call someone is a conversational fact surfaced as an account form. The account name is still editable through the account surface; this page stopped pretending to be the place.

## Consequences

- A person's edited prompt is model-visible from their next request and reconstructable from the session log, because the persona section is recorded in every `request/header`.
- Replacing the persona section at the same name and order keeps the assembled prompt shape identical for a person who changed nothing, so recorded session snapshots do not move.
- Delegation keeps its existing behavior, and a delegated helper does not read the delegating person's master prompt. A person who edits the prompt and then delegates gets the shipped persona in the child.
- Renaming oneself now lives only on the account surface; this page has no editor for it.
- `@aeven/personalization` gained a Host dependency on `@aeven/scope` (`scopeOf`, `scopeParentOf`), and the dependency policy classifies `scopeParentOf` as a peer-required export.

## Testing

`packages/preset/personalization/tests/store.spec.ts` pins the document format, trimming and both refusals, the no-change answer, reset, and the per-person separation. `packages/core/system-prompt/tests/scoped.spec.ts` pins `sectionText`: nearest-scope resolution, provider evaluation per read, unknown names, and uninterpolated text. `packages/client/ui-settings-personalization/tests/PersonalizationSection.client.spec.tsx` pins the page: the one-row voice picker with its single reading, the absent name field, notes that save only when dirty and refuse over-limit text, the always-visible effective prompt, the `Yours` badge, reset, and a failed read with retry.
