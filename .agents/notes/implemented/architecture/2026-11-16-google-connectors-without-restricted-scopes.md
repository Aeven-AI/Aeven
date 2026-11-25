# Agent Note: Google connectors request only sensitive and non-sensitive scopes

Status: implemented

English | [中文](2026-11-16-google-connectors-without-restricted-scopes.zh.md)

> Gmail no longer follows this note: it reads through Google sign-in with `gmail.modify` ([Gmail reads through Google sign-in](2026-11-25-gmail-reads-through-google-sign-in.md)).

## Problem

Google's verification of the `aeven-connectors` OAuth application failed its "Request minimum scopes" step on 2026-11-05. Gmail requested `mail.google.com`, `gmail.modify`, `gmail.compose`, `gmail.readonly`, and `gmail.metadata`, and Drive requested `drive` and `drive.readonly`. Google classes all of these as restricted, and restricted scopes require a yearly CASA security assessment, which the owner declined. Calendar requested twelve overlapping scopes where full `calendar` already covers the other eleven.

## Decision

Each Google connector requests the widest scopes Google classes as sensitive or non-sensitive. The lists live in `servers/node` `services/connectors/ConnectorProviders.js` (the scopes the consent URL carries) and in `@aeven/host-account-integrations` `src/google.ts` (the first scope a grant must hold to count as connected):

- Gmail: `gmail.send` and `gmail.labels`. Reading and searching Gmail goes through the existing IMAP `email` connector with a Google app password, and the `gmail` skill routes reads there.
- Drive: `drive.file`, `documents`, `spreadsheets`, `presentations`, `forms.body`, and `forms.responses.readonly`. Drive operations see only files the user created or opened with Aeven; the Docs, Sheets, Slides, and Forms services open any file the user can access by id. The `google-drive` skill asks the user for a link when search misses.
- Calendar: `calendar`.

A `servers/node` unit test fails when a Google connector requests a restricted Gmail or Drive scope.

## Alternatives considered

- **Pass CASA.** Rejected by the owner: it is a paid assessment repeated every year.
- **Keep Gmail reading on OAuth in Testing status.** Rejected: test users count toward the project's lifetime cap of 100 users and refresh tokens expire after seven days.
- **Google Picker for Drive.** Deferred: it widens `drive.file` to files the user picks, but needs a picker surface in Settings and the chat UI.

## Consequences

Grants made before this change hold none of Gmail's or Drive's new first scopes, so those connectors ask the user to reconnect. Agents can no longer search a user's whole Drive or read Gmail through OAuth.
