# Agent Note: Blank Sessions Keep the Session Header

Status: implemented

English | [中文](2026-09-08-blank-session-header.zh.md)

## Problem

`ConversationSessionHeader` hid all header chrome while a selected Session was blank. A newly created Session therefore showed the Hero without its title or header actions, even though the strict Session entry and its contributions were already available. The header appeared only after the first prompt moved the conversation out of the blank phase.

## Decision

Every selected Session renders `conversation.session.header`, including a blank Session on the Hero. The no-Session state still has no header because the optional-Session root does not dispatch the strict entry until a Session exists. Blankness suppresses only `conversation.view`; it does not suppress navigation or Session actions. The header remains outside the conversation body and its content loader.

This supersedes only the blank-header visibility clause in the [fixed-header and sticky-composer decision](2026-07-29-sticky-composer-conversation-scroll.md). That note continues to own the header's placement above the root scrollport and the composer's placement inside it.

## Verification

The `ConversationRoot` skeleton test mounts a blank Session, requires an accessible current title, and requires both header contribution regions to dispatch while the Hero and live composer remain present. The active-session case continues to prove that the header stays outside the scrollport.

## Alternatives considered

**Keep the blank header hidden.** This preserves the uninterrupted Hero canvas, but it removes Session-level navigation and actions at the moment the selected Session first exists.

**Render only selected header actions on the Hero.** This keeps individual controls available but creates a second header composition path whose title, lineage, spacing, and accessibility can diverge from the active conversation.

**Move the header to the optional-Session root.** The header's data and contributions are strict-Session state. Giving the no-Session shell a parallel placeholder header would weaken that scope guarantee without helping a selected blank Session.

## Consequences

New Sessions show the same 56px navigation chrome as active conversations, so the title and every registered Session action are available before the first prompt. The Hero remains the blank-session body, and no target View activates until the Session leaves that phase.
