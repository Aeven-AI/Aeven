# Agent Note: Gmail reads through Google sign-in

Status: implemented

English | [中文](2026-11-25-gmail-reads-through-google-sign-in.zh.md)

## Problem

Since [Google connectors without restricted scopes](2026-11-16-google-connectors-without-restricted-scopes.md), the Gmail connector could only send and manage labels, and reading mail required a separate IMAP email account with a Google app password. Users found the split confusing and the app password a barrier, while assistants that read Gmail offer one Google sign-in.

## Decision

- The Gmail connector requests `https://www.googleapis.com/auth/gmail.modify` alone. It covers reading, searching, threads, labels, drafts, and sending through the Workspace bridge's Gmail tools; a grant counts as connected only when it holds that scope, so a grant from the send-and-labels era asks to reconnect.
- `gmail.metadata` stays out: granted beside the other Gmail scopes, it makes Gmail refuse full-message reads and `q` searches.
- `gmail.modify` is restricted. Until the `aeven-connectors` application passes Google's CASA security assessment, Google shows its unverified-app screen for Gmail and caps the users who may grant it at 100 over the application's lifetime. Every other Google connector keeps its sensitive and non-sensitive scopes, so they verify without CASA.

## Alternatives considered

- **Guided IMAP with an app password** — reaches everything Gmail offers without any Google review, but asks each user to turn on 2-Step Verification and paste a 16-character password; the owner chose sign-in without that step.
- **`https://mail.google.com/` for IMAP with Google sign-in** — restricted as well, and adds no reach over `gmail.modify` for the bridge's tools.

## Consequences

- Gmail works for at most 100 users, behind Google's unverified-app screen, until the CASA assessment is done; the other connectors are unaffected.
- The IMAP email connector stays available for any mail provider, Gmail included.
